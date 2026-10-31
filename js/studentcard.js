// 학생 카드: 한 학생의 수업 기록(모든 선생님) · 출결 요약 · 테스트 성적 추이
import { api } from './api.js';
import { isAdmin, studentById, teacherById, slotById, versionFor, placementsOf, placementText, attendanceRate, pct } from './store.js';
import { esc, modal, guard, today, addMonths, fmtDate, toast } from './util.js';
import { lineChart, num } from './chart.js';

export async function openStudentCard(sid) {
  const s = studentById(sid);
  if (!s) return toast('학생 정보를 찾을 수 없습니다.', 'err');
  let months = 3;
  await modal({
    title: `${s.name} 학생 카드`,
    wide: true,
    body: '<div id="sc-body" class="loading">불러오는 중…</div>',
    foot: `${isAdmin() ? '<button class="btn" id="sc-report">월간 리포트 인쇄</button>' : ''}<button class="btn btn-primary" data-close>닫기</button>`,
    onMount: (el, close) => {
      const body = el.querySelector('#sc-body');
      const load = async () => {
        body.innerHTML = '<div class="loading">불러오는 중…</div>';
        const from = addMonths(today(), -months);
        const h = await guard(() => api.studentHistory(s.id, from, today()));
        body.className = '';
        body.innerHTML = cardHtml(s, h, months);
        body.querySelector('#sc-range').addEventListener('change', (e) => { months = Number(e.target.value); load(); });
      };
      load();
      el.querySelector('#sc-report')?.addEventListener('click', async () => {
        close();
        const { printReportsFor } = await import('./views/stats.js');
        printReportsFor([s.id], today().slice(0, 7));
      });
    },
  });
}

function cardHtml(s, h, months) {
  const v = versionFor(today());
  const ps = v ? placementsOf(v, s.id) : [];
  const recs = h.records;
  const cnt = { 출석: 0, 지각: 0, 결석: 0, 보강: 0, 조퇴: 0 };
  for (const r of recs) if (r.entry.att in cnt) cnt[r.entry.att]++;
  const rate = attendanceRate(cnt);
  return `
    <div class="sc-head">
      <div>
        <p class="sc-meta">${esc(s.grade || '학년 미입력')}${s.school ? ' · ' + esc(s.school) : ''}${s.enrolled_on ? ` · 등록 ${esc(s.enrolled_on)}` : ''}
          ${s.status !== 'active' ? ` <span class="badge badge-err">퇴원 ${esc(s.withdrawn_on || '')}</span>` : ''}</p>
        <div class="pills">${ps.map((p) => `<span class="pill">${esc(placementText(p))}</span>`).join('') || '<span class="subtle small">현재 시간표 배정 없음</span>'}</div>
      </div>
      <select id="sc-range" aria-label="기간">${[1, 3, 6, 12].map((m) => `<option value="${m}" ${m === months ? 'selected' : ''}>최근 ${m}개월</option>`).join('')}</select>
    </div>
    <div class="tiles">
      ${tile('출석률', pct(rate), rate != null && rate < 0.85 ? 'warn' : '')}
      ${tile('수업 기록', `${recs.length}회`)}
      ${tile('결석', `${cnt.결석}회`, cnt.결석 >= 3 ? 'warn' : '')}
      ${tile('지각', `${cnt.지각}회`)}
      ${tile('보강', `${cnt.보강}회`)}
    </div>
    <h3 class="sc-h">테스트 성적</h3>
    ${testsHtml(s, h.tests)}
    <h3 class="sc-h">수업 기록 <small class="subtle">(최근 ${months}개월, 최신순)</small></h3>
    <div class="table-scroll"><table class="list compact">
      <thead><tr><th>날짜</th><th>선생님</th><th>교시</th><th>출결</th><th>수업책/진도</th><th>숙제/보충</th><th>특이사항</th></tr></thead>
      <tbody>${recs.map((r) => `<tr class="${r.entry.att === '결석' ? 'is-warn' : ''}">
        <td class="nowrap">${fmtDate(r.log_date)}</td><td class="nowrap">${esc(teacherById(r.teacher_id)?.name || '')}</td>
        <td class="nowrap">${esc(slotById(r.key.split('|')[0])?.label || '')}</td><td>${esc(r.entry.att || '')}</td>
        <td>${esc(r.entry.progress || '')}</td><td>${esc(r.entry.homework || '')}</td><td>${esc(r.entry.note || '')}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">기록이 없습니다.</td></tr>'}</tbody>
    </table></div>`;
}

const tile = (label, value, tone = '') => `<div class="tile ${tone ? 'tile-' + tone : ''}"><span>${label}</span><b>${value}</b></div>`;

// 과목·제목별로 묶어 항목마다 꺾은선 + 표
export function testsHtml(s, tests) {
  if (!tests.length) return '<p class="subtle small">이 기간의 테스트 기록이 없습니다.</p>';
  const groups = {};
  for (const t of tests) (groups[t.subject || '기타'] ||= []).push(t);
  return Object.entries(groups).map(([subj, ts]) => {
    const items = [...new Set(ts.flatMap((t) => t.items))];
    const series = items.map((it) => ({
      name: it,
      points: ts.map((t) => ({ x: t.test_date, y: num(t.scores[s.id]?.[it]) })).filter((p) => p.y != null),
    })).filter((x) => x.points.length);
    return `<div class="sc-test"><h4>${esc(subj)}</h4>
      ${series.length ? `<div class="chart-grid">${series.map((x, i) => `<div><h5>${esc(x.name)}</h5>${lineChart([x], { width: 300, height: 140, color: i })}</div>`).join('')}</div>` : ''}
      <div class="table-scroll"><table class="list compact"><thead><tr><th>날짜</th><th>테스트</th>${items.map((i) => `<th>${esc(i)}</th>`).join('')}<th>비고</th></tr></thead>
      <tbody>${ts.slice().reverse().map((t) => `<tr><td class="nowrap">${fmtDate(t.test_date)}</td><td>${esc(t.title)}</td>
        ${items.map((i) => `<td>${esc(t.scores[s.id]?.[i] ?? '')}</td>`).join('')}<td>${esc(t.scores[s.id]?.note || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
  }).join('');
}

// 학생 이름 클릭 → 카드 (전역 위임)
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-student-card]');
  if (!a) return;
  e.preventDefault();
  openStudentCard(Number(a.dataset.studentCard));
});
export const studentLink = (sid, label) => `<button type="button" class="linklike sname" data-student-card="${sid}">${esc(label ?? studentById(sid)?.name ?? '')}</button>`;
