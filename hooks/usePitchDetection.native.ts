// Native (iOS/Android) pitch detection using react-native-audio-record.
// Metro automatically picks this file over usePitchDetection.ts on native.
import { useCallback, useEffect, useRef, useState } from "react";
// @ts-ignore — no bundled types for this library
import AudioRecord from "react-native-audio-record";

const RMS_THRESHOLD = 0.004;
const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 2048;          // 2048 is still 2× the longest guitar wavelength; 4× cheaper than 4096
const MIN_PROCESS_MS = 100;        // run autocorrelation at most 10×/sec to keep JS thread free
const EMIT_INTERVAL_MS = 500;
const RAW_EMIT_INTERVAL_MS = 80;

const NOTE_STRINGS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

export const GUITAR_STRINGS = [
  { label: "E2", note: "E", octave: 2, freq: 82.41,  string: 6 },
  { label: "A2", note: "A", octave: 2, freq: 110.0,  string: 5 },
  { label: "D3", note: "D", octave: 3, freq: 146.83, string: 4 },
  { label: "G3", note: "G", octave: 3, freq: 196.0,  string: 3 },
  { label: "B3", note: "B", octave: 3, freq: 246.94, string: 2 },
  { label: "E4", note: "E", octave: 4, freq: 329.63, string: 1 },
];

// Convert a base64 Int16 PCM chunk (from AudioRecord) to a Float32Array [-1, 1]
function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
  return float32;
}

function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);

  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < RMS_THRESHOLD) return -1;

  let r1 = 0, r2 = SIZE - 1;
  const threshold = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < threshold) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < threshold) { r2 = SIZE - i; break; }
  }

  const trimmed = buf.slice(r1, r2 + 1);
  const newSize = trimmed.length;

  const c = new Float32Array(MAX_SAMPLES);
  for (let i = 0; i < MAX_SAMPLES; i++)
    for (let j = 0; j < newSize - i; j++)
      c[i] += trimmed[j] * trimmed[j + i];

  let d = 0;
  while (d < MAX_SAMPLES - 1 && c[d] > c[d + 1]) d++;

  let maxVal = -1, maxPos = -1;
  for (let i = d; i < MAX_SAMPLES; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos === -1) return -1;

  let T0 = maxPos;
  if (T0 > 0 && T0 < MAX_SAMPLES - 1) {
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
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

  const runningRef      = useRef(false);
  const sampleBufRef    = useRef<number[]>([]);
  const freqBufferRef   = useRef<number[]>([]);
  const lastEmitRef     = useRef<number>(0);
  const lastRawEmitRef  = useRef<number>(0);
  const lastProcessRef  = useRef<number>(0);

  const start = useCallback(async () => {
    // iOS triggers the mic permission dialog automatically on first AudioRecord.start()
    // because NSMicrophoneUsageDescription is declared in Info.plist.
    // Android uses the RECORD_AUDIO permission declared in AndroidManifest.xml.
    AudioRecord.init({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6, // Android: VOICE_RECOGNITION; ignored on iOS
    });

    runningRef.current = true;
    sampleBufRef.current = [];
    freqBufferRef.current = [];
    lastEmitRef.current = performance.now();
    lastRawEmitRef.current = performance.now();
    lastProcessRef.current = 0;
    setIsListening(true);
    setError(null);

    AudioRecord.on("data", (data: string) => {
      if (!runningRef.current) return;

      const chunk = base64ToFloat32(data);
      const buf = sampleBufRef.current;
      for (let i = 0; i < chunk.length; i++) buf.push(chunk[i]);

      // Drain buffer without processing if it grows too large (prevents unbounded backlog)
      if (buf.length > BUFFER_SIZE * 4) {
        sampleBufRef.current = buf.slice(-BUFFER_SIZE);
        return;
      }

      if (buf.length < BUFFER_SIZE) return;

      // Throttle: run autocorrelation at most once per MIN_PROCESS_MS
      const now = performance.now();
      if (now - lastProcessRef.current < MIN_PROCESS_MS) return;
      lastProcessRef.current = now;

      // Take one window, discard the rest
      const window = new Float32Array(buf.splice(0, BUFFER_SIZE));
      sampleBufRef.current = [];

      const freq = autoCorrelate(window, SAMPLE_RATE);

      if (freq > 60 && freq < 1400) {
        freqBufferRef.current.push(freq);
        if (now - lastRawEmitRef.current >= RAW_EMIT_INTERVAL_MS) {
          lastRawEmitRef.current = now;
          setRawCents(freqToNoteInfo(freq).cents);
        }
      } else {
        if (now - lastRawEmitRef.current >= RAW_EMIT_INTERVAL_MS) {
          lastRawEmitRef.current = now;
          setRawCents(null);
        }
      }

      if (now - lastEmitRef.current >= EMIT_INTERVAL_MS) {
        lastEmitRef.current = now;
        const samples = freqBufferRef.current.splice(0);
        if (samples.length > 0) {
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
    });

    AudioRecord.start();
  }, []);

  // pause/resume: silence processing without stopping AudioRecord, avoiding iOS audio session clicks
  const pause = useCallback(() => {
    runningRef.current = false;
    setPitch(null);
    setRawCents(null);
    sampleBufRef.current = [];
    freqBufferRef.current = [];
  }, []);

  const resume = useCallback(() => {
    runningRef.current = true;
    lastEmitRef.current = performance.now();
    lastRawEmitRef.current = performance.now();
    lastProcessRef.current = 0;
  }, []);

  const stop = useCallback(async () => {
    runningRef.current = false;
    try { await AudioRecord.stop(); } catch {}
    setIsListening(false);
    setPitch(null);
    setRawCents(null);
    sampleBufRef.current = [];
    freqBufferRef.current = [];
  }, []);

  useEffect(() => () => { stop(); }, [stop]);

  return { pitch, rawCents, isListening, error, start, stop, pause, resume };
}
