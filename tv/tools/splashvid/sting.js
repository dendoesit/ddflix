// Gentle, playful splash sting, synthesized from scratch (no samples): soft marimba/celesta plucks following the stroke draw,
// a celesta chime at the reveal (2.25 s), a light rising arpeggio (3.55 s) into a warm major resolve chord at the hold (TB = 4.6 s).
// No impacts, booms or noise whooshes. Mastered to about -21.5 LUFS integrated (BS.1770 K-weighting), peak <= -6.5 dBFS.
// usage: node sting.js out.wav
const fs = require('fs'), SR = 48000, DUR = 6.3, N = Math.round(SR * DUR), TB = 4.6;
const L = new Float32Array(N), R = new Float32Array(N);
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
// note: t0 s, midi, vel, pan(-1..1), kind ('mar' marimba, 'cel' celesta/bell, 'pad' warm chord voice)
function note(t0, m, v, pan, kind) {
  const f = hz(m), i0 = Math.round(t0 * SR), len = Math.min(N - i0, Math.round((kind === 'pad' ? 2.4 : kind === 'cel' ? 2.0 : 1.1) * SR));
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let k = 0; k < len; k++) {
    const u = k / SR, att = Math.min(1, u / (kind === 'pad' ? 0.25 : 0.004)); let s;
    if (kind === 'mar') s = Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 5) + .25 * Math.sin(2 * Math.PI * f * 4 * u) * Math.exp(-u * 22);
    else if (kind === 'cel') s = Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 2.2) + .3 * Math.sin(2 * Math.PI * f * 2 * u) * Math.exp(-u * 4) + .12 * Math.sin(2 * Math.PI * f * 3.01 * u) * Math.exp(-u * 7);
    else s = (Math.sin(2 * Math.PI * f * u) + .2 * Math.sin(4 * Math.PI * f * 1.002 * u)) * Math.exp(-u * .9) * (1 + .04 * Math.sin(2 * Math.PI * 5 * u));
    s *= att * v; L[i0 + k] += s * gl; R[i0 + k] += s * gr;
  }
}
// 1. stroke draw (0.3 - 2.1 s): sparse marimba plucks, C major pentatonic, wandering upward
[[0.35, 72], [0.62, 76], [0.9, 79], [1.18, 74], [1.45, 81], [1.72, 79], [1.98, 84]].forEach(([t, m], k) => note(t, m, .5, -.5 + k * .16, 'mar'));
// 2. reveal chime at 2.25 s: celesta C6 + G6
note(2.25, 84, .45, -.2, 'cel'); note(2.27, 91, .25, .25, 'cel');
// 3. light rising arpeggio 3.55 -> 4.45 s (C E G C E G), celesta
[72, 76, 79, 84, 88, 91].forEach((m, k) => note(3.55 + k * 0.17, m, .32 + k * .03, -.6 + k * .24, 'cel'));
// 4. warm happy resolve at TB: soft C major pad (C4 E4 G4 C5) + bell on top + marimba root
[60, 64, 67, 72].forEach((m, k) => note(TB, m, .2, k % 2 ? .3 : -.3, 'pad'));
note(TB, 96, .3, 0, 'cel'); note(TB + .02, 48, .35, 0, 'mar'); note(TB + .25, 100, .12, .4, 'cel');
// gentle fade-out over the last 1.2 s
for (let i = 0; i < N; i++) { const fo = Math.min(1, (DUR - i / SR) / 1.2); L[i] *= fo; R[i] *= fo; }
// loudness: BS.1770 K-weighting (shelf + high-pass biquads at 48 kHz), ungated mean square over the programme
function kw(x) {
  const bq = (b, a, inp) => { const o = new Float32Array(inp.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < inp.length; i++) { const y = b[0] * inp[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = inp[i]; y2 = y1; y1 = y; o[i] = y; } return o; };
  return bq([1, -2, 1], [1, -1.99004745483398, 0.99007225036621], bq([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x));
}
const lufs = (gain) => { const a = kw(L), b = kw(R); let s = 0; for (let i = 0; i < N; i++) s += a[i] * a[i] + b[i] * b[i]; return -0.691 + 10 * Math.log10(s / N * gain * gain); };
let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
let g = Math.pow(10, (-21.5 - lufs(1)) / 20); const ceil = Math.pow(10, -6.5 / 20); if (pk * g > ceil) g = ceil / pk;
const buf = Buffer.alloc(44 + N * 4); buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
fs.writeFileSync(process.argv[2], buf);
console.log('wav', DUR + 's', 'LUFS(ungated)', lufs(g).toFixed(1), 'peak dBFS', (20 * Math.log10(pk * g)).toFixed(1));
