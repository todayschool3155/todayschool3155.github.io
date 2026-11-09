// 홈 대시보드: 오늘 수업 · 일지 미작성 알림 · 숙제 현황 · 이번 달 출결 · 주의 학생 · 최근 테스트 · 최근 변경
import { api } from '../api.js?v=202611092336';
import {
  state, isAdmin, academyName, teacherById, studentById, slots, worklogRows, isStudentItem, holidayOf, holidays,
  isClassDay, alertRange, trackingStart, missingLogs, homeworkStatus, refreshNotices, sortNotices, noticeState, isMyNotice, noticeApplies, alerts, attendanceStats, attendanceRate, pct, versionFor,
} from '../store.js?v=202611092336';
import { esc, today, addDays, fmtDate, fmtDateTime, fmtTime, guard, DAY_NAMES, weekday } from '../util.js?v=202611092336';
import { studentLink } from '../studentcard.js?v=202611092336';
import { noticeCard, ensureUsers } from './notices.js?v=202611092336';
import { num } from '../chart.js?v=202611092336';

export async function render(el) {
  el.innerHTML = '<div class="loading">불러오는 중…</div>';
  const admin = isAdmin();
  const myTid = state.user.teacher_id;
  const tids = admin ? state.teachers.filter((t) => t.active).map((t) => t.id) : myTid ? [myTid] : [];
  const monthFrom = `${today().slice(0, 7)}-01`;
  const from = [monthFrom, addDays(today(), -60)].sort()[0];
  const [logs, tests, audit] = await Promise.all([
    tids.length ? guard(() => api.getWorklogs(from, today(), admin ? null : myTid)) : [],
    guard(() => api.getTests(addDays(today(), -35), today())),
    admin ? api.getAudit(addDays(today(), -7), today(), 300).catch(() => []) : [],
  ]);

  const [nlist] = await Promise.all([refreshNotices().catch(() => []), ensureUsers()]);
  const { from: af, to: at } = alertRange(logs);
  const missing = missingLogs(logs, af, at, tids);
  alerts.missing = missing; alerts.checkedAt = Date.now();
  window.dispatchEvent(new Event('alerts-changed'));
  const byKey = Object.fromEntries(logs.map((w) => [`${w.log_date}|${w.teacher_id}`, w]));
  const t0 = today();
  const hol = holidayOf(t0);
  const monthLogs = logs.filter((w) => w.log_date >= monthFrom);
  const stats = attendanceStats(monthLogs, [monthFrom, trackingStart(logs)].sort()[1], t0, tids);
  const tot = [...stats.values()].reduce((a, s) => { for (const k of ['sessions', '출석', '지각', '결석', '보강', '조퇴', 'none']) a[k] = (a[k] || 0) + s[k]; return a; }, {});
  // 숙제 현황: 최근 7일 (전날 숙제 X = 안 함, 체크 안 함 = 미체크)
  const hwFrom = [addDays(t0, -6), trackingStart(logs)].sort()[1];
  const hw = homeworkStatus(logs, hwFrom, t0, tids);
  const notDoneBy = {};
  for (const x of hw.notDone) (notDoneBy[x.sid] ||= []).push(x);
  const notDoneList = Object.entries(notDoneBy).sort((a, b) => b[1].length - a[1].length);
  const uncheckedBy = {};
  for (const x of hw.unchecked) {
    const k = `${x.teacherId}|${x.date}`;
    (uncheckedBy[k] ||= { ...x, n: 0 }).n++;
  }
  const uncheckedList = Object.values(uncheckedBy).sort((a, b) => b.date.localeCompare(a.date));
  const hwChecked = hw.done + hw.notDone.length;
  const hwHtml = `
    <h3 class="sc-h">숙제 안 한 학생 <small class="subtle">${notDoneList.length}명 · ${hw.notDone.length}회</small></h3>
    ${notDoneList.length ? `<ul class="plain-list hw-list">${notDoneList.slice(0, 15).map(([sid, xs]) => `<li>
        ${studentLink(Number(sid))} <span class="cnt">${xs.length}회</span>
        <span class="small subtle">${xs.map((x) => `${x.date.slice(5).replace('-', '/')} ${esc(teacherById(x.teacherId)?.name || '')} · ${esc(x.hw)}`).join(' / ')}</span></li>`).join('')}</ul>`
      : '<p class="ok-line">✓ 숙제를 안 한 학생이 없습니다.</p>'}
    <h3 class="sc-h">숙제 확인 안 됨 <small class="subtle">${hw.unchecked.length}명</small></h3>
    ${uncheckedList.length ? `<ul class="plain-list hw-list">${uncheckedList.slice(0, 12).map((x) => `<li>
        <a href="#/worklog/${x.date}/${x.teacherId}">${fmtDate(x.date)}</a>${admin ? ` <b>${esc(teacherById(x.teacherId)?.name || '')}</b>` : ''}
        <span class="small subtle">O/X 미체크 ${x.n}명</span></li>`).join('')}</ul>`
      : '<p class="ok-line">✓ 전날 숙제를 모두 확인했습니다.</p>'}`;
  const watch = [...stats.entries()].filter(([, s]) => s.결석 >= 3).sort((a, b) => b[1].결석 - a[1].결석);
  const todayRows = (tid) => worklogRows(t0, tid).filter((r) => isStudentItem(r.item));
  const todayPeople = tids.reduce((n, tid) => n + todayRows(tid).length, 0);
  const active = state.students.filter((s) => s.status === 'active').length;
  const newThisMonth = state.students.filter((s) => (s.enrolled_on || '') >= monthFrom).length;
  const outThisMonth = state.students.filter((s) => (s.withdrawn_on || '') >= monthFrom).length;
  const nextHol = holidays().filter((h) => h.date >= t0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const upcoming = state.versions.filter((v) => v.effective_from > t0);

  const statusOf = (tid) => {
    const w = byKey[`${t0}|${tid}`];
    if (!todayRows(tid).length && !w) return '<span class="subtle">수업 없음</span>';
    if (w?.done) return '<span class="badge badge-ok">작성 완료</span>';
    if (w) return `<span class="badge badge-warn">작성 중 · ${fmtTime(w.updated_at)}</span>`;
    return '<span class="badge">미작성</span>';
  };

  const missHtml = missing.length ? `<ul class="alarm-list">${missing.slice(0, 12).map((m) => `<li>
      <a href="#/worklog/${m.date}/${m.teacherId}">${fmtDate(m.date)}</a>
      ${admin ? `<b>${esc(teacherById(m.teacherId)?.name || '')}</b>` : ''} <span class="subtle">${m.rows}건</span></li>`).join('')}
      ${missing.length > 12 ? `<li class="subtle">… 외 ${missing.length - 12}건</li>` : ''}</ul>`
    : '<p class="ok-line">✓ 밀린 업무일지가 없습니다.</p>';

  const mySchedule = !admin && myTid ? `<section class="card">
      <div class="card-head"><h2>오늘 내 수업</h2><a class="btn btn-sm btn-primary" href="#/worklog/${t0}/${myTid}">오늘 일지 쓰기</a></div>
      ${hol ? `<p class="subtle">오늘은 휴원일입니다 (${esc(hol.name)}).</p>` : worklogRows(t0, myTid).length ? `<div class="today-slots">${slots().map((s) => {
        const rs = worklogRows(t0, myTid).filter((r) => r.slot === s.id);
        const n = rs.filter((r) => isStudentItem(r.item)).length;
        return rs.length ? `<div><b>${esc(s.label)}</b> ${n ? `<span class="subtle">${n}명</span>` : ''}<div class="small">${rs.map((r) => (isStudentItem(r.item) ? studentLink(r.item) : esc(r.item))).join(', ')}</div></div>` : '';
      }).join('')}</div><p class="small">일지 상태: ${statusOf(myTid)}</p>` : '<p class="subtle">오늘은 시간표상 수업이 없습니다.</p>'}
    </section>` : '';

  const testsHtml = tests.length ? `<ul class="plain-list">${tests.slice(0, 5).map((t) => {
      const avgs = t.items.map((i) => {
        const v = Object.values(t.scores).map((x) => num(x[i])).filter((x) => x != null);
        return `${esc(i)} ${v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : '—'}`;
      }).join(' · ');
      return `<li><a href="#/tests">${fmtDate(t.test_date)} ${esc(t.title)}</a> <span class="tag tag-${t.subject === '수학' ? 'math' : 'eng'}">${esc(t.subject)}</span>
        <div class="small subtle">${Object.keys(t.scores).length}명 · 평균 ${avgs}</div></li>`;
    }).join('')}</ul>` : '<p class="subtle">최근 5주간 입력된 테스트가 없습니다. <a href="#/tests">성적 입력</a></p>';

  const ACT = { timetable_update: '시간표 수정', timetable_create: '시간표 버전 생성', student_create: '신규 등록', student_withdraw: '퇴원',
    student_reactivate: '재등록', teacher_retire: '선생님 퇴사', user_delete: '계정 삭제', test_save: '성적 입력', password_reset: '비번 초기화', user_create: '계정 생성', teacher_create: '선생님 추가' };
  const changes = audit.filter((a) => ACT[a.action]).slice(0, 8);

  el.innerHTML = `
    <div class="home-head">
      <div><h1>${esc(academyName())}</h1><p class="subtle">${fmtDate(t0)} · ${esc(state.user.name || state.user.login_id)}님${hol ? ` · <b>휴원일 (${esc(hol.name)})</b>` : ''}</p></div>
    </div>

    ${missing.length ? `<div class="alert-box alert-red"><b>🔔 작성하지 않은 업무일지 ${missing.length}건</b>
      <span class="small">${admin ? '선생님별 목록은 아래를 확인하세요.' : '아래 날짜를 눌러 작성해 주세요.'}</span></div>` : ''}

    <div class="tiles">
      ${admin ? `<div class="tile"><span>재원생</span><b>${active}명</b><small>이번 달 신규 ${newThisMonth} · 퇴원 ${outThisMonth}</small></div>` : ''}
      <div class="tile"><span>오늘 수업</span><b>${hol ? '휴원' : `${todayPeople}명`}</b><small>${DAY_NAMES[weekday(t0)] || '주말'}요일 · 연인원</small></div>
      <div class="tile ${missing.length ? 'tile-alarm' : ''}"><span>밀린 업무일지</span><b>${missing.length}건</b><small>최근 14일</small></div>
      <div class="tile"><span>이번 달 출석률</span><b>${pct(attendanceRate(tot))}</b><small>결석 ${tot.결석 || 0}회 · 미기록 ${tot.none || 0}</small></div>
      <div class="tile ${hw.notDone.length ? 'tile-warn' : ''}"><span>숙제 안 함 (7일)</span><b>${notDoneList.length}명</b><small>완료율 ${hwChecked ? Math.round((hw.done / hwChecked) * 100) + '%' : '—'} · 미체크 ${hw.unchecked.length}</small></div>
      ${admin ? `<div class="tile ${watch.length ? 'tile-warn' : ''}"><span>주의 학생</span><b>${watch.length}명</b><small>이번 달 결석 3회+</small></div>` : ''}
    </div>

    ${(() => {
      const live = sortNotices(nlist).filter((n) => noticeState(n) !== 'past' && isMyNotice(n));
      const todayN = live.filter((n) => noticeApplies(n, t0, admin ? null : myTid));
      return `<section class="card notice-home">
        <div class="card-head"><h2>📢 공지사항 ${todayN.length ? `<small class="subtle">오늘 ${todayN.length}건</small>` : ''}</h2>
          <a class="btn btn-sm" href="#/notices">${admin ? '공지 작성·관리' : '전체 보기'}</a></div>
        ${live.length ? `<div class="notice-list">${live.slice(0, 4).map((n) => noticeCard(n, { compact: true })).join('')}</div>
          ${live.length > 4 ? `<p class="small"><a href="#/notices">진행·예정 공지 ${live.length - 4}건 더 보기</a></p>` : ''}`
          : '<p class="subtle">진행 중인 공지가 없습니다.</p>'}
      </section>`;
    })()}
    <div class="home-grid">
      ${mySchedule}
      <section class="card">
        <div class="card-head"><h2>밀린 업무일지</h2>${af <= at ? `<span class="subtle small">${af.slice(5).replace('-', '/')} ~ ${at.slice(5).replace('-', '/')}</span>` : ''}</div>
        ${missHtml}
      </section>
      <section class="card">
        <div class="card-head"><h2>숙제 현황</h2>${hwFrom <= t0 ? `<span class="subtle small">${hwFrom.slice(5).replace('-', '/')} ~ ${t0.slice(5).replace('-', '/')}</span>` : ''}</div>
        ${hwHtml}
      </section>
      ${admin ? `<section class="card">
        <div class="card-head"><h2>오늘 일지 현황</h2><a class="btn btn-sm" href="#/worklog/${t0}/all">주간 현황</a></div>
        <table class="list compact">${tids.map((tid) => `<tr><td><b>${esc(teacherById(tid)?.name)}</b></td><td>${todayRows(tid).length}명</td>
          <td><a href="#/worklog/${t0}/${tid}">${statusOf(tid)}</a></td></tr>`).join('')}</table>
      </section>` : ''}
      ${admin ? `<section class="card">
        <div class="card-head"><h2>주의 학생</h2><a class="btn btn-sm" href="#/stats">출결 통계</a></div>
        ${watch.length ? `<ul class="plain-list">${watch.slice(0, 10).map(([sid, s]) => `<li>${studentLink(sid)} <span class="badge badge-err">결석 ${s.결석}</span>
          <span class="small subtle">출석률 ${pct(attendanceRate(s))}</span></li>`).join('')}</ul>` : '<p class="ok-line">✓ 이번 달 결석 3회 이상 학생이 없습니다.</p>'}
      </section>` : ''}
      <section class="card">
        <div class="card-head"><h2>최근 테스트</h2><a class="btn btn-sm" href="#/tests">성적</a></div>
        ${testsHtml}
      </section>
      ${admin ? `<section class="card">
        <div class="card-head"><h2>최근 변경</h2><a class="btn btn-sm" href="#/audit">로그</a></div>
        ${changes.length ? `<ul class="plain-list small">${changes.map((a) => `<li><span class="subtle">${fmtDateTime(a.at).slice(5)}</span> <b>${esc(a.login_id)}</b> ${ACT[a.action]} <span class="subtle">${esc(a.target)}</span></li>`).join('')}</ul>`
          : '<p class="subtle">최근 7일간 변경이 없습니다.</p>'}
      </section>` : ''}
      ${(upcoming.length || nextHol.length) ? `<section class="card">
        <div class="card-head"><h2>예정</h2></div>
        <ul class="plain-list small">
          ${upcoming.map((v) => `<li><a href="#/timetable">${fmtDate(v.effective_from)}</a> 새 시간표 적용 <span class="subtle">${esc(v.title)}</span></li>`).join('')}
          ${nextHol.map((h) => `<li>${fmtDate(h.date)} 휴원 <span class="subtle">${esc(h.name)}</span></li>`).join('')}
        </ul></section>` : ''}
    </div>`;
}
