import { useCallback, useEffect, useRef, useState } from "react";

export function useReferenceTone() {
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [playingFreq, setPlayingFreq] = useState<number | null>(null);
  const playingFreqRef = useRef<number | null>(null);

  const stopTone = useCallback(() => {
    if (!ctxRef.current || !gainRef.current || !oscRef.current) return;
    const ctx = ctxRef.current;
    const gain = gainRef.current;
    const osc = oscRef.current;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    setTimeout(() => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    }, 400);
    oscRef.current = null;
    gainRef.current = null;
    playingFreqRef.current = null;
    setPlayingFreq(null);
  }, []);

  const playTone = useCallback((freq: number) => {
    if (oscRef.current && gainRef.current && ctxRef.current) {
      const gain = gainRef.current;
      const osc = oscRef.current;
      gain.gain.cancelScheduledValues(ctxRef.current.currentTime);
      gain.gain.setTargetAtTime(0, ctxRef.current.currentTime, 0.03);
      setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {}
      }, 150);
      oscRef.current = null;
      gainRef.current = null;
    }
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    oscRef.current = osc;
    gainRef.current = gain;
    playingFreqRef.current = freq;
    setPlayingFreq(freq);
  }, []);

  const toggleTone = useCallback(
    (freq: number) => {
      if (playingFreqRef.current === freq) {
        stopTone();
      } else {
        playTone(freq);
      }
    },
    [playTone, stopTone],
  );

  useEffect(() => () => stopTone(), [stopTone]);

  return { playingFreq, toggleTone, playTone, stopTone };
}
