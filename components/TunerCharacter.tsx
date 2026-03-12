import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { generateSvg } from "./tunerCharacterSvg";

type Props = {
  cents: number;
  color?: string;
  note?: string;
  playing?: boolean;
  playingFreq?: number;
  width?: number;
  height?: number;
};

const INTERVAL_MS = 30;
const LOW_E_HZ = 82; // anchor — low E speed is unchanged

export function TunerCharacter({
  cents,
  color = "white",
  note = "",
  playing = false,
  playingFreq,
  width = 80,
  height = 160,
}: Props) {
  const [animCents, setAnimCents] = useState(0);
  const [armPhase, setArmPhase] = useState(0);
  const bodyPhaseRef = useRef(0);
  const armPhaseRef = useRef(0);

  useEffect(() => {
    if (!playing) {
      setAnimCents(0);
      setArmPhase(0);
      bodyPhaseRef.current = 0;
      armPhaseRef.current = 0;
      return;
    }

    const freq = playingFreq ?? 110;

    // Arms: linear scaling with frequency
    const armIncrement = (2 * Math.PI * INTERVAL_MS * freq) / (164 * 1000);

    // Body bounce: compress the speed range so the high end is ~30% less aggressive.
    // Speed is anchored at LOW_E_HZ — low E stays identical, high E is slower.
    // 0.7 = range compression factor (reduce to slow high end more, raise to widen gap)
    const bodyFreq = LOW_E_HZ + (freq - LOW_E_HZ) * 0.45;
    const bodyIncrement = (2 * Math.PI * INTERVAL_MS * bodyFreq) / (164 * 1000);

    const interval = setInterval(() => {
      bodyPhaseRef.current += bodyIncrement;
      armPhaseRef.current += armIncrement;
      setAnimCents(Math.sin(bodyPhaseRef.current) * 35);
      setArmPhase(armPhaseRef.current);
    }, INTERVAL_MS);

    return () => clearInterval(interval);
  }, [playing, playingFreq]);

  const svg = generateSvg(
    playing ? animCents : cents,
    color,
    note,
    playing ? armPhase : 0,
  );
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <Image source={{ uri }} style={{ width, height }} contentFit="contain" />
  );
}
