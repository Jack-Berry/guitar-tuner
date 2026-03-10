const fs = require('fs');
const path = require('path');
const OUT = __dirname;

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpArr(a, b, t) { return a.map((v, i) => lerp(v, b[i], t)); }
function r(v) { return Math.round(v * 10) / 10; }

// ─── Keyframes ────────────────────────────────────────────────────────────────
// Body: 12 control points [top, rc1, rc2, right, bc1, bc2, bottom, lc1, lc2, left, tc1, tc2]

const FLAT = {
  body: [
    [50,92],[73,91],[94,100],[94,110],
    [94,120],[73,128],[50,128],
    [27,128],[6,120],[6,110],
    [6,100],[27,91]
  ],
  shadow: 38,
  // Brows: [x1,y1, cx,cy, x2,y2] — Q bezier; ctrl at midpoint = straight line
  lBrow: [26, 84,  35, 87.5, 44, 91],
  rBrow: [56, 91,  65, 87.5, 74, 84],
  // Eyes: [cx, cy, rx, ry]
  lEye: [35.5, 107, 8.5, 1.2],
  rEye: [64.5, 107, 8.5, 1.2],
  // Mouth: [x1,y1, cx,cy, x2,y2] — Q bezier; ctrl on line = flat
  mouth: [31, 120, 50, 120, 69, 120],
};

const GOOD = {
  body: [
    [50,46],[75,45],[91,62],[90,84],
    [89,108],[73,124],[50,124],
    [27,124],[10,108],[9,84],
    [8,61],[25,47]
  ],
  shadow: 30,
  lBrow: [27, 69, 36, 64, 44, 68],
  rBrow: [56, 68, 64, 64, 73, 69],
  lEye: [36, 79, 3.5, 3.5],
  rEye: [64, 79, 3.5, 3.5],
  mouth: [38, 92, 50, 103, 62, 92],  // ctrl below = smile
};

const SHARP = {
  body: [
    [50,10],[52,10],[90,52],[90,84],
    [90,112],[73,124],[50,124],
    [27,124],[10,112],[10,84],
    [10,52],[48,10]
  ],
  shadow: 30,
  lBrow: [30, 77, 37, 71, 44, 70],
  rBrow: [56, 70, 63, 71, 70, 77],
  lEye: [36, 79, 3.5, 3.5],
  rEye: [64, 79, 3.5, 3.5],
  mouth: [37, 97, 50, 88, 62, 97],  // ctrl above = distressed arch
};

// ─── Interpolation ────────────────────────────────────────────────────────────

function interp(a, b, t) {
  return {
    body:   a.body.map((pt, i) => lerpArr(pt, b.body[i], t)),
    shadow: lerp(a.shadow, b.shadow, t),
    lBrow:  lerpArr(a.lBrow, b.lBrow, t),
    rBrow:  lerpArr(a.rBrow, b.rBrow, t),
    lEye:   lerpArr(a.lEye,  b.lEye,  t),
    rEye:   lerpArr(a.rEye,  b.rEye,  t),
    mouth:  lerpArr(a.mouth, b.mouth, t),
  };
}

function bodyPath(pts) {
  const p = pts.map(pt => pt.map(r));
  return [
    `M ${p[0][0]} ${p[0][1]}`,
    `C ${p[1][0]} ${p[1][1]}, ${p[2][0]} ${p[2][1]}, ${p[3][0]} ${p[3][1]}`,
    `C ${p[4][0]} ${p[4][1]}, ${p[5][0]} ${p[5][1]}, ${p[6][0]} ${p[6][1]}`,
    `C ${p[7][0]} ${p[7][1]}, ${p[8][0]} ${p[8][1]}, ${p[9][0]} ${p[9][1]}`,
    `C ${p[10][0]} ${p[10][1]}, ${p[11][0]} ${p[11][1]}, ${p[0][0]} ${p[0][1]} Z`,
  ].join(' ');
}

// ─── SVG generator ───────────────────────────────────────────────────────────

function generate(cents) {
  let params;
  if (cents <= 0) {
    params = interp(FLAT, GOOD, (cents + 50) / 50);
  } else {
    params = interp(GOOD, SHARP, cents / 50);
  }

  const [lbx1, lby1, lbcx, lbcy, lbx2, lby2] = params.lBrow.map(r);
  const [rbx1, rby1, rbcx, rbcy, rbx2, rby2] = params.rBrow.map(r);
  const [lecx, lecy, lerx, lery] = params.lEye.map(r);
  const [recx, recy, rerx, rery] = params.rEye.map(r);
  const [mx1, my1, mcx, mcy, mx2, my2] = params.mouth.map(r);

  // Compression marks fade in below -30 cents
  let extra = '';
  if (cents <= -30) {
    const op = r(((Math.abs(cents) - 30) / 20) * 0.5);
    const ty = r(params.body[0][1]);
    extra = `
  <line x1="36" y1="${r(ty-13)}" x2="36" y2="${r(ty-6)}"  stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="${op}"/>
  <line x1="50" y1="${r(ty-15)}" x2="50" y2="${r(ty-8)}"  stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="${op}"/>
  <line x1="64" y1="${r(ty-13)}" x2="64" y2="${r(ty-6)}"  stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="${op}"/>`;
  }

  // Tension marks fade in above +30 cents
  if (cents >= 30) {
    const op = r(((cents - 30) / 20) * 0.5);
    extra = `
  <line x1="22" y1="77" x2="28" y2="80" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="${op}"/>
  <line x1="20" y1="87" x2="26" y2="86" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="${op}"/>
  <line x1="72" y1="80" x2="78" y2="77" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="${op}"/>
  <line x1="74" y1="86" x2="80" y2="87" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="${op}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160">

  <!-- Drop shadow -->
  <ellipse cx="50" cy="150" rx="${r(params.shadow)}" ry="4" fill="rgba(0,0,0,0.10)"/>${extra}

  <!-- Body -->
  <path d="${bodyPath(params.body)}"
        fill="none" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>

  <!-- Eyebrows -->
  <path d="M ${lbx1} ${lby1} Q ${lbcx} ${lbcy} ${lbx2} ${lby2}"
        fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <path d="M ${rbx1} ${rby1} Q ${rbcx} ${rbcy} ${rbx2} ${rby2}"
        fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/>

  <!-- Eyes -->
  <ellipse cx="${lecx}" cy="${lecy}" rx="${lerx}" ry="${lery}" fill="white"/>
  <ellipse cx="${recx}" cy="${recy}" rx="${rerx}" ry="${rery}" fill="white"/>

  <!-- Mouth -->
  <path d="M ${mx1} ${my1} Q ${mcx} ${mcy} ${mx2} ${my2}"
        fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"/>

</svg>`;
}

// ─── Write files ──────────────────────────────────────────────────────────────

for (let cents = -50; cents <= 50; cents += 5) {
  const svg = generate(cents);
  const sign = cents > 0 ? '+' : '';
  const name = `tuner_${sign}${cents}.svg`;
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log('Written', name);
}

// ─── Update preview.html ──────────────────────────────────────────────────────

const cards = [];
for (let cents = -50; cents <= 50; cents += 5) {
  const sign = cents > 0 ? '+' : '';
  const name = `tuner_${sign}${cents}.svg`;
  cards.push(`    <div class="card">
      <img src="${name}" alt="${sign}${cents}">
      <span>${sign}${cents}</span>
    </div>`);
}

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tuner Character Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d0d0d;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 40px 20px;
      font-family: monospace;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      justify-content: center;
      align-items: flex-end;
    }
    .card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .card img { width: 60px; height: 96px; }
    .card span { color: #444; font-size: 10px; }
  </style>
</head>
<body>
  <div class="row">
${cards.join('\n')}
  </div>
</body>
</html>`;

fs.writeFileSync(path.join(OUT, 'preview.html'), html);
console.log('Updated preview.html');
console.log('Done!');
