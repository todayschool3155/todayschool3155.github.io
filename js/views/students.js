// 학생 관리: 신규 등록(개별/일괄), 수정, 퇴원(시간표 자동 제거), 재등록, 시간표 배치
import { api } from '../api.js?v=202611010012';
import {
  state, reload, versionFor, placementsOf, placementText, removeFromGrid, applyFromDate, cellOf, setCell,
  slots, gridTeachers, DAYS,
} from '../store.js?v=202611010012';
import { esc, $, today, fmtDate, toast, guard, modal, formModal, confirmBox, DAY_NAMES } from '../util.js?v=202611010012';
import { exportStudentsXlsx } from '../excel.js?v=202611010012';
import { studentLink } from '../studentcard.js?v=202611010012';

let root, q = '', status = 'active', grade = '';

export async function render(el) {
  root = el;
  draw();
}

function draw() {
  const v = versionFor(today());
  const grades = [...new Set(state.students.map((s) => s.grade).filter(Boolean))].sort();
  const list = state.students
    .filter((s) => (status === 'all' || s.status === status) && (!grade || s.grade === grade) && (!q || s.name.includes(q) || s.school.includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const nActive = state.students.filter((s) => s.status === 'active').length;
  root.innerHTML = `
    <div class="toolbar">
      <div class="tb-group">
        <input type="search" id="st-q" placeholder="이름·학교 검색" value="${esc(q)}">
        <select id="st-status">
          <option value="active" ${status === 'active' ? 'selected' : ''}>재원 (${nActive})</option>
          <option value="withdrawn" ${status === 'withdrawn' ? 'selected' : ''}>퇴원 (${state.students.length - nActive})</option>
          <option value="all" ${status === 'all' ? 'selected' : ''}>전체</option>
        </select>
        <select id="st-grade"><option value="">전체 학년</option>${grades.map((g) => `<option ${g === grade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      </div>
      <div class="tb-group">
        <button class="btn" id="st-xlsx">엑셀</button>
        <button class="btn" id="st-bulk">일괄 등록</button>
        <button class="btn btn-primary" id="st-add">+ 신규 학생</button>
      </div>
    </div>
    <div class="table-scroll"><table class="list students">
      <thead><tr><th>이름</th><th>학년</th><th class="hide-sm">학교</th><th>주간 수업 (현재 시간표)</th><th class="hide-sm">등록일</th><th></th></tr></thead>
      <tbody>${list.map((s) => {
        const ps = v ? placementsOf(v, s.id) : [];
        return `<tr class="${s.status !== 'active' ? 'is-out' : ''}">
          <td><b>${studentLink(s.id)}</b>${s.status !== 'active' ? ` <span class="badge badge-err">퇴원 ${esc(s.withdrawn_on || '')}</span>` : ''}
            ${s.memo ? `<div class="subtle small">${esc(s.memo)}</div>` : ''}</td>
          <td>${esc(s.grade)}</td>
          <td class="hide-sm">${esc(s.school)}</td>
          <td class="small">${ps.length ? `<b>${ps.length}회</b> ` + ps.map((p) => `<span class="pill">${esc(placementText(p))}</span>`).join(' ') : '<span class="subtle">배정 없음</span>'}</td>
          <td class="hide-sm small">${esc(s.enrolled_on || '')}</td>
          <td class="row-actions">
            <button class="btn btn-sm" data-edit="${s.id}">수정</button>
            ${s.status === 'active'
              ? `<button class="btn btn-sm" data-place="${s.id}">배치</button><button class="btn btn-sm btn-danger" data-out="${s.id}">퇴원</button>`
              : `<button class="btn btn-sm" data-back="${s.id}">재등록</button>`}
          </td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">해당 학생이 없습니다.</td></tr>'}</tbody>
    </table></div>`;
  $('#st-q').addEventListener('input', (e) => { q = e.target.value.trim(); const p = e.target.selectionStart; draw(); const n = $('#st-q'); n.focus(); n.setSelectionRange(p, p); });
  $('#st-status').addEventListener('change', (e) => { status = e.target.value; draw(); });
  $('#st-grade').addEventListener('change', (e) => { grade = e.target.value; draw(); });
  $('#st-add').addEventListener('click', () => edit());
  $('#st-bulk').addEventListener('click', bulk);
  $('#st-xlsx').addEventListener('click', () => guard(exportStudentsXlsx));
  root.querySelector('tbody').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = state.students.find((x) => x.id === Number(b.dataset.edit || b.dataset.place || b.dataset.out || b.dataset.back || b.dataset.del));
    if (b.dataset.edit) edit(s);
    if (b.dataset.place) place(s);
    if (b.dataset.out) withdraw(s);
    if (b.dataset.back) reactivate(s);
    if (b.dataset.del) del(s);
  });
}

const fields = (s = {}) => [
  { name: 'name', label: '이름', value: s.name, required: true },
  { name: 'grade', label: '학년', value: s.grade, placeholder: '예: 초3, 중1' },
  { name: 'school', label: '학교', value: s.school },
  { name: 'phone', label: '연락처', value: s.phone, type: 'tel' },
  { name: 'enrolled_on', label: '등록일', type: 'date', value: s.enrolled_on || (s.id ? '' : today()) },
  { name: 'memo', label: '메모', type: 'textarea', value: s.memo, rows: 2 },
];
const delBtn = (s) => (s?.id ? `<button type="button" class="btn btn-sm btn-danger" id="st-del">잘못 등록한 학생 삭제</button>` : '');

async function edit(s) {
  const f = await formModal(s ? `${s.name} 정보 수정` : '신규 학생 등록', fields(s), { extra: s ? `<p class="small subtle">${delBtn(s)}</p>` : '' });
  if (f === 'delete') return del(s);
  if (!f) return;
  if (!s && state.students.some((x) => x.name === f.name && x.status === 'active')
    && !(await confirmBox(`재원생 중 "${f.name}" 학생이 이미 있습니다. 동명이인으로 등록할까요?`))) return;
  const saved = await guard(() => api.saveStudent({ ...(s || { status: 'active' }), ...f }), s ? '수정했습니다.' : `${f.name} 학생을 등록했습니다.`);
  await reload();
  draw();
  if (!s && (await confirmBox(`${saved.name} 학생을 지금 시간표에 배치할까요?`, { ok: '배치하기' }))) place(saved);
}

async function bulk() {
  const f = await formModal('학생 일괄 등록', [
    { name: 'text', label: '한 줄에 한 명: 이름, 학년, 학교 (학년·학교는 생략 가능)', type: 'textarea', rows: 10, required: true,
      placeholder: '홍길동, 초3, 오늘초\n김철수, 중1' },
    { name: 'enrolled_on', label: '등록일', type: 'date', value: today() },
  ], { ok: '등록' });
  if (!f) return;
  const lines = f.text.split('\n').map((l) => l.split(/[,\t]/).map((x) => x.trim())).filter((x) => x[0]);
  let n = 0;
  for (const [name, grade = '', school = ''] of lines) {
    await guard(() => api.saveStudent({ name, grade, school, status: 'active', enrolled_on: f.enrolled_on }));
    n++;
  }
  toast(`${n}명 등록했습니다.`);
  await reload();
  draw();
}

// 배치: 적용 시작일부터 시간표에 반영
async function place(s) {
  let date = today();
  const v0 = versionFor(date);
  if (!v0) return toast('먼저 시간표를 만들어 주세요.', 'err');
  const ts = gridTeachers(v0);
  const grid = structuredClone(v0.grid);
  const before = placementsOf(v0, s.id).map((p) => `${p.day}|${p.slot}|${p.tid}`);
  const ok = await modal({
    title: `${s.name} 시간표 배치`,
    wide: true,
    body: `<p class="subtle">요일마다 들을 교시·선생님 칸을 체크하세요.</p>
      <div class="table-scroll"><table class="tt place-grid"><thead><tr><th>교시</th>${DAYS.map((d) => `<th>${DAY_NAMES[d]}</th>`).join('')}</tr></thead>
      <tbody>${slots().map((sl) => `<tr><th class="slot-th"><b>${esc(sl.label)}</b></th>${DAYS.map((d) => `<td>${ts.map((t) => {
        const on = cellOf(grid, d, sl.id, t.id).items.includes(s.id);
        return `<label class="pchk" style="--tc:${esc(t.color)}"><input type="checkbox" data-k="${d}|${sl.id}|${t.id}" ${on ? 'checked' : ''}>${esc(t.name.replace(/쌤$/, ''))}</label>`;
      }).join('')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="field"><label for="pl-date">적용 시작일</label><input type="date" id="pl-date" value="${date}">
        <small class="hint">이 날짜부터의 시간표·업무일지에 반영됩니다. 해당 날짜의 시간표 버전이 없으면 자동으로 새 버전이 만들어집니다.</small></div>`,
    foot: '<button class="btn" data-close>취소</button><button class="btn btn-primary" id="pl-ok">저장</button>',
    onMount: (el, close) => el.querySelector('#pl-ok').addEventListener('click', () => {
      date = el.querySelector('#pl-date').value || today();
      const after = [...el.querySelectorAll('[data-k]:checked')].map((x) => x.dataset.k);
      close({ after });
    }),
  });
  if (!ok) return;
  const add = ok.after.filter((k) => !before.includes(k));
  const rm = before.filter((k) => !ok.after.includes(k));
  if (!add.length && !rm.length) return;
  const label = (k) => { const [d, sl, t] = k.split('|'); return placementText({ day: Number(d), slot: sl, tid: Number(t) }); };
  const changes = [...add.map((k) => `${label(k)}: +${s.name}`), ...rm.map((k) => `${label(k)}: -${s.name}`)];
  const n = await guard(() => applyFromDate(date, (g) => {
    for (const k of add) { const [d, sl, t] = k.split('|'); const c = cellOf(g, d, sl, t); if (!c.items.includes(s.id)) setCell(g, d, sl, t, { ...c, items: [...c.items, s.id] }); }
    for (const k of rm) { const [d, sl, t] = k.split('|'); const c = cellOf(g, d, sl, t); setCell(g, d, sl, t, { ...c, items: c.items.filter((x) => x !== s.id) }); }
  }, `${s.name} 시간표 변경`, changes));
  toast(`${date}부터 시간표에 반영했습니다. (버전 ${n}개)`);
  draw();
}

async function withdraw(s) {
  const v = versionFor(today());
  const ps = v ? placementsOf(v, s.id) : [];
  const f = await formModal(`${s.name} 퇴원 처리`, [
    { name: 'date', label: '퇴원일 (이 날부터 수업 없음)', type: 'date', value: today(), required: true },
    { name: 'remove', label: '', type: 'checkbox', value: true, text: `퇴원일부터 시간표에서 제거 (현재 주 ${ps.length}회) — 업무일지에도 자동 반영` },
    { name: 'memo', label: '사유/메모', type: 'textarea', value: s.memo, rows: 2 },
  ], { ok: '퇴원 처리' });
  if (!f) return;
  await guard(() => api.saveStudent({ ...s, status: 'withdrawn', withdrawn_on: f.date, memo: f.memo }));
  if (f.remove && ps.length) {
    await guard(() => applyFromDate(f.date, (g) => removeFromGrid(g, s.id), `${s.name} 퇴원`, [`${s.name} 퇴원 — 시간표에서 제거`]));
  } else {
    await reload();
  }
  toast(`${s.name} 퇴원 처리했습니다.`);
  draw();
}

async function reactivate(s) {
  if (!(await confirmBox(`${s.name} 학생을 재원 상태로 재등록할까요?`))) return;
  await guard(() => api.saveStudent({ ...s, status: 'active', withdrawn_on: null }), '재등록했습니다.');
  await reload();
  draw();
  if (await confirmBox('시간표에 다시 배치할까요?', { ok: '배치하기' })) place(state.students.find((x) => x.id === s.id));
}

// 잘못 등록한 학생만 삭제 가능 (수업·일지·성적 기록이 하나라도 있으면 서버가 거부 → 퇴원 상태로 보관)
async function del(s) {
  if (!(await confirmBox(`${s.name} 학생을 목록에서 완전히 삭제할까요?\n잘못 등록한 경우에만 사용하세요.\n수업·일지·성적 기록이 있는 학생은 삭제되지 않고 퇴원 상태로 보관됩니다.`, { ok: '삭제', danger: true }))) return;
  await guard(() => api.deleteStudent(s.id), '삭제했습니다.');
  await reload();
  draw();
}
