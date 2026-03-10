import { Image } from 'react-native';
import { generateSvg } from './tunerCharacterSvg';

type Props = {
  cents: number;
  color?: string;
  note?: string;
  playing?: boolean;
  playingFreq?: number;
  width?: number;
  height?: number;
};

export function TunerCharacter({ cents, color = 'white', note = '', playing = false, width = 80, height = 160 }: Props) {
  const svg = generateSvg(playing ? 0 : cents, color, note);
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return <Image source={{ uri }} style={{ width, height }} />;
}
