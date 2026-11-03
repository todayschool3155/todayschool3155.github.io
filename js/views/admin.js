// 관리: 선생님, 로그인 계정, 교시, 학원명, 데이터 보관/백업
import { api, DEMO } from '../api.js?v=202611032203';
import { state, reload, slots, teacherById, academyName, holidays, versionFor, applyFromDate, cellOf, setCell, DAYS } from '../store.js?v=202611032203';
import { esc, $, today, addDays, addMonths, fmtDateTime, toast, guard, formModal, confirmBox, download, modal } from '../util.js?v=202611032203';
import { exportWorklogsXlsx } from '../excel.js?v=202611032203';

let root, users = [], stats = null, showRetired = false;
// 학원 로고 3색(노랑·주황·초록)의 밝은 단계 — 시간표 칸 배경용
const LOGO_PALETTE = ['#fff1b8', '#ffe27a', '#fcc70d', '#ffc870', '#f9b26b', '#f5911e', '#bfebdd', '#8eddc4', '#16b68c'];

export async function render(el) {
  root = el;
  [users, stats] = await Promise.all([guard(() => api.listUsers()), guard(() => api.stats())]);
  draw();
}

function draw() {
  root.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>선생님</h2>
        <div class="row-actions">
          <label class="check small"><input type="checkbox" data-a="t-toggle" ${showRetired ? 'checked' : ''}> 퇴사자 보기 (${state.teachers.filter((t) => !t.active).length})</label>
          <button class="btn btn-primary btn-sm" data-a="t-add">+ 선생님 추가</button></div></div>
      <p class="subtle small">선생님은 삭제하지 않고 <b>퇴사 처리</b>합니다. 퇴사해도 그동안의 업무일지·시간표·성적은 그대로 보관되고, 업무일지 화면에서 언제든 조회할 수 있습니다.</p>
      <div class="table-scroll"><table class="list">
        <thead><tr><th>정렬</th><th>이름</th><th>과목</th><th>색</th><th>로그인 아이디</th><th>상태</th><th></th></tr></thead>
        <tbody>${state.teachers.filter((t) => t.active || showRetired).map((t) => {
          const us = users.filter((x) => x.teacher_id === t.id);
          return `<tr class="${t.active ? '' : 'is-out'}"><td>${t.sort}</td><td><b>${esc(t.name)}</b></td><td>${esc(t.subject)}</td>
            <td><span class="swatch" style="background:${esc(t.color)}"></span></td>
            <td>${us.length ? us.map((u) => esc(u.login_id) + (u.active ? '' : ' <span class="subtle small">(중지)</span>')).join(', ') : '<span class="subtle">없음</span>'}</td>
            <td>${t.active ? '재직' : `<span class="badge badge-err">퇴사 ${esc(t.retired_on || '')}</span>`}</td>
            <td class="row-actions"><button class="btn btn-sm" data-a="t-edit" data-id="${t.id}">수정</button>
              ${t.active ? `<button class="btn btn-sm btn-danger" data-a="t-retire" data-id="${t.id}">퇴사 처리</button>`
                : `<button class="btn btn-sm" data-a="t-rehire" data-id="${t.id}">복직</button>`}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>로그인 계정</h2><button class="btn btn-primary btn-sm" data-a="u-add">+ 계정 추가</button></div>
      <p class="subtle small">새 계정과 비밀번호 초기화 시 비밀번호는 <b>today1234</b> 입니다.
        계정을 <b>삭제</b>해도 그 선생님의 업무일지·성적·로그 기록은 지워지지 않습니다.</p>
      <div class="table-scroll"><table class="list">
        <thead><tr><th>아이디</th><th>이름</th><th>권한</th><th>연결 선생님</th><th>최근 로그인</th><th>상태</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr class="${u.active ? '' : 'is-out'}">
          <td><b>${esc(u.login_id)}</b>${u.must_change ? ' <span class="badge badge-warn" title="초기 비밀번호 사용 중">초기비번</span>' : ''}</td>
          <td>${esc(u.name)}</td><td>${u.role === 'admin' ? '관리자' : '선생님'}</td>
          <td>${esc(teacherById(u.teacher_id)?.name || '')}</td>
          <td class="small">${fmtDateTime(u.last_login) || '<span class="subtle">없음</span>'}</td>
          <td>${u.active ? '사용' : '<span class="badge badge-err">중지</span>'}</td>
          <td class="row-actions"><button class="btn btn-sm" data-a="u-edit" data-id="${u.id}">수정</button>
            <button class="btn btn-sm" data-a="u-reset" data-id="${u.id}">비번 초기화</button>
            ${u.id !== state.user.id ? `<button class="btn btn-sm btn-danger" data-a="u-del" data-id="${u.id}">삭제</button>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>교시 설정</h2><button class="btn btn-sm" data-a="s-edit">수정</button></div>
      <div class="pills">${slots().map((s) => `<span class="pill"><b>${esc(s.label)}</b> ${esc(s.time || '')}</span>`).join('')}</div>
      <p class="subtle">학원명: <b>${esc(academyName())}</b> <button class="linklike" data-a="name">변경</button></p>
    </section>

    <section class="card">
      <div class="card-head"><h2>휴원일 · 미작성 알림</h2><button class="btn btn-sm" data-a="hol">수정</button></div>
      <p class="subtle small">휴원일에는 업무일지 미작성 알림이 뜨지 않고 출결 통계에서도 빠집니다.</p>
      <div class="pills">${holidays().filter((h) => h.date >= today().slice(0, 4)).sort((a, b) => a.date.localeCompare(b.date))
        .map((h) => `<span class="pill">${esc(h.date.slice(5).replace('-', '/'))} ${esc(h.name)}</span>`).join('') || '<span class="subtle small">등록된 휴원일 없음</span>'}</div>
      <p class="subtle small">미작성 알림 시작일: <b>${esc(state.settings.alerts?.from || '처음 저장된 일지 날짜부터 (자동)')}</b> · 최근 14일 범위만 알림</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>데이터 보관 · 백업</h2></div>
      <ul class="stats">
        <li>업무일지 <b>${stats.worklogs}</b>건${stats.worklogs_oldest ? ` (가장 오래된 일지 ${esc(stats.worklogs_oldest)})` : ''}</li>
        <li>1년 지난 일지 <b>${stats.worklogs_over_1y}</b>건</li>
        <li>시간표 버전 <b>${stats.versions}</b>개 · 학생 <b>${stats.students}</b>명 · 로그 <b>${stats.audit}</b>건 (로그는 400일 후 자동 삭제)</li>
      </ul>
      <div class="btn-row">
        <button class="btn" data-a="x-month">업무일지 엑셀 (월별)</button>
        <button class="btn" data-a="x-json">전체 백업 파일(JSON)</button>
        <button class="btn btn-danger" data-a="purge" ${stats.worklogs_over_1y ? '' : 'disabled'}>1년 지난 일지 정리</button>
      </div>
      <p class="subtle">업무일지는 최소 1년 보관됩니다. 매월 초 지난달 일지를 엑셀로 내려받아 두면 안전합니다.</p>
      ${DEMO ? '<p><button class="btn btn-danger btn-sm" data-a="demo-reset">데모 데이터 초기화</button></p>' : ''}
    </section>`;
  root.onclick = onClick;
}

async function refresh() {
  await reload();
  [users, stats] = await Promise.all([api.listUsers(), api.stats()]);
  draw();
}

async function onClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const id = Number(b.dataset.id);
  const a = b.dataset.a;
  if (a === 't-toggle') { showRetired = b.checked; return draw(); }
  if (a === 't-add' || a === 't-edit') return editTeacher(a === 't-edit' ? teacherById(id) : null);
  if (a === 't-retire') return retireTeacher(teacherById(id));
  if (a === 't-rehire') return rehireTeacher(teacherById(id));
  if (a === 'u-del') return deleteUser(users.find((u) => u.id === id));
  if (a === 'u-add' || a === 'u-edit') return editUser(a === 'u-edit' ? users.find((u) => u.id === id) : null);
  if (a === 'u-reset') {
    const u = users.find((x) => x.id === id);
    if (!(await confirmBox(`${u.login_id} 계정의 비밀번호를 today1234 로 초기화할까요?`))) return;
    await guard(() => api.resetPassword(id), '초기화했습니다.');
    return refresh();
  }
  if (a === 's-edit') return editSlots();
  if (a === 'hol') return editHolidays();
  if (a === 'name') {
    const f = await formModal('학원명', [{ name: 'name', label: '학원명', value: academyName(), required: true }]);
    if (!f) return;
    await guard(() => api.saveSettings('academy', { ...(state.settings.academy || {}), name: f.name }), '변경했습니다.');
    return location.reload();
  }
  if (a === 'x-month') {
    const f = await formModal('업무일지 엑셀 내보내기', [
      { name: 'month', label: '월', type: 'month', value: addMonths(today(), -1).slice(0, 7), required: true },
    ], { ok: '내려받기' });
    if (!f) return;
    const last = new Date(Number(f.month.slice(0, 4)), Number(f.month.slice(5)), 0).getDate();
    return guard(() => exportWorklogsXlsx(`${f.month}-01`, `${f.month}-${String(last).padStart(2, '0')}`));
  }
  if (a === 'x-json') {
    const data = await guard(() => api.exportAll());
    return download(`오늘학원_백업_${today()}.json`, JSON.stringify(data, null, 1));
  }
  if (a === 'purge') {
    const before = addMonths(today(), -12);
    if (!(await confirmBox(`${before} 이전 업무일지 ${stats.worklogs_over_1y}건을 삭제합니다.\n먼저 "전체 백업 파일"을 내려받았는지 확인하세요.\n삭제 후에는 되돌릴 수 없습니다.`, { ok: '삭제', danger: true }))) return;
    const n = await guard(() => api.purgeWorklogs(before));
    toast(`${n}건 삭제했습니다.`);
    return refresh();
  }
  if (a === 'demo-reset') {
    if (!(await confirmBox('이 브라우저의 데모 데이터를 모두 지우고 처음 상태로 돌립니다.', { danger: true }))) return;
    api.resetDemo();
    location.reload();
  }
}

async function editTeacher(t) {
  const u = t && users.find((x) => x.teacher_id === t.id);
  const f = await formModal(t ? `${t.name} 수정` : '선생님 추가', [
    { name: 'name', label: '이름 (시간표 표시명)', value: t?.name, required: true, placeholder: '예: 애니쌤' },
    { name: 'subject', label: '과목', value: t?.subject, placeholder: '수학 / 영어' },
    { name: 'color', label: '색', type: 'color', value: t?.color || '#dbeafe' },
    { name: 'sort', label: '정렬 번호 (시간표 열 순서)', type: 'number', value: t?.sort ?? (Math.max(0, ...state.teachers.map((x) => x.sort)) + 1) },
    ...(t ? [] : [{ name: 'login_id', label: '로그인 아이디 (영문, 비밀번호는 today1234)', required: true, placeholder: '예: annie' }]),
  ], { extra: `<div class="field"><label>로고 색상 추천 (수학: 노랑·주황 / 영어: 초록)</label><div class="palette">${LOGO_PALETTE.map((c) =>
    `<button type="button" class="swatch" style="background:${c}" title="${c}" onclick="document.getElementById('f_color').value='${c}'"></button>`).join('')}</div></div>` });
  if (!f) return;
  const { login_id, ...tp } = f;
  const saved = await guard(() => api.saveTeacher({ ...(t || {}), ...tp, sort: Number(tp.sort) }), '저장했습니다.');
  if (!t && login_id) await guard(() => api.saveUser({ login_id, name: saved.name, role: 'teacher', teacher_id: saved.id }), `계정 ${login_id} 생성 (비밀번호 today1234)`);
  refresh();
}

// ---------- 퇴사 · 복직 · 계정 삭제 (기록은 모두 보관) ----------
function classCount(tid, date) {
  const v = versionFor(date);
  let n = 0;
  for (const d of DAYS) for (const s of slots()) n += cellOf(v?.grid, d, s.id, tid).items.length;
  return n;
}

async function retireTeacher(t) {
  const others = state.teachers.filter((x) => x.active && x.id !== t.id)
    .sort((a, b) => (b.subject === t.subject) - (a.subject === t.subject));
  const us = users.filter((x) => x.teacher_id === t.id);
  const n = classCount(t.id, today());
  const res = await modal({
    title: `${t.name} 퇴사 처리`,
    body: `<p class="subtle small">퇴사해도 <b>지금까지의 업무일지·시간표·성적·로그는 모두 보관</b>됩니다. 화면 목록에서만 숨겨지고, 업무일지 화면의 "퇴사한 선생님"에서 언제든 볼 수 있습니다.</p>
      <div class="field"><label for="rt-date">퇴사일 (마지막 수업 다음 날)</label><input type="date" id="rt-date" value="${today()}"></div>
      <div class="field"><label for="rt-mode">담당 수업 (현재 시간표 ${n}명·회)</label>
        <select id="rt-mode">
          ${others.map((o) => `<option value="${o.id}">다른 선생님에게 넘기기 → ${esc(o.name)} (${esc(o.subject)})</option>`).join('')}
          <option value="clear">시간표에서 비우기 (나중에 직접 배치)</option>
          <option value="keep">그대로 두기</option>
        </select>
        <small class="hint">퇴사일부터의 시간표에만 적용됩니다. 그 전 시간표와 일지는 바뀌지 않습니다.</small></div>
      ${us.length ? `<label class="check"><input type="checkbox" id="rt-acc" checked> 로그인 계정 사용 중지 (${us.map((u) => esc(u.login_id)).join(', ')})</label>` : ''}`,
    foot: '<button class="btn" data-close>취소</button><button class="btn btn-danger" id="rt-ok">퇴사 처리</button>',
    onMount: (el, close) => el.querySelector('#rt-ok').addEventListener('click', () => close({
      date: el.querySelector('#rt-date').value || today(), mode: el.querySelector('#rt-mode').value, acc: !!el.querySelector('#rt-acc')?.checked,
    })),
  });
  if (!res) return;
  if (res.mode !== 'keep' && classCount(t.id, res.date)) {
    const to = res.mode === 'clear' ? null : Number(res.mode);
    await guard(() => applyFromDate(res.date, (g) => {
      for (const d of DAYS) for (const s of slots()) {
        const mine = cellOf(g, d, s.id, t.id);
        if (!mine.items.length && !mine.note) continue;
        if (to) {
          const dest = cellOf(g, d, s.id, to);
          const items = [...dest.items, ...mine.items.filter((x) => !dest.items.includes(x))];
          setCell(g, d, s.id, to, { items, note: dest.note || mine.note });
        }
        setCell(g, d, s.id, t.id, { items: [], note: '' });
      }
    }, `${t.name} 퇴사`, [`${t.name} 퇴사 — 담당 수업 ${to ? teacherById(to).name + '에게 이관' : '비움'} (${res.date}부터)`]));
  }
  await guard(() => api.saveTeacher({ ...t, active: false, retired_on: res.date }));
  if (res.acc) for (const u of us) if (u.active) await guard(() => api.saveUser({ ...u, active: false }));
  toast(`${t.name} 퇴사 처리했습니다. 기록은 모두 보관됩니다.`);
  refresh();
}

async function rehireTeacher(t) {
  if (!(await confirmBox(`${t.name} 선생님을 복직(재직) 상태로 돌릴까요?\n시간표 배치는 시간표 편집에서 다시 해 주세요.`))) return;
  await guard(() => api.saveTeacher({ ...t, active: true, retired_on: null }));
  const us = users.filter((x) => x.teacher_id === t.id && !x.active);
  if (us.length && (await confirmBox(`로그인 계정(${us.map((u) => u.login_id).join(', ')})도 다시 사용하게 할까요?`)))
    for (const u of us) await guard(() => api.saveUser({ ...u, active: true }));
  toast(`${t.name} 복직 처리했습니다.`);
  refresh();
}

async function deleteUser(u) {
  const t = teacherById(u.teacher_id);
  if (!(await confirmBox(`로그인 계정 "${u.login_id}"을(를) 삭제할까요?\n\n`
    + `· 계정(아이디·비밀번호)만 삭제되어 더 이상 로그인할 수 없습니다.\n`
    + `· ${t ? `${t.name}의 ` : ''}업무일지·시간표·성적·로그 기록은 그대로 보관됩니다.\n`
    + `· 일시적으로 막기만 하려면 "수정 → 로그인 허용" 해제를 쓰세요.`, { ok: '계정 삭제', danger: true }))) return;
  await guard(() => api.deleteUser(u.id), '계정을 삭제했습니다. 기록은 보관됩니다.');
  refresh();
}

async function editUser(u) {
  const f = await formModal(u ? `${u.login_id} 수정` : '계정 추가', [
    { name: 'login_id', label: '아이디', value: u?.login_id, required: true },
    { name: 'name', label: '이름', value: u?.name },
    { name: 'role', label: '권한', type: 'select', value: u?.role || 'teacher', options: [{ value: 'teacher', label: '선생님 (본인 일지만)' }, { value: 'admin', label: '관리자 (전체)' }] },
    { name: 'teacher_id', label: '연결 선생님 (업무일지 작성 대상)', type: 'select', value: u?.teacher_id ?? '',
      options: [{ value: '', label: '없음' }, ...state.teachers.map((t) => ({ value: t.id, label: t.name }))] },
    ...(u ? [{ name: 'active', label: '', type: 'checkbox', value: u.active, text: '로그인 허용' }] : []),
  ], { extra: u ? '' : '<p class="subtle">초기 비밀번호: today1234</p>' });
  if (!f) return;
  await guard(() => api.saveUser({ ...(u || {}), ...f, teacher_id: f.teacher_id ? Number(f.teacher_id) : null }), '저장했습니다.');
  refresh();
}

async function editSlots() {
  const text = slots().map((s) => `${s.label}, ${s.time || ''}`).join('\n');
  const f = await formModal('교시 설정', [
    { name: 'text', label: '한 줄에 한 교시: 표시이름, 시간', type: 'textarea', rows: 9, value: text, required: true,
      hint: '줄 순서 = 교시 순서. 이미 있는 교시의 줄을 지우면 그 교시에 배정된 학생이 시간표에서 보이지 않게 되니 주의하세요.' },
  ]);
  if (!f) return;
  const old = slots();
  const lines = f.text.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((x) => x[0]);
  const used = new Set();
  const next = lines.map(([label, ...rest], i) => {
    // 같은 표시이름이 있으면 그 id 유지, 아니면 같은 위치의 id, 그래도 없으면 새 id
    let id = old.find((s) => s.label === label && !used.has(s.id))?.id;
    if (!id && old[i] && !used.has(old[i].id) && !lines.some(([l]) => l === old[i].label)) id = old[i].id;
    if (!id) id = 'p' + Date.now().toString(36) + i;
    used.add(id);
    return { id, label, time: rest.join(',').trim() };
  });
  const lost = old.filter((s) => !used.has(s.id));
  if (lost.length && !(await confirmBox(`삭제되는 교시: ${lost.map((s) => s.label).join(', ')}\n계속할까요?`, { danger: true }))) return;
  await guard(() => api.saveSettings('slots', next), '교시를 저장했습니다.');
  refresh();
}

async function editHolidays() {
  const f = await formModal('휴원일 · 알림 설정', [
    { name: 'text', label: '휴원일 — 한 줄에 하나: 날짜 이름 (기간은 2026-12-28~2026-12-31 방학)', type: 'textarea', rows: 10,
      value: holidays().slice().sort((a, b) => a.date.localeCompare(b.date)).map((h) => `${h.date} ${h.name}`).join('\n'),
      placeholder: '2026-10-03 개천절\n2026-10-05~2026-10-07 추석 연휴' },
    { name: 'from', label: '미작성 알림 시작일 (이 날 이전은 알림 없음, 비우면 자동)', type: 'date', value: state.settings.alerts?.from || '' },
  ]);
  if (!f) return;
  const out = [];
  for (const line of f.text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2})(?:\s*~\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/);
    if (!m) return toast(`형식이 잘못된 줄: ${line}`, 'err');
    const [, a, b, name] = m;
    for (let d = a; d <= (b || a) && out.length < 400; d = addDays(d, 1)) out.push({ date: d, name: name || '휴원' });
  }
  await guard(() => api.saveSettings('holidays', out));
  await guard(() => api.saveSettings('alerts', { ...(state.settings.alerts || {}), from: f.from || null }), '저장했습니다.');
  refresh();
}
