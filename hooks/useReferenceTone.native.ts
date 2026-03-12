import { useCallback, useEffect, useRef, useState } from "react";
import { AudioContext } from "react-native-audio-api";

// Click-free reference tone strategy:
// One persistent oscillator runs continuously at gain=0. When a note plays we
// fade gain 0→0.3 (12 ms). Changing notes mid-play just sets osc.frequency.value
// directly — the waveform is continuous so there is no amplitude discontinuity
// and therefore no click. Stopping fades gain 0.3→0 (12 ms).
//
// linearRampToValueAtTime works correctly when primed with setValueAtTime first.
// The fade-out is scheduled 13 ms in the future (FADE_S + 1 ms) to ensure its
// setValueAtTime anchor always falls after any in-progress fade-in events in
// the AudioParam queue (which end at T_start + FADE_S).

type GainNode = ReturnType<AudioContext["createGain"]>;
type OscNode  = ReturnType<AudioContext["createOscillator"]>;

const FADE_S = 0.012; // 12 ms

export function useReferenceTone() {
  const ctxRef        = useRef<AudioContext | null>(null);
  const gainRef       = useRef<GainNode | null>(null);
  const oscRef        = useRef<OscNode | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingRef  = useRef(false);
  const [playingFreq, setPlayingFreq] = useState<number | null>(null);
  const playingFreqRef = useRef<number | null>(null);

  function getCtxGainOsc() {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;

    if (!gainRef.current) {
      const gain = ctx.createGain();
      gain.gain.value = 0; // silent until playTone
      gain.connect(ctx.destination);
      gainRef.current = gain;
    }

    if (!oscRef.current) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 110;
      osc.connect(gainRef.current);
      osc.start();
      oscRef.current = osc;
    }

    return { ctx, gain: gainRef.current, osc: oscRef.current };
  }

  const stopTone = useCallback(() => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    playingFreqRef.current = null;
    setPlayingFreq(null);

    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;

    const ctx  = ctxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain) return;

    // Schedule fade-out starting FADE_S+1ms from now. This ensures the
    // setValueAtTime anchor is always after any queued fade-in events
    // (which end at T_toneStart + FADE_S), preventing silent event drops.
    const now   = ctx.currentTime;
    const start = now + FADE_S + 0.001;
    gain.gain.setValueAtTime(0.3, start);
    gain.gain.linearRampToValueAtTime(0, start + FADE_S);
  }, []);

  const playTone = useCallback((freq: number) => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    playingFreqRef.current = freq;
    setPlayingFreq(freq);

    if (isPlayingRef.current) {
      // Already playing — retune the running oscillator directly.
      // Waveform continues without phase reset → no amplitude discontinuity → no click.
      const osc = oscRef.current;
      if (osc) osc.frequency.value = freq;
      return;
    }

    // First note: wait 80 ms for the audio session to settle after mic pause.
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      if (playingFreqRef.current !== freq) return;

      const { ctx, gain, osc } = getCtxGainOsc();
      try { (ctx as any).resume?.(); } catch {}

      osc.frequency.value = freq;
      isPlayingRef.current = true;

      // Cancel any lingering fade-out events, then fade in.
      const now = ctx.currentTime;
      try { gain.gain.cancelScheduledValues(0); } catch {}
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.3, now + FADE_S);
    }, 80);
  }, []);

  const toggleTone = useCallback(
    (freq: number) => {
      if (playingFreqRef.current === freq) stopTone();
      else playTone(freq);
    },
    [playTone, stopTone],
  );

  useEffect(() => {
    const { ctx } = getCtxGainOsc();
    try { (ctx as any).resume?.(); } catch {}
    return () => stopTone();
  }, []);

  return { playingFreq, toggleTone, playTone, stopTone };
}
