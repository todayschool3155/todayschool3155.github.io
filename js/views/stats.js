// 통계 (관리자): 월별 학생 출결, 선생님별 일지 작성, 월간 리포트 인쇄
import { api } from '../api.js';
import {
  state, studentById, teacherById, slotById, logRows, isStudentItem, isClassDay, missingLogs, trackingStart, holidayOf,
  attendanceStats, attendanceRate, pct,
} from '../store.js';
import { esc, $, today, addDays, addMonths, datesBetween, guard, toast, formModal } from '../util.js';
import { studentLink } from '../studentcard.js';
import { printMonthlyReports } from '../print.js';

let root, month = today().slice(0, 7), sortKey = '결석', data = null;

// 재직 선생님 + 그 기간에 일지가 있는 퇴사 선생님
const teachersFor = (logs) => state.teachers.filter((t) => t.active || logs.some((w) => w.teacher_id === t.id)).map((t) => t.id);

const monthRange = (m) => {
  const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
};

export async function render(el) {
  root = el;
  await load();
}

async function load() {
  root.innerHTML = '<div class="loading">불러오는 중…</div>';
  const { from, to } = monthRange(month);
  const logs = await guard(() => api.getWorklogs(from, to));
  const tids = teachersFor(logs);
  const start = [from, trackingStart(logs)].sort()[1];
  const stats = attendanceStats(logs, start, to, tids);
  data = { from: start, to, logs, tids, stats };
  draw();
}

function draw() {
  const { from, to, logs, tids, stats } = data;
  const rows = [...stats.entries()].map(([sid, s]) => ({ sid, s, rate: attendanceRate(s), name: studentById(sid)?.name || '' }));
  const sorters = {
    결석: (a, b) => b.s.결석 - a.s.결석 || a.name.localeCompare(b.name, 'ko'),
    출석률: (a, b) => (a.rate ?? 2) - (b.rate ?? 2),
    이름: (a, b) => a.name.localeCompare(b.name, 'ko'),
    미기록: (a, b) => b.s.none - a.s.none,
  };
  rows.sort(sorters[sortKey]);
  const tot = rows.reduce((t, r) => { for (const k of ['sessions', '출석', '지각', '결석', '보강', '조퇴', 'none']) t[k] = (t[k] || 0) + r.s[k]; return t; }, {});
  const watch = rows.filter((r) => r.s.결석 >= 3);
  const end = [to, addDays(today(), -1)].sort()[0];
  const missing = missingLogs(logs, from, end, tids);
  const classDays = datesBetween(from, [to, today()].sort()[0]).filter(isClassDay).length;

  root.innerHTML = `
    <div class="toolbar">
      <div class="tb-group">
        <button class="icon-btn" id="st-prev" aria-label="이전 달">◀</button>
        <input type="month" id="st-month" value="${month}">
        <button class="icon-btn" id="st-next" aria-label="다음 달">▶</button>
      </div>
      <div class="tb-group"><button class="btn btn-primary" id="st-report">월간 리포트 인쇄</button></div>
    </div>
    <div class="tiles">
      <div class="tile"><span>수업일</span><b>${classDays}일</b></div>
      <div class="tile"><span>연인원 (수업 수)</span><b>${tot.sessions || 0}</b></div>
      <div class="tile"><span>출석률</span><b>${pct(attendanceRate(tot))}</b></div>
      <div class="tile ${tot.결석 ? 'tile-warn' : ''}"><span>결석</span><b>${tot.결석 || 0}회</b></div>
      <div class="tile ${tot.none ? 'tile-warn' : ''}"><span>출결 미기록</span><b>${tot.none || 0}건</b></div>
    </div>
    ${watch.length ? `<div class="alert-box"><b>⚠ 주의 학생 (이번 달 결석 3회 이상)</b> ${watch.map((r) => `${studentLink(r.sid)} (${r.s.결석}회)`).join(', ')}</div>` : ''}

    <section class="card">
      <div class="card-head"><h2>선생님별 업무일지</h2></div>
      <div class="table-scroll"><table class="list">
        <thead><tr><th>선생님</th><th>수업일</th><th>작성</th><th>작성 완료</th><th>미작성</th><th>연인원</th></tr></thead>
        <tbody>${tids.map((tid) => {
          const days = datesBetween(from, [to, today()].sort()[0]).filter((d) => isClassDay(d) && logRows(d, tid, { entries: {} }).length);
          const mine = logs.filter((w) => w.teacher_id === tid);
          const miss = missing.filter((m) => m.teacherId === tid);
          const people = days.reduce((n, d) => n + logRows(d, tid, mine.find((w) => w.log_date === d) || { entries: {} }).filter((r) => isStudentItem(r.item)).length, 0);
          return `<tr><td><b>${esc(teacherById(tid)?.name)}</b>${teacherById(tid)?.active ? '' : ' <span class="badge badge-err">퇴사</span>'}</td><td>${days.length}일</td><td>${mine.length}</td><td>${mine.filter((w) => w.done).length}</td>
            <td>${miss.length ? `<span class="badge badge-err">${miss.length}</span> <span class="small">${miss.slice(0, 6).map((m) => `<a href="#/worklog/${m.date}/${tid}">${m.date.slice(5).replace('-', '/')}</a>`).join(' ')}${miss.length > 6 ? ' …' : ''}</span>` : '0'}</td>
            <td>${people}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>학생별 출결 <small class="subtle">${rows.length}명</small></h2>
        <div class="seg">${Object.keys(sorters).map((k) => `<button data-sort="${k}" class="${k === sortKey ? 'on' : ''}">${k}순</button>`).join('')}</div></div>
      <div class="table-scroll"><table class="list compact">
        <thead><tr><th><input type="checkbox" id="st-all" aria-label="전체 선택"></th><th>학생</th><th>수업</th><th>출석</th><th>지각</th><th>결석</th><th>보강</th><th>조퇴</th><th>미기록</th><th>출석률</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.s.결석 >= 3 ? 'is-warn' : ''}">
          <td><input type="checkbox" class="st-pick" value="${r.sid}" aria-label="선택"></td>
          <td class="nowrap">${studentLink(r.sid)} <small class="subtle">${esc(studentById(r.sid)?.grade || '')}</small></td>
          <td>${r.s.sessions}</td><td>${r.s.출석}</td><td>${r.s.지각}</td><td><b>${r.s.결석}</b></td><td>${r.s.보강}</td><td>${r.s.조퇴}</td>
          <td class="${r.s.none ? 'subtle' : ''}">${r.s.none}</td><td><b>${pct(r.rate)}</b></td></tr>`).join('') || '<tr><td colspan="10" class="empty">기록이 없습니다.</td></tr>'}</tbody>
      </table></div>
      <p class="subtle small">출석률 = (출석+지각+보강+조퇴) ÷ (출결을 기록한 수업). "미기록"은 업무일지에 출결을 체크하지 않은 수업입니다.</p>
    </section>`;

  $('#st-month').addEventListener('change', (e) => { if (e.target.value) { month = e.target.value; load(); } });
  $('#st-prev').addEventListener('click', () => { month = addMonths(`${month}-01`, -1).slice(0, 7); load(); });
  $('#st-next').addEventListener('click', () => { month = addMonths(`${month}-01`, 1).slice(0, 7); load(); });
  root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { sortKey = b.dataset.sort; draw(); }));
  $('#st-all').addEventListener('change', (e) => root.querySelectorAll('.st-pick').forEach((c) => { c.checked = e.target.checked; }));
  $('#st-report').addEventListener('click', async () => {
    const picked = [...root.querySelectorAll('.st-pick:checked')].map((c) => Number(c.value));
    const f = await formModal('월간 리포트 인쇄 (학생마다 A4 1장)', [
      { name: 'who', label: '대상', type: 'select', value: picked.length ? 'picked' : 'all', options: [
        { value: 'picked', label: `선택한 학생 (${picked.length}명)` },
        { value: 'watch', label: `주의 학생 (${watch.length}명)` },
        { value: 'all', label: `전체 (${rows.length}명)` },
      ] },
      { name: 'notes', label: '', type: 'checkbox', value: false, text: '특이사항(선생님 내부 메모) 포함' },
    ], { ok: '인쇄' });
    if (!f) return;
    const ids = f.who === 'picked' ? picked : f.who === 'watch' ? watch.map((r) => r.sid) : rows.map((r) => r.sid);
    if (!ids.length) return toast('대상 학생이 없습니다.', 'warn');
    printReportsFor(ids, month, { notes: f.notes, logs, stats });
  });
}

// 월간 리포트 데이터 모아서 인쇄 (학생 카드에서도 호출)
export async function printReportsFor(ids, m, pre = {}) {
  const { from, to } = monthRange(m);
  const logs = pre.logs || await guard(() => api.getWorklogs(from, to));
  const tids = teachersFor(logs);
  const stats = pre.stats || attendanceStats(logs, [from, trackingStart(logs)].sort()[1], to, tids);
  const tests = await guard(() => api.getTests(from, to));
  const byKey = Object.fromEntries(logs.map((w) => [`${w.log_date}|${w.teacher_id}`, w]));
  const start = [from, trackingStart(logs)].sort()[1];
  const reports = ids.map((sid) => {
    const recs = [];
    for (const d of datesBetween(start, [to, today()].sort()[0])) for (const tid of tids) {
      if (holidayOf(d)) continue;
      const log = byKey[`${d}|${tid}`] || { entries: {}, extras: [] };
      for (const r of logRows(d, tid, log)) if (r.item === sid) {
        const e = log.entries?.[r.key] || {};
        recs.push({ date: d, teacher: teacherById(tid)?.name || '', slot: slotById(r.slot)?.label || '', ...e });
      }
    }
    return {
      student: studentById(sid), month: m, records: recs,
      stats: stats.get(sid) || { sessions: 0, 출석: 0, 지각: 0, 결석: 0, 보강: 0, 조퇴: 0, none: 0 },
      tests: tests.filter((t) => t.scores?.[sid]).sort((a, b) => a.test_date.localeCompare(b.test_date)),
    };
  });
  printMonthlyReports(reports, { notes: !!pre.notes });
}
