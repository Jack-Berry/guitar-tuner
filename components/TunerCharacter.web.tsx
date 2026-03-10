import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import {
  computeParams, type TunerParams,
  SIGN_X, SIGN_Y, SIGN_W, SIGN_H, SIGN_R, SIGN_CX, SIGN_CY,
  SIGN_LEFT, SIGN_RIGHT, SIGN_BOTTOM,
} from './tunerCharacterSvg';

type Props = {
  cents: number;
  color?: string;
  note?: string;
  playing?: boolean;
  playingFreq?: number;
  width?: number;
  height?: number;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const SPRING_K = 0.12;
const SETTLE_THRESHOLD = 0.02;

function mkEl<T extends SVGElement>(tag: string, attrs: Record<string, string>): T {
  const el = document.createElementNS(SVG_NS, tag) as T;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function rnd(v: number) { return Math.round(v * 10) / 10; }

// Map playing frequency to wiggle rate (Hz).
// Guitar range: E2 ~82 Hz → 1.5 Hz wiggle, E4 ~330 Hz → 4.5 Hz wiggle.
function freqToWiggleRate(freq: number): number {
  const minF = 82, maxF = 330;
  const minW = 1.5, maxW = 4.5;
  const t = Math.max(0, Math.min(1, (freq - minF) / (maxF - minF)));
  return minW + t * (maxW - minW);
}

// Sine-wave arm wiggle for the reference-tone playing state.
// Arms connect from body sides (GOOD keyframe: lHand=12,115 / rHand=88,115)
// up to sign corners (SIGN_LEFT/RIGHT at SIGN_BOTTOM).
// We animate the quadratic bezier control point with opposite phases on each arm.
function wiggleArmPaths(t: number, freq: number): { lArmD: string; rArmD: string } {
  const lhx = 12, lhy = 115;
  const rhx = 88, rhy = 115;
  const midY = (lhy + SIGN_BOTTOM) / 2; // ~87.5

  const ampX = 12;
  const ampY = 22;
  const phase = t * freqToWiggleRate(freq) * Math.PI; // speed scales with frequency

  const lcx = (lhx - 6) + ampX * Math.sin(phase);
  const lcy = midY        + ampY * Math.cos(phase);

  const rcx = (rhx + 6)  - ampX * Math.sin(phase + Math.PI); // opposite phase
  const rcy = midY        + ampY * Math.cos(phase + Math.PI);

  return {
    lArmD: `M ${lhx} ${lhy} Q ${rnd(lcx)} ${rnd(lcy)}, ${SIGN_LEFT} ${SIGN_BOTTOM}`,
    rArmD: `M ${rhx} ${rhy} Q ${rnd(rcx)} ${rnd(rcy)}, ${SIGN_RIGHT} ${SIGN_BOTTOM}`,
  };
}

function applyParams(els: SVGEls, p: TunerParams, note: string) {
  els.shadow.setAttribute('rx', String(p.shadowRx));
  els.lArm.setAttribute('d', p.lArmD);
  els.rArm.setAttribute('d', p.rArmD);

  // Sign tilt (rotate around sign centre)
  els.signGroup.setAttribute('transform', `rotate(${p.signRotation}, ${SIGN_CX}, ${SIGN_CY})`);
  els.noteText.textContent = note;

  els.body.setAttribute('d', p.bodyD);
  els.lBrow.setAttribute('d', p.lBrowD);
  els.rBrow.setAttribute('d', p.rBrowD);

  els.lEye.setAttribute('cx', String(p.lEye.cx));
  els.lEye.setAttribute('cy', String(p.lEye.cy));
  els.lEye.setAttribute('rx', String(p.lEye.rx));
  els.lEye.setAttribute('ry', String(p.lEye.ry));

  els.rEye.setAttribute('cx', String(p.rEye.cx));
  els.rEye.setAttribute('cy', String(p.rEye.cy));
  els.rEye.setAttribute('rx', String(p.rEye.rx));
  els.rEye.setAttribute('ry', String(p.rEye.ry));

  els.mouth.setAttribute('d', p.mouthD);

  // Compression marks (above body)
  const ty = p.topY;
  if (p.compOp > 0) {
    els.comp[0].setAttribute('x1','36'); els.comp[0].setAttribute('y1', String(ty-13));
    els.comp[0].setAttribute('x2','36'); els.comp[0].setAttribute('y2', String(ty-6));
    els.comp[1].setAttribute('x1','50'); els.comp[1].setAttribute('y1', String(ty-15));
    els.comp[1].setAttribute('x2','50'); els.comp[1].setAttribute('y2', String(ty-8));
    els.comp[2].setAttribute('x1','64'); els.comp[2].setAttribute('y1', String(ty-13));
    els.comp[2].setAttribute('x2','64'); els.comp[2].setAttribute('y2', String(ty-6));
  }
  els.comp.forEach(l => l.setAttribute('opacity', p.compOp > 0 ? String(p.compOp) : '0'));
  els.tens.forEach(l => l.setAttribute('opacity', p.tensOp > 0 ? String(p.tensOp) : '0'));
}

type SVGEls = {
  shadow: SVGEllipseElement;
  lArm: SVGPathElement;
  rArm: SVGPathElement;
  signGroup: SVGGElement;
  noteText: SVGTextElement;
  body: SVGPathElement;
  lBrow: SVGPathElement;
  rBrow: SVGPathElement;
  lEye: SVGEllipseElement;
  rEye: SVGEllipseElement;
  mouth: SVGPathElement;
  comp: SVGLineElement[];
  tens: SVGLineElement[];
  allStroked: SVGElement[];
  allFilled: SVGElement[];
};

function buildSVG(color: string): { svg: SVGSVGElement; els: SVGEls } {
  const c = color;
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 100 200');
  svg.style.width = '100%';
  svg.style.height = '100%';

  const shadow = mkEl<SVGEllipseElement>('ellipse', {
    cx: '50', cy: '193', ry: '4', fill: 'rgba(0,0,0,0.10)',
  });

  const lArm = mkEl<SVGPathElement>('path', {
    fill: 'none', stroke: c, 'stroke-width': '4', 'stroke-linecap': 'round',
  });
  const rArm = mkEl<SVGPathElement>('path', {
    fill: 'none', stroke: c, 'stroke-width': '4', 'stroke-linecap': 'round',
  });

  // Sign group (rect + text, transforms together for tilt)
  const signGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  const signRect = mkEl<SVGRectElement>('rect', {
    x: String(SIGN_X), y: String(SIGN_Y),
    width: String(SIGN_W), height: String(SIGN_H),
    rx: String(SIGN_R),
    fill: '#000', stroke: c, 'stroke-width': '2',
  });
  const noteText = mkEl<SVGTextElement>('text', {
    x: String(SIGN_CX), y: String(SIGN_CY + 4),
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    fill: c, 'font-size': '28', 'font-weight': '800',
    'font-family': 'system-ui,sans-serif',
  });
  signGroup.appendChild(signRect);
  signGroup.appendChild(noteText);

  const compLines = [0, 1, 2].map(() =>
    mkEl<SVGLineElement>('line', { stroke: c, 'stroke-width': '1.5', 'stroke-linecap': 'round', opacity: '0' })
  );
  const tensData = [
    ['22','117','28','120'], ['20','127','26','126'],
    ['72','120','78','117'], ['74','126','80','127'],
  ];
  const tensLines = tensData.map(([x1,y1,x2,y2]) =>
    mkEl<SVGLineElement>('line', { x1, y1, x2, y2, stroke: c, 'stroke-width': '1.5', 'stroke-linecap': 'round', opacity: '0' })
  );

  const body  = mkEl<SVGPathElement>('path', { fill: '#000', stroke: c, 'stroke-width': '2.5', 'stroke-linejoin': 'round' });
  const lBrow = mkEl<SVGPathElement>('path', { fill: 'none', stroke: c, 'stroke-width': '2', 'stroke-linecap': 'round' });
  const rBrow = mkEl<SVGPathElement>('path', { fill: 'none', stroke: c, 'stroke-width': '2', 'stroke-linecap': 'round' });
  const lEye  = mkEl<SVGEllipseElement>('ellipse', { fill: c });
  const rEye  = mkEl<SVGEllipseElement>('ellipse', { fill: c });
  const mouth = mkEl<SVGPathElement>('path', { fill: 'none', stroke: c, 'stroke-width': '2.2', 'stroke-linecap': 'round' });

  [shadow, lArm, rArm,
    body, lBrow, rBrow, lEye, rEye, mouth,
    ...compLines, ...tensLines,
    signGroup].forEach(el => svg.appendChild(el));

  const els: SVGEls = {
    shadow, lArm, rArm, signGroup, noteText,
    body, lBrow, rBrow, lEye, rEye, mouth,
    comp: compLines, tens: tensLines,
    allStroked: [lArm, rArm, signRect, body, lBrow, rBrow, mouth, ...compLines, ...tensLines],
    allFilled: [lEye, rEye, noteText],
  };
  return { svg, els };
}

export function TunerCharacter({ cents, color = 'white', note = '', playing = false, playingFreq = 110, width = 80, height = 160 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentCents = useRef(cents);
  const targetCents  = useRef(cents);
  const currentColor = useRef(color);
  const currentNote  = useRef(note);
  const playingRef      = useRef(playing);
  const playingFreqRef  = useRef(playingFreq);
  const rafId = useRef<number>();
  const elsRef = useRef<SVGEls | null>(null);

  useEffect(() => { targetCents.current = cents; }, [cents]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { playingFreqRef.current = playingFreq; }, [playingFreq]);

  useEffect(() => {
    currentColor.current = color;
    if (elsRef.current) {
      elsRef.current.allStroked.forEach(el => el.setAttribute('stroke', color));
      elsRef.current.allFilled.forEach(el => el.setAttribute('fill', color));
    }
  }, [color]);

  useEffect(() => {
    currentNote.current = note;
    if (elsRef.current) elsRef.current.noteText.textContent = note;
  }, [note]);

  useEffect(() => {
    if (!containerRef.current) return;
    const { svg, els } = buildSVG(currentColor.current);
    elsRef.current = els;
    containerRef.current.appendChild(svg);

    applyParams(els, computeParams(currentCents.current), currentNote.current);

    const tick = () => {
      if (playingRef.current) {
        // Lock to 0 cents (happy/in-tune pose) and wiggle arms
        currentCents.current += (0 - currentCents.current) * SPRING_K;
        const params = computeParams(currentCents.current);
        const { lArmD, rArmD } = wiggleArmPaths(performance.now() / 1000, playingFreqRef.current);
        applyParams(els, { ...params, lArmD, rArmD }, currentNote.current);
      } else {
        const diff = targetCents.current - currentCents.current;
        if (Math.abs(diff) > SETTLE_THRESHOLD) {
          currentCents.current += diff * SPRING_K;
          applyParams(els, computeParams(currentCents.current), currentNote.current);
        }
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      svg.remove();
      elsRef.current = null;
    };
  }, []);

  return (
    <View style={{ width, height }}>
      {/* @ts-ignore */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </View>
  );
}
