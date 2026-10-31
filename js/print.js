// A4 인쇄: 업무일지(일자·선생님별 1장, 세로), 시간표(주간 가로 / 요일별·선생님별 세로)
import { state, slots, slotById, teacherById, studentById, cellOf, itemLabel, isStudentItem, logRows, versionFor, academyName, DAYS, dayOfDate } from './store.js';
import { esc, fmtDate, fmtDateTime, DAY_NAMES } from './util.js';
import { lineChart, num } from './chart.js';

function run(html, orientation) {
  const rootEl = document.getElementById('print-root');
  rootEl.innerHTML = html;
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.append(st); }
  st.textContent = `@page { size: A4 ${orientation}; margin: 8mm; }`;
  document.body.classList.add('printing');
  // 한 장에 맞게 축소: 시간표·업무일지 모두 A4 1장 (아주 긴 일지만 40% 밑으로는 줄이지 않음)
  const mm = rootEl.querySelector('.page')?.clientWidth / (orientation === 'landscape' ? 281 : 194) || 3.78;
  rootEl.querySelectorAll('.page').forEach((p) => {
    if (p.classList.contains('fit')) {
      const inner = p.firstElementChild;
      const scale = Math.min(1, p.clientHeight / inner.scrollHeight, p.clientWidth / inner.scrollWidth);
      if (scale < 1) inner.style.zoom = String(Math.floor(scale * 100) / 100);
    } else {
      // 폭을 1/z 배로 넓힌 뒤 z 배 축소 → 축소 후에도 A4 폭을 꽉 채움
      const avail = 277 * mm; // 4mm 여유 (글꼴·차트 반올림 오차)
      const h0 = p.scrollHeight;
      if (h0 <= avail) return;
      let z = Math.floor((avail / h0) * 100) / 100;
      while (z >= 0.4) {
        p.style.width = `${194 / z}mm`;
        const h = p.scrollHeight;
        if (h * z <= avail) break;
        z = Math.floor(Math.min(z - 0.01, avail / h) * 100) / 100;
      }
      z = Math.max(z, 0.4);
      p.style.width = `${194 / z}mm`;
      p.style.zoom = String(z);
      // 축소하면 작은 글씨 줄 높이가 반올림되어 예상보다 커질 수 있음 → 실제 높이로 다시 확인
      for (let i = 0; i < 10 && z > 0.4 && p.getBoundingClientRect().height > avail; i++) {
        z = Math.round((z - 0.02) * 100) / 100;
        p.style.width = `${194 / z}mm`;
        p.style.zoom = String(z);
      }
    }
  });
  const done = () => {
    document.body.classList.remove('printing');
    rootEl.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

const stamp = () => `<span class="pp-stamp">출력 ${fmtDateTime(new Date().toISOString())} · ${esc(state.user?.login_id || '')}</span>`;

// ---------- 업무일지 ----------
export function printWorklogs(pages) {
  const html = pages.map(({ date, teacherId, log }) => {
    const t = teacherById(teacherId);
    const rows = logRows(date, teacherId, log);
    const groups = [];
    for (const r of rows) {
      const g = groups[groups.length - 1];
      if (g && g.slot === r.slot) g.rows.push(r); else groups.push({ slot: r.slot, rows: [r] });
    }
    const v = versionFor(date);
    const body = groups.map((g) => g.rows.map((r, i) => {
      const e = log.entries?.[r.key] || {};
      const s = isStudentItem(r.item) ? studentById(r.item) : null;
      const note = i === 0 ? v?.grid?.[dayOfDate(date)]?.[g.slot]?.[teacherId]?.note : '';
      return `<tr class="${e.att === '결석' ? 'absent' : ''}">
        ${i === 0 ? `<th rowspan="${g.rows.length}" class="pp-slot">${esc(slotById(g.slot)?.label || g.slot)}${note ? `<small>${esc(note)}</small>` : ''}</th>` : ''}
        <td class="pp-name">${esc(itemLabel(r.item))}${s?.grade ? `<small>${esc(s.grade)}</small>` : ''}${r.extra ? '<small>(추가)</small>' : ''}</td>
        <td class="pp-att">${esc(e.att || '')}</td>
        <td>${esc(e.progress || '')}</td><td>${e.hwDone ? `<b class="pp-ox">${esc(e.hwDone)}</b> ` : ''}${esc(e.homework || '')}</td><td>${esc(e.note || '')}</td>
      </tr>`;
    }).join('')).join('');
    const present = rows.filter((r) => ['출석', '지각', '보강', '조퇴'].includes(log.entries?.[r.key]?.att)).length;
    const absent = rows.filter((r) => log.entries?.[r.key]?.att === '결석').length;
    return `<section class="page wl-page">
      <header class="pp-head">
        <h1><img class="pp-logo" src="img/mark.png" alt="">${esc(academyName())} 업무일지</h1>
        <table class="pp-meta"><tr>
          <th>날짜</th><td>${fmtDate(date)}</td><th>담당교사</th><td>${esc(t?.name || '')}</td>
          <th>인원</th><td>${rows.length}명 (출석 ${present} / 결석 ${absent})</td>
        </tr></table>
      </header>
      <table class="pp-table">
        <colgroup><col style="width:11%"><col style="width:12%"><col style="width:7%"><col style="width:28%"><col style="width:21%"><col style="width:21%"></colgroup>
        <thead><tr><th>교시</th><th>학생</th><th>출결</th><th>수업책/진도/프린트</th><th>숙제 (전날 O/X · 오늘)</th><th>특이사항</th></tr></thead>
        <tbody>${body || '<tr><td colspan="6" class="pp-empty">배정된 수업 없음</td></tr>'}</tbody>
      </table>
      <div class="pp-box"><h4>공지 및 전달사항</h4><div class="pre">${esc(log.notice || '')}</div></div>
      <div class="pp-box pp-box-tall"><h4>하루 평가 및 총평</h4><div class="pre">${esc(log.review || '')}</div></div>
      <footer class="pp-foot">
        ${stamp()}
        <table class="pp-sign"><tr><th>담당</th><td></td><th>원장</th><td></td></tr></table>
      </footer>
    </section>`;
  }).join('');
  run(html, 'portrait');
}

// ---------- 시간표 ----------
function cellHtml(v, d, s, tid) {
  const c = cellOf(v.grid, d, s, tid);
  return `<td>${c.note ? `<div class="pp-note">${esc(c.note)}</div>` : ''}${c.items.map((it) => {
    const st = isStudentItem(it) ? studentById(it) : null;
    return `<div class="${!isStudentItem(it) ? 'pp-label' : ''} ${st && st.status !== 'active' ? 'pp-out' : ''}">${esc(itemLabel(it))}</div>`;
  }).join('')}</td>`;
}
const slotTh = (s) => `<th class="pp-slot">${esc(s.label)}${s.time ? `<small>${esc(s.time)}</small>` : ''}</th>`;
const tth = (t, text) => `<th style="background:#fff;border-bottom:1.2mm solid ${esc(t.color)}">${esc(text)}</th>`;

export function printTimetable(v, mode, tids) {
  const ts = tids.map(teacherById).filter(Boolean);
  const title = (sub) => `<header class="pp-head"><h1><img class="pp-logo" src="img/mark.png" alt="">${esc(academyName())} 시간표 ${sub ? '· ' + esc(sub) : ''}</h1>
    <p>적용일 ${fmtDate(v.effective_from)} ${esc(v.title || '')}</p></header>`;
  let html = '';
  if (mode === 'week') {
    html = `<section class="page page-land fit"><div>
      ${title('주간')}
      <table class="pp-tt pp-tt-week"><thead>
        <tr><th rowspan="2">교시</th>${DAYS.map((d) => `<th colspan="${ts.length}" class="pp-day">${DAY_NAMES[d]}</th>`).join('')}</tr>
        <tr>${DAYS.map(() => ts.map((t) => tth(t, t.name.replace(/쌤$/, ''))).join('')).join('')}</tr>
      </thead><tbody>${slots().map((s) => `<tr>${slotTh(s)}${DAYS.map((d) => ts.map((t) => cellHtml(v, d, s.id, t.id)).join('')).join('')}</tr>`).join('')}</tbody></table>
      ${v.memo ? `<p class="pre pp-memo">${esc(v.memo)}</p>` : ''}${stamp()}</div></section>`;
    return run(html, 'landscape');
  }
  if (mode === 'days') {
    html = DAYS.map((d) => `<section class="page fit"><div>${title(DAY_NAMES[d] + '요일')}
      <table class="pp-tt"><thead><tr><th>교시</th>${ts.map((t) => tth(t, t.name)).join('')}</tr></thead>
      <tbody>${slots().map((s) => `<tr>${slotTh(s)}${ts.map((t) => cellHtml(v, d, s.id, t.id)).join('')}</tr>`).join('')}</tbody></table>${stamp()}</div></section>`).join('');
  } else {
    html = ts.map((t) => `<section class="page fit"><div>${title(t.name)}
      <table class="pp-tt"><thead><tr><th>교시</th>${DAYS.map((d) => tth(t, DAY_NAMES[d])).join('')}</tr></thead>
      <tbody>${slots().map((s) => `<tr>${slotTh(s)}${DAYS.map((d) => cellHtml(v, d, s.id, t.id)).join('')}</tr>`).join('')}</tbody></table>${stamp()}</div></section>`).join('');
  }
  run(html, 'portrait');
}

// ---------- 테스트 결과 (A4 세로 1장) ----------
export function printTest(t) {
  const ids = Object.keys(t.scores).map(Number)
    .sort((a, b) => (studentById(a)?.name || '').localeCompare(studentById(b)?.name || '', 'ko'));
  const avg = (i) => {
    const v = ids.map((id) => num(t.scores[id]?.[i])).filter((x) => x != null);
    return v.length ? (Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10) : '—';
  };
  const html = `<section class="page fit"><div>
    <header class="pp-head"><h1><img class="pp-logo" src="img/mark.png" alt="">${esc(academyName())} ${esc(t.title)}</h1>
      <p>${fmtDate(t.test_date)} · ${esc(t.subject)} · ${ids.length}명</p></header>
    <table class="pp-table">
      <thead><tr><th style="width:10%">NO</th><th style="width:22%">이름</th>${t.items.map((i) => `<th>${esc(i)}</th>`).join('')}<th>비고</th></tr></thead>
      <tbody>${ids.map((id, n) => `<tr><td class="pp-att">${n + 1}</td><td class="pp-name">${esc(studentById(id)?.name || '')}<small>${esc(studentById(id)?.grade || '')}</small></td>
        ${t.items.map((i) => `<td class="pp-att">${esc(t.scores[id]?.[i] ?? '')}</td>`).join('')}<td>${esc(t.scores[id]?.note || '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="2">평균</th>${t.items.map((i) => `<th>${avg(i)}</th>`).join('')}<th></th></tr></tfoot>
    </table>
    ${t.memo ? `<div class="pp-box"><h4>메모</h4><div class="pre">${esc(t.memo)}</div></div>` : ''}
    ${stamp()}</div></section>`;
  run(html, 'portrait');
}

// ---------- 월간 학습 리포트 (학생마다 A4 세로 1장) ----------
export function printMonthlyReports(reports, { notes = false } = {}) {
  const [y, m] = (reports[0]?.month || '').split('-');
  const html = reports.map(({ student: s, records, stats: st, tests }) => {
    const present = st.출석 + st.지각 + st.보강 + st.조퇴;
    const rate = present + st.결석 ? Math.round((present / (present + st.결석)) * 100) + '%' : '—';
    const hwO = records.filter((r) => r.hwDone === 'O').length, hwX = records.filter((r) => r.hwDone === 'X').length;
    const hwRate = hwO + hwX ? Math.round((hwO / (hwO + hwX)) * 100) + '%' : '—';
    const groups = {};
    for (const t of tests) (groups[t.subject || '기타'] ||= []).push(t);
    const testBlock = Object.entries(groups).map(([subj, ts]) => {
      const items = [...new Set(ts.flatMap((t) => t.items))];
      const series = items.map((it) => ({ name: it, points: ts.map((t) => ({ x: t.test_date, y: num(t.scores[s.id]?.[it]) })).filter((p) => p.y != null) }))
        .filter((x) => x.points.length);
      return `<div class="rp-test"><h4>${esc(subj)}</h4>
        <table class="pp-table"><thead><tr><th>날짜</th><th>테스트</th>${items.map((i) => `<th>${esc(i)}</th>`).join('')}<th>비고</th></tr></thead>
        <tbody>${ts.map((t) => `<tr><td>${t.test_date.slice(5).replace('-', '/')}</td><td>${esc(t.title)}</td>${items.map((i) => `<td class="pp-att">${esc(t.scores[s.id]?.[i] ?? '')}</td>`).join('')}<td>${esc(t.scores[s.id]?.note || '')}</td></tr>`).join('')}</tbody></table>
        ${series.length && ts.length > 1 ? `<div class="rp-charts">${series.map((x, i) => `<div><h5>${esc(x.name)}</h5>${lineChart([x], { width: 300, height: 120, color: i })}</div>`).join('')}</div>` : ''}</div>`;
    }).join('');
    return `<section class="page wl-page">
      <header class="pp-head"><h1><img class="pp-logo" src="img/mark.png" alt="">${esc(academyName())} 월간 학습 리포트</h1>
        <p><b>${esc(s?.name || '')}</b> ${esc(s?.grade || '')} · ${y}년 ${Number(m)}월</p></header>
      <table class="pp-meta rp-sum"><tr>
        <th>수업</th><td>${st.sessions}회</td><th>출석</th><td>${st.출석}</td><th>지각</th><td>${st.지각}</td>
        <th>결석</th><td>${st.결석}</td><th>보강</th><td>${st.보강}</td><th>출석률</th><td><b>${rate}</b></td>
        <th>숙제</th><td><b>${hwRate}</b> <small>(O ${hwO} · X ${hwX})</small></td></tr></table>
      <h3 class="rp-h">수업 기록</h3>
      <table class="pp-table">
        <colgroup><col style="width:11%"><col style="width:10%"><col style="width:8%">${notes ? '<col style="width:29%"><col style="width:21%"><col style="width:21%">' : '<col style="width:41%"><col style="width:30%">'}</colgroup>
        <thead><tr><th>날짜</th><th>선생님</th><th>출결</th><th>수업 진도</th><th>숙제</th>${notes ? '<th>특이사항</th>' : ''}</tr></thead>
        <tbody>${records.map((r) => `<tr class="${r.att === '결석' ? 'absent' : ''}"><td>${fmtDate(r.date).slice(5)}</td><td>${esc(r.teacher.replace(/쌤$/, ''))}</td>
          <td class="pp-att">${esc(r.att || '')}</td><td>${esc(r.progress || '')}</td><td>${r.hwDone ? `<b class="pp-ox">전날 ${esc(r.hwDone)}</b> ` : ''}${esc(r.homework || '')}</td>${notes ? `<td>${esc(r.note || '')}</td>` : ''}</tr>`).join('')
          || `<tr><td colspan="${notes ? 6 : 5}" class="pp-empty">수업 기록 없음</td></tr>`}</tbody>
      </table>
      ${tests.length ? `<h3 class="rp-h">테스트 성적</h3>${testBlock}` : ''}
      <div class="pp-box pp-box-tall"><h4>선생님 의견</h4></div>
      <footer class="pp-foot">${stamp()}<table class="pp-sign"><tr><th>담당</th><td></td><th>원장</th><td></td></tr></table></footer>
    </section>`;
  }).join('');
  run(html, 'portrait');
}