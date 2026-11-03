// 시간표: 보기(요일별/선생님별/주간) + 편집(관리자: 전체 / 선생님: 본인 칸만)
import { api } from '../api.js?v=202611032203';
import {
  state, reload, isAdmin, slots, slotById, teacherById, studentById, activeStudents, gridTeachers,
  versionFor, nextVersionAfter, cellOf, setCell, itemLabel, isStudentItem, placementsOf, placementText, DAYS,
} from '../store.js?v=202611032203';
import { esc, $, $$, today, weekday, DAY_NAMES, fmtDate, fmtDateTime, toast, guard, modal, formModal, confirmBox, addDays } from '../util.js?v=202611032203';
import { printTimetable } from '../print.js?v=202611032203';
import { exportTimetableXlsx } from '../excel.js?v=202611032203';
import { studentLink } from '../studentcard.js?v=202611032203';

const pref = (k, d) => { try { return localStorage.getItem('tt_' + k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('tt_' + k, v); } catch {} };

let root, versionId, mode, day, teacherSel, search = '', editing = false, work = null, changes = [];

export async function render(el) {
  root = el;
  const v = versionFor(today());
  versionId = v?.id ?? null;
  const wd = weekday(today());
  day = DAYS.includes(wd) ? wd : 1;
  mode = pref('mode', matchMedia('(max-width: 900px)').matches ? 'day' : 'week');
  teacherSel = Number(pref('teacher', state.user.teacher_id || state.teachers[0]?.id || 0));
  editing = false; work = null; changes = [];
  draw();
}

export async function leave() {
  if (editing && changes.length) {
    const ok = await confirmBox('저장하지 않은 시간표 변경이 있습니다. 나갈까요?', { ok: '나가기', danger: true });
    if (!ok) return false;
  }
  window.__dirty = false;
  return true;
}

const version = () => state.versions.find((v) => v.id === versionId) || null;
const canEditTimetable = () => isAdmin() || !!state.user.teacher_id;
const canEdit = (tid) => isAdmin() || state.user.teacher_id === Number(tid);
const grid = () => (editing ? work.grid : version()?.grid) || {};

function setDirty() {
  window.__dirty = editing && changes.length > 0;
  const bar = $('#tt-savebar');
  if (bar) {
    bar.hidden = !changes.length;
    $('#tt-changes').textContent = `변경 ${changes.length}건`;
  }
}

function versionRange(v) {
  const nx = nextVersionAfter(v);
  return `${fmtDate(v.effective_from)} ~ ${nx ? fmtDate(addDays(nx.effective_from, -1)) : '현재'}`;
}

function draw() {
  const v = version();
  const cur = versionFor(today());
  root.innerHTML = `
    <div class="toolbar no-print">
      <div class="tb-group">
        <select id="tt-version" aria-label="시간표 버전" ${editing ? 'disabled' : ''}>
          ${[...state.versions].reverse().map((x) => `<option value="${x.id}" ${x.id === versionId ? 'selected' : ''}>
            ${x.effective_from}${x === cur ? ' (현재)' : x.effective_from > today() ? ' (예정)' : ''} ${esc(x.title || '')}</option>`).join('')}
          ${state.versions.length ? '' : '<option>시간표 없음</option>'}
        </select>
        <div class="seg" role="tablist">
          ${[['day', '요일별'], ['teacher', '선생님별'], ['week', '주간 전체']].map(([k, l]) =>
            `<button role="tab" data-mode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="tb-group">
        <input type="search" id="tt-search" placeholder="학생 이름 검색" value="${esc(search)}" list="dl-students">
        <button class="btn" id="tt-print">인쇄</button>
        ${isAdmin() ? `<button class="btn" id="tt-xlsx">엑셀</button>` : ''}
        ${canEditTimetable() ? (editing
          ? '<button class="btn btn-primary" id="tt-edit-done">편집 종료</button>'
          : `<button class="btn btn-primary" id="tt-edit" ${v ? '' : 'disabled'}>${isAdmin() ? '편집' : '내 수업 편집'}</button>`) : ''}
        ${isAdmin() && !editing ? '<button class="btn" id="tt-versions">버전 관리</button>' : ''}
      </div>
    </div>
    ${v ? `<p class="subtle no-print">적용 기간: <b>${versionRange(v)}</b>${v.updated_by ? ` · 수정 ${fmtDateTime(v.updated_at)} ${esc(v.updated_by)}` : ''}</p>` : ''}
    ${editing ? `<div class="edit-hint no-print">
        <b>편집 모드</b> — ${isAdmin() ? '칸을 눌러' : '<b>본인 담당 칸</b>(진한 색)을 눌러'} 학생을 추가/삭제하세요.
        PC에서는 이름을 끌어 다른 칸으로 옮길 수 있습니다 (Ctrl 누르고 끌면 복사).
        ${isAdmin() ? '<button class="btn btn-sm" id="tt-place">학생별 배치</button>' : ''}</div>` : ''}
    ${mode === 'day' ? `<div class="daytabs no-print">${DAYS.map((d) =>
      `<button data-day="${d}" class="${d === day ? 'on' : ''}">${DAY_NAMES[d]}</button>`).join('')}</div>` : ''}
    ${mode === 'teacher' ? `<div class="daytabs no-print">${gridTeachers(v).map((t) =>
      `<button data-teacher="${t.id}" class="${t.id === teacherSel ? 'on' : ''}" style="--tc:${esc(t.color)}">${esc(t.name)}</button>`).join('')}</div>` : ''}
    <div id="tt-found" class="found no-print"></div>
    <div class="grid-wrap">${v ? gridHtml() : emptyHtml()}</div>
    ${v?.memo ? `<p class="memo pre">${esc(v.memo)}</p>` : ''}
    <div class="savebar no-print" id="tt-savebar" hidden>
      <span id="tt-changes"></span>
      <button class="btn" id="tt-cancel">변경 취소</button>
      ${isAdmin() ? '<button class="btn" id="tt-save-new">새 적용일로 저장</button>' : ''}
      <button class="btn btn-primary" id="tt-save">이 버전에 저장</button>
    </div>
    <datalist id="dl-students">${activeStudents().map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>`;
  bind();
  setDirty();
  showFound();
}

function emptyHtml() {
  return `<div class="empty">등록된 시간표가 없습니다.${isAdmin() ? '<br><button class="btn btn-primary" id="tt-create">새 시간표 만들기</button>' : ''}</div>`;
}

function chip(it, ctx) {
  const s = isStudentItem(it) ? studentById(it) : null;
  const cls = ['chip'];
  if (!isStudentItem(it)) cls.push('chip-label');
  if (s && s.status !== 'active') cls.push('chip-out');
  if (search && itemLabel(it).includes(search)) cls.push('chip-hit');
  const drag = editing && ctx && canEdit(ctx.split('|')[2]) ? `draggable="true" data-drag="${ctx}"` : '';
  return `<span class="${cls.join(' ')}" ${drag} title="${s?.grade ? esc(s.grade) : ''}">${esc(itemLabel(it))}</span>`;
}

function cellHtml(d, slotId, t, dayStart = false) {
  const c = cellOf(grid(), d, slotId, t.id);
  const ctx = (i) => `${d}|${slotId}|${t.id}|${i}`;
  const mine = state.user.teacher_id === t.id;
  const ed = editing && canEdit(t.id);
  return `<td class="cell ${ed ? 'editable' : ''} ${editing && !ed ? 'locked' : ''} ${mine ? 'mine' : ''} ${dayStart ? 'day-start' : ''}" style="--tc:${esc(t.color)}"
      data-cell="${d}|${slotId}|${t.id}" ${ed ? 'tabindex="0"' : ''}>
    ${c.note ? `<div class="cell-note">${esc(c.note)}</div>` : ''}
    <div class="chips">${c.items.map((it, i) => chip(it, ctx(i))).join('')}</div>
    ${ed ? `<span class="cell-count">${c.items.length || '+'}</span>` : ''}
  </td>`;
}

function slotTh(s) {
  return `<th class="slot-th"><b>${esc(s.label)}</b>${s.time ? `<small>${esc(s.time)}</small>` : ''}</th>`;
}

function gridHtml() {
  const ts = gridTeachers(version());
  if (mode === 'day') {
    return `<table class="tt tt-day"><thead><tr><th class="slot-th">교시</th>${ts.map((t) =>
      `<th class="t-th" style="--tc:${esc(t.color)}">${esc(t.name)}<small>${esc(t.subject)}</small></th>`).join('')}</tr></thead>
      <tbody>${slots().map((s) => `<tr>${slotTh(s)}${ts.map((t) => cellHtml(day, s.id, t)).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if (mode === 'teacher') {
    const t = teacherById(teacherSel) || ts[0];
    if (!t) return '<div class="empty">선생님이 없습니다.</div>';
    return `<table class="tt tt-teacher"><thead><tr><th class="slot-th">교시</th>${DAYS.map((d) =>
      `<th class="t-th" style="--tc:${esc(t.color)}">${DAY_NAMES[d]}</th>`).join('')}</tr></thead>
      <tbody>${slots().map((s) => `<tr>${slotTh(s)}${DAYS.map((d) => cellHtml(d, s.id, t)).join('')}</tr>`).join('')}</tbody></table>`;
  }
  return `<table class="tt tt-week"><thead>
      <tr><th class="slot-th" rowspan="2">교시</th>${DAYS.map((d) => `<th class="day-th" colspan="${ts.length}">${DAY_NAMES[d]}</th>`).join('')}</tr>
      <tr>${DAYS.map(() => ts.map((t, i) => `<th class="t-th ${i === 0 ? 'day-start' : ''}" style="--tc:${esc(t.color)}">${esc(t.name.replace(/쌤$/, ''))}</th>`).join('')).join('')}</tr>
    </thead><tbody>${slots().map((s) => `<tr>${slotTh(s)}${DAYS.map((d) => ts.map((t, i) => cellHtml(d, s.id, t, i === 0)).join('')).join('')}</tr>`).join('')}</tbody></table>`;
}

function showFound() {
  const box = $('#tt-found');
  if (!box) return;
  if (!search) { box.innerHTML = ''; return; }
  const matches = state.students.filter((s) => s.name.includes(search));
  if (!matches.length) { box.innerHTML = `<span class="subtle">"${esc(search)}" 학생 없음</span>`; return; }
  const v = editing ? work : version();
  box.innerHTML = matches.slice(0, 6).map((s) => {
    const ps = placementsOf(v, s.id);
    return `<div><b>${studentLink(s.id)}</b>${s.status !== 'active' ? ' <span class="badge badge-err">퇴원</span>' : ''}
      <span class="subtle">주 ${ps.length}회</span> ${ps.map((p) => `<span class="pill">${esc(placementText(p))}</span>`).join(' ') || '<span class="subtle">배정 없음</span>'}</div>`;
  }).join('');
}

function bind() {
  root.querySelector('#tt-version')?.addEventListener('change', (e) => { versionId = Number(e.target.value); draw(); });
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; setPref('mode', mode); draw(); }));
  root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { day = Number(b.dataset.day); draw(); }));
  root.querySelectorAll('[data-teacher]').forEach((b) => b.addEventListener('click', () => { teacherSel = Number(b.dataset.teacher); setPref('teacher', teacherSel); draw(); }));
  const sInput = root.querySelector('#tt-search');
  sInput?.addEventListener('input', () => {
    search = sInput.value.trim();
    $$('.chip', root).forEach((c) => c.classList.toggle('chip-hit', !!search && c.textContent.includes(search)));
    showFound();
  });
  root.querySelector('#tt-print')?.addEventListener('click', printDialog);
  root.querySelector('#tt-xlsx')?.addEventListener('click', () => guard(() => exportTimetableXlsx(version())));
  root.querySelector('#tt-edit')?.addEventListener('click', startEdit);
  root.querySelector('#tt-edit-done')?.addEventListener('click', endEdit);
  root.querySelector('#tt-versions')?.addEventListener('click', manageVersions);
  root.querySelector('#tt-create')?.addEventListener('click', createFirst);
  root.querySelector('#tt-place')?.addEventListener('click', () => placeStudent());
  root.querySelector('#tt-save')?.addEventListener('click', saveHere);
  root.querySelector('#tt-save-new')?.addEventListener('click', saveNew);
  root.querySelector('#tt-cancel')?.addEventListener('click', async () => {
    if (await confirmBox(`변경 ${changes.length}건을 모두 취소할까요?`)) { startEdit(); }
  });
  if (!editing) return;

  const wrap = root.querySelector('.grid-wrap');
  wrap.addEventListener('click', (e) => {
    const td = e.target.closest('td[data-cell]');
    if (td && canEdit(td.dataset.cell.split('|')[2])) editCell(...td.dataset.cell.split('|'));
  });
  wrap.addEventListener('keydown', (e) => {
    const td = e.target.closest('td[data-cell]');
    if (td && canEdit(td.dataset.cell.split('|')[2]) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editCell(...td.dataset.cell.split('|')); }
  });
  // 드래그 앤 드롭 (PC)
  wrap.addEventListener('dragstart', (e) => {
    const c = e.target.closest('[data-drag]');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.drag);
    e.dataTransfer.effectAllowed = 'copyMove';
    c.classList.add('dragging');
  });
  wrap.addEventListener('dragend', (e) => e.target.classList?.remove('dragging'));
  wrap.addEventListener('dragover', (e) => {
    const td = e.target.closest('td[data-cell]');
    if (!td || !canEdit(td.dataset.cell.split('|')[2])) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? 'copy' : 'move';
    $$('.drop-over', wrap).forEach((x) => x !== td && x.classList.remove('drop-over'));
    td.classList.add('drop-over');
  });
  wrap.addEventListener('dragleave', (e) => e.target.closest?.('td')?.classList.remove('drop-over'));
  wrap.addEventListener('drop', (e) => {
    const td = e.target.closest('td[data-cell]');
    if (!td) return;
    e.preventDefault();
    td.classList.remove('drop-over');
    const [d0, s0, t0, i0] = e.dataTransfer.getData('text/plain').split('|');
    const [d1, s1, t1] = td.dataset.cell.split('|');
    if (d0 === d1 && s0 === s1 && t0 === t1) return;
    if (!canEdit(t0) || !canEdit(t1)) return toast('본인 담당 칸만 수정할 수 있습니다.', 'warn');
    const from = cellOf(work.grid, d0, s0, t0);
    const it = from.items[Number(i0)];
    if (it === undefined) return;
    const to = cellOf(work.grid, d1, s1, t1);
    if (to.items.includes(it)) return toast('이미 그 칸에 있습니다.', 'warn');
    const copy = e.ctrlKey || e.altKey;
    if (!copy) setCell(work.grid, d0, s0, t0, { ...from, items: from.items.filter((_, i) => i !== Number(i0)) });
    setCell(work.grid, d1, s1, t1, { ...to, items: [...to.items, it] });
    changes.push(`${itemLabel(it)}: ${place(d0, s0, t0)} → ${place(d1, s1, t1)}${copy ? ' (복사)' : ''}`);
    redrawGrid();
  });
}

const place = (d, s, t) => `${DAY_NAMES[d]} ${slotById(s)?.label || s} ${teacherById(t)?.name || ''}`;

function redrawGrid() {
  root.querySelector('.grid-wrap').innerHTML = gridHtml();
  setDirty();
  showFound();
}

function startEdit() {
  if (!isAdmin() && mode === 'week') { mode = 'teacher'; teacherSel = state.user.teacher_id; }
  work = structuredClone(version());
  changes = [];
  editing = true;
  draw();
}

async function endEdit() {
  if (changes.length && !(await confirmBox('저장하지 않은 변경이 있습니다. 버리고 편집을 끝낼까요?', { ok: '버리기', danger: true }))) return;
  editing = false; work = null; changes = [];
  window.__dirty = false;
  draw();
}

// ---------- 칸 편집 ----------
async function editCell(d, slotId, tid) {
  d = Number(d);
  const t = teacherById(tid);
  const c = structuredClone(cellOf(work.grid, d, slotId, tid));
  const before = [...c.items];
  const res = await modal({
    title: `${DAY_NAMES[d]}요일 ${slotById(slotId)?.label} · ${t?.name}`,
    body: `
      <ul class="edit-list" id="ce-list"></ul>
      <form class="add-row" id="ce-add">
        <input id="ce-name" list="dl-ce" placeholder="학생 이름 또는 메모(예: 관리보충)" autocomplete="off">
        <button class="btn btn-primary" type="submit">추가</button>
      </form>
      <datalist id="dl-ce">${activeStudents().map((s) => `<option value="${esc(s.name)}">${esc(s.grade)}</option>`).join('')}
        <option value="관리보충"><option value="아이들"><option value="수학테스트"></datalist>
      <div class="field"><label for="ce-note">칸 메모 (시간 변경, 휴식 등)</label><input id="ce-note" value="${esc(c.note)}"></div>
      <fieldset class="copy-days"><legend>같은 교시·선생님의 다른 요일에도 똑같이 적용</legend>
        ${DAYS.filter((x) => x !== d).map((x) => `<label class="check"><input type="checkbox" value="${x}"> ${DAY_NAMES[x]}</label>`).join('')}
      </fieldset>`,
    foot: '<button class="btn" data-close>취소</button><button class="btn btn-primary" id="ce-ok">적용</button>',
    onMount: (el, close) => {
      const list = el.querySelector('#ce-list');
      const paint = () => {
        list.innerHTML = c.items.length ? c.items.map((it, i) => `
          <li><span class="${isStudentItem(it) ? '' : 'subtle'}">${i + 1}. ${esc(itemLabel(it))}
            ${isStudentItem(it) && studentById(it)?.grade ? `<small class="subtle">${esc(studentById(it).grade)}</small>` : ''}</span>
            <span class="row-actions">
              <button class="icon-btn" data-up="${i}" aria-label="위로" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn" data-down="${i}" aria-label="아래로" ${i === c.items.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="icon-btn danger" data-del="${i}" aria-label="삭제">✕</button>
            </span></li>`).join('') : '<li class="subtle">비어 있음</li>';
      };
      paint();
      list.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const i = Number(b.dataset.up ?? b.dataset.down ?? b.dataset.del);
        if (b.dataset.del != null) c.items.splice(i, 1);
        else {
          const j = b.dataset.up != null ? i - 1 : i + 1;
          [c.items[i], c.items[j]] = [c.items[j], c.items[i]];
        }
        paint();
      });
      el.querySelector('#ce-add').addEventListener('submit', async (e) => {
        e.preventDefault();
        const inp = el.querySelector('#ce-name');
        const name = inp.value.trim();
        if (!name) return;
        const it = await resolveItem(name);
        if (it == null) return;
        if (c.items.includes(it)) return toast('이미 있습니다.', 'warn');
        c.items.push(it);
        inp.value = '';
        paint();
        inp.focus();
      });
      el.querySelector('#ce-ok').addEventListener('click', () => {
        c.note = el.querySelector('#ce-note').value.trim();
        const copyTo = $$('.copy-days input:checked', el).map((x) => Number(x.value));
        close({ copyTo });
      });
    },
  });
  if (!res) return;
  setCell(work.grid, d, slotId, tid, c);
  const added = c.items.filter((x) => !before.includes(x)).map(itemLabel);
  const removed = before.filter((x) => !c.items.includes(x)).map(itemLabel);
  const where = place(d, slotId, tid);
  if (added.length) changes.push(`${where}: +${added.join(', +')}`);
  if (removed.length) changes.push(`${where}: -${removed.join(', -')}`);
  if (!added.length && !removed.length) changes.push(`${where}: 순서/메모 수정`);
  for (const x of res.copyTo) {
    setCell(work.grid, x, slotId, tid, structuredClone(c));
    changes.push(`${place(x, slotId, tid)}: ${DAY_NAMES[d]}요일과 동일하게`);
  }
  redrawGrid();
}

// 이름 → 학생 id / 동명이인 선택 / 신규 등록 / 메모 항목
async function resolveItem(name) {
  const same = activeStudents().filter((s) => s.name === name);
  if (same.length === 1) return same[0].id;
  if (same.length > 1) {
    const r = await formModal('동명이인 선택', [{ name: 'id', label: name, type: 'select',
      options: same.map((s) => ({ value: s.id, label: `${s.name} ${s.grade} ${s.school}` })) }], { ok: '선택' });
    return r ? Number(r.id) : null;
  }
  const withdrawn = state.students.find((s) => s.name === name && s.status !== 'active');
  const r = await modal({
    title: `"${name}"`,
    body: `<p>등록된 재원생이 아닙니다.${withdrawn ? ' (같은 이름의 퇴원 학생이 있습니다)' : ''}</p>`,
    foot: `<button class="btn" data-close>취소</button>
      <button class="btn" data-v="label">메모 항목으로 추가</button>
      <button class="btn btn-primary" data-v="new">신규 학생으로 등록</button>`,
    onMount: (el, close) => el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => close(b.dataset.v))),
  });
  if (r === 'label') return name;
  if (r !== 'new') return null;
  const f = await formModal('신규 학생 등록', [
    { name: 'name', label: '이름', value: name, required: true },
    { name: 'grade', label: '학년', placeholder: '예: 초3, 중1' },
    { name: 'school', label: '학교' },
    { name: 'enrolled_on', label: '등록일', type: 'date', value: today() },
  ], { ok: '등록' });
  if (!f) return null;
  const s = await guard(() => api.saveStudent({ ...f, status: 'active' }), `${f.name} 등록 완료`);
  state.students.push(s);
  return s.id;
}

// ---------- 학생별 배치 ----------
async function placeStudent(presetName = '') {
  let sid = null;
  await modal({
    title: '학생별 시간표 배치',
    wide: true,
    body: `
      <form class="add-row" id="ps-find"><input id="ps-name" list="dl-students" placeholder="학생 이름" value="${esc(presetName)}" autocomplete="off">
        <button class="btn" type="submit">불러오기</button></form>
      <div id="ps-body" class="subtle">학생을 선택하세요.</div>`,
    foot: '<button class="btn btn-primary" data-close>닫기</button>',
    onMount: (el) => {
      const body = el.querySelector('#ps-body');
      const paint = () => {
        const s = studentById(sid);
        const ps = placementsOf(work, sid);
        body.innerHTML = `
          <h3>${esc(s.name)} <small class="subtle">${esc(s.grade)}</small> · 주 ${ps.length}회</h3>
          <ul class="edit-list">${ps.map((p, i) => `<li>${esc(placementText(p))}<button class="icon-btn danger" data-rm="${i}" aria-label="삭제">✕</button></li>`).join('') || '<li class="subtle">배정 없음</li>'}</ul>
          <form class="add-row wrap" id="ps-add">
            <select name="day">${DAYS.map((d) => `<option value="${d}">${DAY_NAMES[d]}</option>`).join('')}</select>
            <select name="slot">${slots().map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select>
            <select name="tid">${gridTeachers(work).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
            <button class="btn btn-primary" type="submit">추가</button>
          </form>`;
        body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
          const p = ps[Number(b.dataset.rm)];
          const c = cellOf(work.grid, p.day, p.slot, p.tid);
          setCell(work.grid, p.day, p.slot, p.tid, { ...c, items: c.items.filter((x) => x !== sid) });
          changes.push(`${place(p.day, p.slot, p.tid)}: -${s.name}`);
          paint(); redrawGrid();
        }));
        body.querySelector('#ps-add').addEventListener('submit', (e) => {
          e.preventDefault();
          const f = e.target;
          const c = cellOf(work.grid, f.day.value, f.slot.value, f.tid.value);
          if (c.items.includes(sid)) return toast('이미 배정되어 있습니다.', 'warn');
          setCell(work.grid, f.day.value, f.slot.value, f.tid.value, { ...c, items: [...c.items, sid] });
          changes.push(`${place(f.day.value, f.slot.value, f.tid.value)}: +${s.name}`);
          paint(); redrawGrid();
        });
      };
      el.querySelector('#ps-find').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el.querySelector('#ps-name').value.trim();
        if (!name) return;
        const it = await resolveItem(name);
        if (typeof it !== 'number') return;
        sid = it; paint();
      });
      if (presetName) el.querySelector('#ps-find').requestSubmit();
    },
  });
}

// ---------- 저장 ----------
// 칸 단위 변경분(추가/삭제 학생, 메모) 계산
function diffGrids(a, b) {
  const out = [];
  for (const d of DAYS) for (const s of slots()) for (const t of state.teachers) {
    const x = cellOf(a, d, s.id, t.id), y = cellOf(b, d, s.id, t.id);
    const add = y.items.filter((i) => !x.items.includes(i));
    const rm = x.items.filter((i) => !y.items.includes(i));
    const note = x.note !== y.note ? y.note : null;
    if (add.length || rm.length || note !== null) out.push({ d, s: s.id, t: t.id, add, rm, note });
  }
  return out;
}

async function saveHere() {
  const v = version();
  const nx = nextVersionAfter(v);
  const later = state.versions.filter((x) => x.effective_from > v.effective_from);
  const summary = changes.slice(0, 15).join('\n') + (changes.length > 15 ? `\n… 외 ${changes.length - 15}건` : '');
  const res = await modal({
    title: '시간표 저장',
    body: `<p class="pre">[${v.effective_from}] 버전에 변경 ${changes.length}건을 저장합니다.
${fmtDate(v.effective_from)}부터${nx ? ` ${fmtDate(addDays(nx.effective_from, -1))}까지` : ''}의 업무일지에 자동 반영됩니다.</p>
      <pre class="pre subtle small">${esc(summary)}</pre>
      ${later.length ? `<label class="check"><input type="checkbox" id="sv-later" checked>
        이후 버전(${later.map((x) => x.effective_from).join(', ')})에도 같은 변경 적용</label>` : ''}`,
    foot: '<button class="btn" data-close>취소</button><button class="btn btn-primary" id="sv-ok">저장</button>',
    onMount: (el, close) => el.querySelector('#sv-ok').addEventListener('click', () => close({ later: !!el.querySelector('#sv-later')?.checked })),
  });
  if (!res) return;
  const diff = diffGrids(v.grid, work.grid);
  await guard(async () => {
    await api.saveVersion({ ...work, changes });
    if (res.later) for (const lv of later) {
      const g = structuredClone(lv.grid);
      for (const c of diff) {
        const cur = cellOf(g, c.d, c.s, c.t);
        const items = cur.items.filter((i) => !c.rm.includes(i));
        for (const i of c.add) if (!items.includes(i)) items.push(i);
        setCell(g, c.d, c.s, c.t, { items, note: c.note ?? cur.note });
      }
      await api.saveVersion({ ...lv, grid: g, changes: [`${v.effective_from} 버전 변경 반영`, ...changes] });
    }
  }, '시간표를 저장했습니다.');
  await reload();
  editing = false; work = null; changes = []; window.__dirty = false;
  draw();
}

async function saveNew() {
  const f = await formModal('새 적용일로 저장', [
    { name: 'effective_from', label: '적용 시작일', type: 'date', value: addDays(today(), 1), required: true,
      hint: '이 날짜부터의 업무일지에 새 시간표가 적용됩니다. 기존 버전은 그 전날까지 유지됩니다.' },
    { name: 'title', label: '제목/메모', placeholder: '예: 10월 시간표, 김OO 신규', value: '' },
  ], { ok: '저장' });
  if (!f) return;
  if (state.versions.some((x) => x.effective_from === f.effective_from))
    return toast('같은 적용일의 버전이 이미 있습니다. 해당 버전을 선택해 편집하세요.', 'err');
  const later = state.versions.filter((x) => x.effective_from > f.effective_from);
  if (later.length && !(await confirmBox(`${f.effective_from} 이후에 적용되는 버전이 ${later.length}개 있습니다. 이 변경은 그 버전들에는 반영되지 않습니다. 계속할까요?`))) return;
  const saved = await guard(() => api.saveVersion({ effective_from: f.effective_from, title: f.title, memo: work.memo || '', grid: work.grid, changes }), '새 시간표 버전을 저장했습니다.');
  await reload();
  versionId = saved.id;
  editing = false; work = null; changes = []; window.__dirty = false;
  draw();
}

async function createFirst() {
  const f = await formModal('새 시간표', [
    { name: 'effective_from', label: '적용 시작일', type: 'date', value: today(), required: true },
    { name: 'title', label: '제목', value: '' },
  ]);
  if (!f) return;
  const saved = await guard(() => api.saveVersion({ ...f, memo: '', grid: {} }), '생성했습니다.');
  await reload();
  versionId = saved.id;
  startEdit();
}

async function manageVersions() {
  await modal({
    title: '시간표 버전 관리',
    wide: true,
    body: `<p class="subtle">각 버전은 <b>적용 시작일</b>부터 다음 버전 전날까지 사용됩니다. 업무일지는 날짜에 맞는 버전으로 자동 생성됩니다.</p>
      <div class="table-scroll"><table class="list"><thead><tr><th>적용 기간</th><th>제목</th><th>수정</th><th></th></tr></thead>
      <tbody>${[...state.versions].reverse().map((v) => `<tr>
        <td>${versionRange(v)}</td><td>${esc(v.title)}</td><td class="subtle">${fmtDateTime(v.updated_at)} ${esc(v.updated_by)}</td>
        <td class="row-actions"><button class="btn btn-sm" data-edit="${v.id}">수정</button>
          <button class="btn btn-sm" data-copy="${v.id}">복사</button>
          <button class="btn btn-sm btn-danger" data-del="${v.id}" ${state.versions.length < 2 ? 'disabled' : ''}>삭제</button></td></tr>`).join('')}
      </tbody></table></div>`,
    foot: '<button class="btn btn-primary" data-close>닫기</button>',
    onMount: (el, close) => {
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-edit],button[data-copy],button[data-del]');
        if (!b) return;
        const v = state.versions.find((x) => x.id === Number(b.dataset.edit || b.dataset.copy || b.dataset.del));
        if (b.dataset.edit) {
          const f = await formModal('버전 정보 수정', [
            { name: 'effective_from', label: '적용 시작일', type: 'date', value: v.effective_from, required: true },
            { name: 'title', label: '제목', value: v.title },
            { name: 'memo', label: '하단 메모', type: 'textarea', value: v.memo },
          ]);
          if (!f) return;
          await guard(() => api.saveVersion({ ...v, ...f, changes: ['버전 정보 수정'] }), '수정했습니다.');
        } else if (b.dataset.copy) {
          const f = await formModal('버전 복사', [
            { name: 'effective_from', label: '새 적용 시작일', type: 'date', value: addDays(today(), 1), required: true },
            { name: 'title', label: '제목', value: `${v.title} 복사` },
          ]);
          if (!f) return;
          const s = await guard(() => api.saveVersion({ effective_from: f.effective_from, title: f.title, memo: v.memo, grid: v.grid, changes: [`${v.effective_from} 버전 복사`] }), '복사했습니다.');
          versionId = s.id;
        } else {
          if (!(await confirmBox(`[${v.effective_from}] 버전을 삭제할까요?\n해당 기간의 업무일지는 이전 버전 시간표로 표시됩니다. (작성된 일지 내용은 유지)`, { ok: '삭제', danger: true }))) return;
          await guard(() => api.deleteVersion(v.id), '삭제했습니다.');
          if (versionId === v.id) versionId = null;
        }
        await reload();
        versionId = state.versions.find((x) => x.id === versionId)?.id ?? versionFor(today())?.id ?? null;
        close(true);
        draw();
      });
    },
  });
}

// ---------- 인쇄 ----------
async function printDialog() {
  const v = editing ? work : version();
  if (!v) return;
  const ts = gridTeachers(v);
  const f = await formModal('시간표 인쇄 (A4)', [
    { name: 'mode', label: '인쇄 형식', type: 'select', value: 'week', options: [
      { value: 'week', label: '주간 전체 — A4 가로 1장' },
      { value: 'days', label: '요일별 — 요일마다 A4 세로 1장' },
      { value: 'teachers', label: '선생님별 — 선생님마다 A4 세로 1장' },
    ] },
    { name: 'teacher', label: '선생님 (선생님별 인쇄 시)', type: 'select', value: '',
      options: [{ value: '', label: '전체 선생님' }, ...ts.map((t) => ({ value: t.id, label: t.name }))] },
  ], { ok: '인쇄' });
  if (!f) return;
  printTimetable(v, f.mode, f.teacher ? [Number(f.teacher)] : ts.map((t) => t.id));
}
