// Shared SVG generation logic for the tuner character.
// ViewBox: 0 0 100 200
// Layout: sign (y 5–49) → arms → body/face (y 86–168)

type Keyframe = {
  body: [number, number][];
  shadow: number;
  lBrow: number[];
  rBrow: number[];
  lEye: number[];
  rEye: number[];
  mouth: number[];
  lHand: [number, number]; // where left arm attaches to body
  rHand: [number, number];
};

// All body/face coords are original + 40 (shifted down to make room for sign)

const FLAT: Keyframe = {
  body: [
    [50,132],[73,131],[94,140],[94,150],
    [94,160],[73,168],[50,168],
    [27,168],[6,160],[6,150],
    [6,140],[27,131],
  ],
  shadow: 38,
  lBrow: [26,124, 35,127.5, 44,131],
  rBrow: [56,131, 65,127.5, 74,124],
  lEye: [35.5,147, 8.5,1.2],
  rEye: [64.5,147, 8.5,1.2],
  mouth: [31,160, 50,160, 69,160],
  lHand: [6, 143],
  rHand: [94, 143],
};

const GOOD: Keyframe = {
  body: [
    [50,86],[75,85],[91,102],[90,124],
    [89,148],[73,164],[50,164],
    [27,164],[10,148],[9,124],
    [8,101],[25,87],
  ],
  shadow: 30,
  lBrow: [27,109, 36,104, 44,108],
  rBrow: [56,108, 64,104, 73,109],
  lEye: [36,119, 3.5,3.5],
  rEye: [64,119, 3.5,3.5],
  mouth: [38,132, 50,143, 62,132],
  lHand: [12, 115],
  rHand: [88, 115],
};

const SHARP: Keyframe = {
  body: [
    [50,50],[52,50],[90,92],[90,124],
    [90,152],[73,164],[50,164],
    [27,164],[10,152],[10,124],
    [10,92],[48,50],
  ],
  shadow: 30,
  lBrow: [30,117, 37,111, 44,110],
  rBrow: [56,110, 63,111, 70,117],
  lEye: [36,119, 3.5,3.5],
  rEye: [64,119, 3.5,3.5],
  mouth: [37,137, 50,128, 62,137],
  lHand: [12, 120],
  rHand: [88, 120],
};

// Sign geometry (fixed)
export const SIGN_X = 4, SIGN_Y = 4, SIGN_W = 92, SIGN_H = 56, SIGN_R = 8;
export const SIGN_BOTTOM = SIGN_Y + SIGN_H; // 60
export const SIGN_LEFT = SIGN_X;            // 4
export const SIGN_RIGHT = SIGN_X + SIGN_W;  // 96
export const SIGN_CX = SIGN_X + SIGN_W / 2; // 50 — rotation pivot x
export const SIGN_CY = SIGN_Y + SIGN_H / 2; // 32 — rotation pivot y
// Max sign tilt in degrees at ±50 cents
const MAX_TILT_DEG = 10;

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function lerpArr(a: number[], b: number[], t: number) { return a.map((v, i) => lerp(v, b[i], t)); }
function lerpPt(a: [number, number], b: [number, number], t: number): [number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}
function r(v: number) { return Math.round(v * 10) / 10; }

function interpKeyframes(a: Keyframe, b: Keyframe, t: number): Keyframe {
  return {
    body: a.body.map((pt, i) => [lerp(pt[0], b.body[i][0], t), lerp(pt[1], b.body[i][1], t)] as [number, number]),
    shadow: lerp(a.shadow, b.shadow, t),
    lBrow: lerpArr(a.lBrow, b.lBrow, t),
    rBrow: lerpArr(a.rBrow, b.rBrow, t),
    lEye:  lerpArr(a.lEye,  b.lEye,  t),
    rEye:  lerpArr(a.rEye,  b.rEye,  t),
    mouth: lerpArr(a.mouth, b.mouth, t),
    lHand: lerpPt(a.lHand, b.lHand, t),
    rHand: lerpPt(a.rHand, b.rHand, t),
  };
}

export function bodyPath(pts: [number, number][]) {
  const p = pts.map(pt => pt.map(r));
  return [
    `M ${p[0][0]} ${p[0][1]}`,
    `C ${p[1][0]} ${p[1][1]}, ${p[2][0]} ${p[2][1]}, ${p[3][0]} ${p[3][1]}`,
    `C ${p[4][0]} ${p[4][1]}, ${p[5][0]} ${p[5][1]}, ${p[6][0]} ${p[6][1]}`,
    `C ${p[7][0]} ${p[7][1]}, ${p[8][0]} ${p[8][1]}, ${p[9][0]} ${p[9][1]}`,
    `C ${p[10][0]} ${p[10][1]}, ${p[11][0]} ${p[11][1]}, ${p[0][0]} ${p[0][1]} Z`,
  ].join(' ');
}

function armPaths(lHand: [number, number], rHand: [number, number]) {
  const lhx = r(lHand[0]), lhy = r(lHand[1]);
  const rhx = r(rHand[0]), rhy = r(rHand[1]);
  const lcx = r(lhx - 6), lcy = r((lhy + SIGN_BOTTOM) / 2);
  const rcx = r(rhx + 6), rcy = r((rhy + SIGN_BOTTOM) / 2);
  return {
    lArm: `M ${lhx} ${lhy} Q ${lcx} ${lcy}, ${SIGN_LEFT} ${SIGN_BOTTOM}`,
    rArm: `M ${rhx} ${rhy} Q ${rcx} ${rcy}, ${SIGN_RIGHT} ${SIGN_BOTTOM}`,
  };
}

// ─── Computed params (for web direct DOM updates) ─────────────────────────────

export type TunerParams = {
  shadowRx: number;
  bodyD: string;
  lBrowD: string;
  rBrowD: string;
  lEye: { cx: number; cy: number; rx: number; ry: number };
  rEye: { cx: number; cy: number; rx: number; ry: number };
  mouthD: string;
  lArmD: string;
  rArmD: string;
  signRotation: number; // degrees — negative = tilt left (flat), positive = tilt right (sharp)
  compOp: number;
  tensOp: number;
  topY: number;
};

export function computeParams(cents: number): TunerParams {
  const clamped = Math.max(-50, Math.min(50, cents));
  const params = clamped <= 0
    ? interpKeyframes(FLAT, GOOD, (clamped + 50) / 50)
    : interpKeyframes(GOOD, SHARP, clamped / 50);

  const [lbx1, lby1, lbcx, lbcy, lbx2, lby2] = params.lBrow.map(r);
  const [rbx1, rby1, rbcx, rbcy, rbx2, rby2] = params.rBrow.map(r);
  const [mx1, my1, mcx, mcy, mx2, my2] = params.mouth.map(r);
  const [lecx, lecy, lerx, lery] = params.lEye.map(r);
  const [recx, recy, rerx, rery] = params.rEye.map(r);
  const { lArm, rArm } = armPaths(params.lHand, params.rHand);

  return {
    shadowRx: r(params.shadow),
    bodyD: bodyPath(params.body),
    lBrowD: `M ${lbx1} ${lby1} Q ${lbcx} ${lbcy} ${lbx2} ${lby2}`,
    rBrowD: `M ${rbx1} ${rby1} Q ${rbcx} ${rbcy} ${rbx2} ${rby2}`,
    lEye: { cx: lecx, cy: lecy, rx: lerx, ry: lery },
    rEye: { cx: recx, cy: recy, rx: rerx, ry: rery },
    mouthD: `M ${mx1} ${my1} Q ${mcx} ${mcy} ${mx2} ${my2}`,
    lArmD: lArm,
    rArmD: rArm,
    signRotation: r((clamped / 50) * MAX_TILT_DEG),
    compOp: clamped <= -30 ? r(((Math.abs(clamped) - 30) / 20) * 0.5) : 0,
    tensOp: clamped >= 30  ? r(((clamped - 30) / 20) * 0.5) : 0,
    topY: r(params.body[0][1]),
  };
}

// ─── Full SVG string (native Image fallback) ─────────────────────────────────

export function generateSvg(cents: number, strokeColor: string, note = ''): string {
  const p = computeParams(cents);
  const ty = p.topY;
  const c = strokeColor;
  const rot = `rotate(${p.signRotation}, ${SIGN_CX}, ${SIGN_CY})`;

  let extra = '';
  if (p.compOp > 0) {
    extra = `
  <line x1="36" y1="${r(ty-13)}" x2="36" y2="${r(ty-6)}" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="${p.compOp}"/>
  <line x1="50" y1="${r(ty-15)}" x2="50" y2="${r(ty-8)}" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="${p.compOp}"/>
  <line x1="64" y1="${r(ty-13)}" x2="64" y2="${r(ty-6)}" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="${p.compOp}"/>`;
  }
  if (p.tensOp > 0) {
    extra = `
  <line x1="22" y1="117" x2="28" y2="120" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="${p.tensOp}"/>
  <line x1="20" y1="127" x2="26" y2="126" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="${p.tensOp}"/>
  <line x1="72" y1="120" x2="78" y2="117" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="${p.tensOp}"/>
  <line x1="74" y1="126" x2="80" y2="127" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="${p.tensOp}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200">
  <ellipse cx="50" cy="193" rx="${p.shadowRx}" ry="4" fill="rgba(0,0,0,0.10)"/>

  <!-- Arms (behind body) -->
  <path d="${p.lArmD}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
  <path d="${p.rArmD}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>

  <!-- Body (black fill so arms don't show through) -->
  <path d="${p.bodyD}" fill="#000" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>

  <!-- Eyebrows -->
  <path d="${p.lBrowD}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>
  <path d="${p.rBrowD}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>

  <!-- Eyes -->
  <ellipse cx="${p.lEye.cx}" cy="${p.lEye.cy}" rx="${p.lEye.rx}" ry="${p.lEye.ry}" fill="${c}"/>
  <ellipse cx="${p.rEye.cx}" cy="${p.rEye.cy}" rx="${p.rEye.rx}" ry="${p.rEye.ry}" fill="${c}"/>

  <!-- Mouth -->
  <path d="${p.mouthD}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
${extra}
  <!-- Sign (on top — black fill so body doesn't show through) -->
  <g transform="${rot}">
    <rect x="${SIGN_X}" y="${SIGN_Y}" width="${SIGN_W}" height="${SIGN_H}" rx="${SIGN_R}"
          fill="#000" stroke="${c}" stroke-width="2"/>
    <text x="${SIGN_CX}" y="${SIGN_CY + 4}" text-anchor="middle" dominant-baseline="middle"
          fill="${c}" font-size="28" font-weight="800"
          font-family="system-ui,sans-serif">${note}</text>
  </g>
</svg>`;
}
