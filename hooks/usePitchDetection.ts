import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// Minimum RMS signal level to attempt pitch detection.
// Lower = more sensitive (picks up quieter strings but more noise).
// Higher = less sensitive (only triggers on a strong pluck).
// Typical range: 0.004 (very sensitive) – 0.02 (needs a firm pluck).
const RMS_THRESHOLD = 0.007;

const NOTE_STRINGS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export const GUITAR_STRINGS = [
  { label: "E2", note: "E", octave: 2, freq: 82.41, string: 6 },
  { label: "A2", note: "A", octave: 2, freq: 110.0, string: 5 },
  { label: "D3", note: "D", octave: 3, freq: 146.83, string: 4 },
  { label: "G3", note: "G", octave: 3, freq: 196.0, string: 3 },
  { label: "B3", note: "B", octave: 3, freq: 246.94, string: 2 },
  { label: "E4", note: "E", octave: 4, freq: 329.63, string: 1 },
];

function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);

  // Check signal level (RMS)
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < RMS_THRESHOLD) return -1;

  // Trim silence from edges
  let r1 = 0,
    r2 = SIZE - 1;
  const threshold = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < threshold) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < threshold) {
      r2 = SIZE - i;
      break;
    }
  }

  const trimmed = buf.slice(r1, r2 + 1);
  const newSize = trimmed.length;

  // Compute autocorrelation
  const c = new Float32Array(MAX_SAMPLES);
  for (let i = 0; i < MAX_SAMPLES; i++) {
    for (let j = 0; j < newSize - i; j++) {
      c[i] += trimmed[j] * trimmed[j + i];
    }
  }

  // Find first dip then subsequent peak
  let d = 0;
  while (d < MAX_SAMPLES - 1 && c[d] > c[d + 1]) d++;

  let maxVal = -1,
    maxPos = -1;
  for (let i = d; i < MAX_SAMPLES; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i];
      maxPos = i;
    }
  }

  if (maxPos === -1) return -1;

  // Parabolic interpolation for sub-sample accuracy
  let T0 = maxPos;
  if (T0 > 0 && T0 < MAX_SAMPLES - 1) {
    const x1 = c[T0 - 1],
      x2 = c[T0],
      x3 = c[T0 + 1];
    T0 = T0 + (x3 - x1) / (2 * (2 * x2 - x1 - x3));
  }

  return sampleRate / T0;
}

function freqToNoteInfo(freq: number) {
  const noteNum = 12 * Math.log2(freq / 440) + 69;
  const rounded = Math.round(noteNum);
  const cents = Math.round((noteNum - rounded) * 100);
  const note = NOTE_STRINGS[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { note, octave, cents };
}

export type PitchInfo = {
  frequency: number;
  note: string;
  octave: number;
  cents: number;
  isActive: boolean;
};

export function usePitchDetection() {
  const [pitch, setPitch] = useState<PitchInfo | null>(null);
  const [rawCents, setRawCents] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const freqBufferRef = useRef<number[]>([]);
  const lastEmitRef = useRef<number>(0);
  const lastRawEmitRef = useRef<number>(0);

  const EMIT_INTERVAL_MS = 500;
  const RAW_EMIT_INTERVAL_MS = 80;

  const start = useCallback(async () => {
    if (Platform.OS !== "web") {
      setError("Real-time pitch detection requires the web/browser target.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsListening(true);
      setError(null);
      freqBufferRef.current = [];
      lastEmitRef.current = performance.now();

      const buf = new Float32Array(analyser.fftSize);

      const updatePitch = () => {
        analyser.getFloatTimeDomainData(buf);
        const freq = autoCorrelate(buf, audioContext.sampleRate);

        if (freq > 60 && freq < 1400) {
          freqBufferRef.current.push(freq);
          // Fast raw update for the character animation
          const now2 = performance.now();
          if (now2 - lastRawEmitRef.current >= RAW_EMIT_INTERVAL_MS) {
            lastRawEmitRef.current = now2;
            setRawCents(freqToNoteInfo(freq).cents);
          }
        } else {
          const now2 = performance.now();
          if (now2 - lastRawEmitRef.current >= RAW_EMIT_INTERVAL_MS) {
            lastRawEmitRef.current = now2;
            setRawCents(null);
          }
        }

        const now = performance.now();
        if (now - lastEmitRef.current >= EMIT_INTERVAL_MS) {
          lastEmitRef.current = now;
          const samples = freqBufferRef.current;
          freqBufferRef.current = [];

          if (samples.length > 0) {
            // Median is more robust than mean against outlier frames
            const sorted = [...samples].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const info = freqToNoteInfo(median);
            setPitch({
              frequency: Math.round(median * 10) / 10,
              note: info.note,
              octave: info.octave,
              cents: info.cents,
              isActive: true,
            });
          } else {
            setPitch((prev) => (prev ? { ...prev, isActive: false } : null));
          }
        }

        animFrameRef.current = requestAnimationFrame(updatePitch);
      };

      updatePitch();
    } catch {
      setError(
        "Could not access microphone. Please allow microphone permissions.",
      );
    }
  }, []);

  const stop = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current = null;
    setIsListening(false);
    setPitch(null);
  }, []);

  useEffect(() => () => stop(), [stop]);

  // Web: no audio session to manage, pause/resume are no-ops
  const pause = useCallback(() => {}, []);
  const resume = useCallback(() => {}, []);

  return { pitch, rawCents, isListening, error, start, stop, pause, resume };
}
