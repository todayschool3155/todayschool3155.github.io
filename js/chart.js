// 작은 SVG 꺾은선 차트 (성적 추이) — 축 1개, 얇은 선, 끝점 직접 라벨, 마우스를 올리면 값 표시
import { esc } from './util.js?v=202611092336';

// 로고 초록·주황 + 보조 남색 (색약 검증 통과 팔레트, 순서 고정)
export const SERIES_COLORS = ['#0c8a68', '#c8690b', '#5b6bbf'];

// series: [{ name, points: [{ x: 'YYYY-MM-DD', y: number, label?: string }] }]
// 서로 단위가 다른 항목(예: 듣기 10점, 문법 100점)은 한 차트에 넣지 말고 항목마다 따로 그림
export function lineChart(series, { width = 560, height = 200, unit = '', color = null } = {}) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return '<p class="subtle small">점수 기록이 없습니다.</p>';
  const xs = [...new Set(all.map((p) => p.x))].sort();
  const ymaxRaw = Math.max(...all.map((p) => p.y));
  const ymax = niceMax(ymaxRaw);
  const pad = { l: 34, r: series.length > 1 ? 70 : 34, t: 12, b: 26 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const X = (x) => pad.l + (xs.length === 1 ? w / 2 : (xs.indexOf(x) / (xs.length - 1)) * w);
  const Y = (y) => pad.t + h - (y / ymax) * h;
  const ticks = [0, ymax / 2, ymax];
  const grid = ticks.map((t) => `<line x1="${pad.l}" x2="${pad.l + w}" y1="${Y(t)}" y2="${Y(t)}" class="ch-grid"/>
    <text x="${pad.l - 6}" y="${Y(t) + 4}" class="ch-axis" text-anchor="end">${fmt(t)}</text>`).join('');
  const step = Math.max(1, Math.ceil(xs.length / 6));
  const xlabels = xs.map((x, i) => (i % step === 0 || i === xs.length - 1)
    ? `<text x="${X(x)}" y="${height - 8}" class="ch-axis" text-anchor="middle">${x.slice(5).replace('-', '/')}</text>` : '').join('');
  const lines = series.map((s, i) => {
    const c = SERIES_COLORS[(color ?? i) % SERIES_COLORS.length];
    const pts = s.points.slice().sort((a, b) => a.x.localeCompare(b.x));
    if (!pts.length) return '';
    const d = pts.map((p, j) => `${j ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    const last = pts[pts.length - 1];
    const marks = pts.map((p) => `<g class="ch-pt"><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="10" class="ch-hit"/>
      <circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4" fill="${c}" stroke="var(--surface,#fff)" stroke-width="2"/>
      <title>${esc(s.name)} · ${p.x} · ${fmt(p.y)}${unit}${p.label ? ' · ' + esc(p.label) : ''}</title></g>`).join('');
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${marks}
      <text x="${X(last.x) + 8}" y="${Y(last.y) + 4}" class="ch-label">${series.length > 1 ? esc(s.name) + ' ' : ''}${fmt(last.y)}</text>`;
  }).join('');
  const legend = series.length > 1 ? `<div class="ch-legend">${series.map((s, i) =>
    `<span><i style="background:${SERIES_COLORS[i % SERIES_COLORS.length]}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `${legend}<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))} 점수 추이">
    ${grid}${xlabels}${lines}</svg>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// 시험 점수 문자열 → 숫자 (숫자가 아니면 null: "병결", "-", "재시험")
export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && /\d/.test(String(v)) ? n : null;
};
