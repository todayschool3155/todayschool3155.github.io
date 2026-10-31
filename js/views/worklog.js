// 업무일지: 날짜 + 선생님 → 시간표에서 학생 행 자동 생성, 자동 저장, A4 인쇄
import { api } from '../api.js';
import {
  state, reload, isAdmin, slots, slotById, teacherById, studentById, activeStudents, versionFor, worklogRows, logRows,
  itemLabel, itemKey, isStudentItem, ATT, DAYS, dayOfDate, applyFromDate, cellOf, setCell, removedKeys, holidayOf, refreshAlerts, prevHomeworkMap,
} from '../store.js';
import { studentLink } from '../studentcard.js';
import { esc, $, today, addDays, fmtDate, fmtDateTime, fmtTime, toast, guard, modal, formModal, confirmBox, debounce, mondayOf, DAY_NAMES, datesBetween } from '../util.js';
import { printWorklogs } from '../print.js';

let root, date, teacherId, log, rows, hints, prevHw = {}, saveState = 'idle';
const REVIEW_TEMPLATE = '* 수업 전반 평가:\n* 필요한 개선 사항:\n* 다음 수업 목표 또는 계획:';

export async function render(el, [d, t]) {
  root = el;
  date = /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : today();
  if (isAdmin()) teacherId = t === 'all' || t == null ? (t == null && state.user.teacher_id ? state.user.teacher_id : 'all') : Number(t);
  else teacherId = state.user.teacher_id;
  await load();
}

export async function leave() {
  await flush();
  return true;
}

const autosave = debounce(() => save(), 1500);
async function flush() { if (saveState === 'dirty') { autosave.cancel(); await save(); } }

function go(d, t = teacherId) {
  history.replaceState(null, '', `#/worklog/${d}/${t}`);
  date = d; teacherId = t;
  load();
}

async function load() {
  await flush();
  if (!teacherId) {
    root.innerHTML = `<div class="empty">계정에 연결된 선생님 정보가 없습니다. 관리자에게 문의하세요.</div>`;
    return;
  }
  root.innerHTML = toolbarHtml() + '<div class="loading">불러오는 중…</div>';
  bindToolbar();
  if (teacherId === 'all') return overview();
  const [logs, prev] = await Promise.all([
    guard(() => api.getWorklogs(date, date, teacherId)),
    api.getWorklogs(addDays(date, -45), addDays(date, -1), teacherId).catch(() => []),
  ]);
  prevHw = prevHomeworkMap(prev, teacherId);
  log = logs[0] || { log_date: date, teacher_id: teacherId, entries: {}, extras: [], notice: '', review: '', done: false };
  hints = {};
  for (const w of prev.sort((a, b) => a.log_date.localeCompare(b.log_date))) {
    for (const [k, e] of Object.entries(w.entries || {})) {
      const ik = k.split('|')[1];
      if (e.progress || e.homework) hints[ik] = { ...e, date: w.log_date };
    }
  }
  saveState = 'idle';
  drawLog();
}

function toolbarHtml() {
  const ts = state.teachers.filter((t) => t.active);
  const retired = state.teachers.filter((t) => !t.active);
  return `<div class="toolbar no-print">
    <div class="tb-group datenav">
      <button class="icon-btn" data-go="-1" aria-label="이전 날">◀</button>
      <input type="date" id="wl-date" value="${date}">
      <button class="icon-btn" data-go="1" aria-label="다음 날">▶</button>
      <button class="btn btn-sm" data-go="today">오늘</button>
    </div>
    <div class="tb-group">
      ${isAdmin() ? `<select id="wl-teacher" aria-label="선생님">
        <option value="all" ${teacherId === 'all' ? 'selected' : ''}>전체 작성 현황</option>
        ${ts.map((t) => `<option value="${t.id}" ${t.id === teacherId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        ${retired.length ? `<optgroup label="퇴사한 선생님 (기록 조회)">${retired.map((t) =>
          `<option value="${t.id}" ${t.id === teacherId ? 'selected' : ''}>${esc(t.name)} (퇴사 ${esc(t.retired_on || '')})</option>`).join('')}</optgroup>` : ''}</select>`
        : `<span class="pill" style="--tc:${esc(teacherById(teacherId)?.color || '')}">${esc(teacherById(teacherId)?.name || '')}</span>`}
      <button class="btn" id="wl-print">인쇄</button>
    </div>
  </div>`;
}

function bindToolbar() {
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const g = b.dataset.go;
    let d = g === 'today' ? today() : addDays(date, Number(g));
    if (g !== 'today') while (!DAYS.includes(dayOfDate(d))) d = addDays(d, Number(g)); // 주말 건너뛰기
    go(d);
  }));
  root.querySelector('#wl-date').addEventListener('change', (e) => e.target.value && go(e.target.value));
  root.querySelector('#wl-teacher')?.addEventListener('change', (e) => go(date, e.target.value === 'all' ? 'all' : Number(e.target.value)));
  root.querySelector('#wl-print').addEventListener('click', printDialog);
}

// ---------- 관리자: 주간 작성 현황 ----------
async function overview() {
  const mon = mondayOf(date);
  const days = DAYS.map((d) => addDays(mon, d - 1));
  const logs = await guard(() => api.getWorklogs(days[0], days[days.length - 1]));
  const byKey = Object.fromEntries(logs.map((w) => [`${w.log_date}|${w.teacher_id}`, w]));
  const ts = state.teachers.filter((t) => t.active);
  const cell = (d, t) => {
    const n = worklogRows(d, t.id).length;
    const w = byKey[`${d}|${t.id}`];
    if (!n && !w) return '<td class="ov ov-none">—</td>';
    const filled = w ? Object.values(w.entries || {}).filter((e) => e.att || e.progress || e.homework || e.note).length : 0;
    const cls = w?.done ? 'ov-done' : w ? 'ov-part' : d <= today() ? 'ov-miss' : 'ov-future';
    const label = w?.done ? '완료' : w ? '작성중' : d <= today() ? '미작성' : '예정';
    return `<td class="ov ${cls}"><a href="#/worklog/${d}/${t.id}"><b>${label}</b><small>${filled}/${n}명${w ? ' · ' + fmtTime(w.updated_at) : ''}</small></a></td>`;
  };
  root.innerHTML = toolbarHtml() + `
    <h2 class="section-title">주간 작성 현황 <small class="subtle">${fmtDate(days[0])} ~ ${fmtDate(days[days.length - 1])}</small></h2>
    <div class="table-scroll"><table class="list overview">
      <thead><tr><th>선생님</th>${days.map((d) => `<th class="${d === today() ? 'is-today' : ''}">${DAY_NAMES[dayOfDate(d)]} ${d.slice(5).replace('-', '/')}</th>`).join('')}</tr></thead>
      <tbody>${ts.map((t) => `<tr><th style="--tc:${esc(t.color)}" class="t-th">${esc(t.name)}</th>${days.map((d) => cell(d, t)).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="subtle">칸을 누르면 해당 일지로 이동합니다. 완료 = 선생님이 "작성 완료" 체크.</p>`;
  bindToolbar();
}

// ---------- 일지 작성 ----------
function drawLog() {
  const t = teacherById(teacherId);
  const v = versionFor(date);
  rows = logRows(date, teacherId, log);
  const bySlot = {};
  for (const r of rows) (bySlot[r.slot] ||= []).push(r);
  const slotOrder = [...slots().map((s) => s.id), ...Object.keys(bySlot).filter((k) => !slotById(k))];
  const weekend = !DAYS.includes(dayOfDate(date));

  root.innerHTML = toolbarHtml() + `
    <section class="wl-head">
      <div>
        <h2>${fmtDate(date)} <span class="pill" style="--tc:${esc(t?.color || '')}">${esc(t?.name || '')}</span>${t && !t.active ? ` <span class="badge badge-err">퇴사 ${esc(t.retired_on || '')}</span>` : ''}</h2>
        <p class="subtle">${v ? `시간표 ${v.effective_from} 버전 기준` : '시간표 없음'} · 학생 ${rows.filter((r) => !r.orphan).length}명</p>
      </div>
      <div class="wl-status">
        <span id="wl-save" class="save-state"></span>
        <label class="check"><input type="checkbox" id="wl-done" ${log.done ? 'checked' : ''}> 작성 완료</label>
      </div>
    </section>
    ${holidayOf(date) ? `<div class="alert-box">오늘은 <b>휴원일 (${esc(holidayOf(date).name)})</b>입니다. 일지를 쓰지 않아도 미작성 알림이 뜨지 않습니다.</div>` : ''}
    ${weekend && !rows.length ? '<div class="empty">주말입니다. 시간표상 수업이 없습니다.</div>' : ''}
    ${!weekend && !rows.length ? '<div class="empty">이 날 시간표에 배정된 수업이 없습니다.</div>' : ''}
    <div class="wl-tools no-print">
      <button class="btn btn-sm" id="wl-allpresent">모두 출석</button>
      <button class="btn btn-sm" id="wl-allhw">전날 숙제 모두 O</button>
      <button class="btn btn-sm btn-primary" id="wl-extra">+ 학생 추가</button>
      <span class="subtle small">학생 옆 <b>수정</b>: 교시 변경 · 다른 학생으로 바꾸기 · 빼기 (오늘만 또는 시간표에 반영)</span>
    </div>
    ${removedHtml()}
    <div class="wl-list">
      ${slotOrder.filter((s) => bySlot[s]).map((s) => {
        const sl = slotById(s);
        const note = v?.grid?.[dayOfDate(date)]?.[s]?.[teacherId]?.note;
        return `<section class="wl-slot">
          <h3>${esc(sl?.label || s)} <small>${esc(sl?.time || '')}</small>${note ? ` <small class="cell-note">${esc(note)}</small>` : ''}
            <button class="btn btn-sm slot-add no-print" data-addslot="${esc(s)}">+ 학생</button></h3>
          <div class="wl-table-head"><span>학생</span><span>출결</span><span>수업책/진도/프린트</span><span>숙제 (전날 O/X · 오늘)</span><span>특이사항</span></div>
          ${bySlot[s].map(rowHtml).join('')}
        </section>`;
      }).join('')}
    </div>
    <section class="wl-foot">
      <label>공지 및 전달사항<textarea id="wl-notice" rows="3" placeholder="예) 출석 꼭 확인 후 전달">${esc(log.notice)}</textarea></label>
      <label>하루 평가 및 총평<textarea id="wl-review" rows="4" placeholder="${esc(REVIEW_TEMPLATE)}">${esc(log.review)}</textarea></label>
      ${log.updated_at ? `<p class="subtle">마지막 저장: ${fmtDateTime(log.updated_at)} (${esc(log.updated_by)})</p>` : ''}
    </section>`;
  bindToolbar();
  bindLog();
  paintSave();
}

function rowHtml(r) {
  const e = log.entries[r.key] || {};
  const s = isStudentItem(r.item) ? studentById(r.item) : null;
  const h = hints[itemKey(r.item)];
  const hintP = h?.progress ? `지난(${h.date.slice(5)}): ${h.progress}` : '수업책/진도/프린트';
  const ph = prevHw[itemKey(r.item)];
  const prevText = e.hwPrev || ph?.hw;
  return `<div class="wl-row ${r.orphan ? 'is-orphan' : ''} ${r.extra ? 'is-extra' : ''} ${e.att === '결석' ? 'is-absent' : ''}" data-key="${esc(r.key)}">
    <div class="wl-name">
      ${s ? `<b>${studentLink(s.id)}</b>` : `<b class="subtle">${esc(itemLabel(r.item))}</b>`}
      ${s?.grade ? `<small>${esc(s.grade)}</small>` : ''}
      ${r.extra ? '<span class="badge">오늘 추가</span>' : ''}
      ${r.orphan ? '<span class="badge badge-warn" title="시간표 변경으로 빠졌지만 작성된 기록">시간표 외</span>' : ''}
      ${!r.orphan ? '<button class="btn btn-sm row-x no-print" data-editrow aria-label="학생 수정">수정</button>' : ''}
    </div>
    <div class="att" role="group" aria-label="출결">${ATT.map((a) => `<button type="button" data-att="${a}" class="${e.att === a ? 'on att-' + a : ''}">${a}</button>`).join('')}</div>
    <input data-f="progress" value="${esc(e.progress)}" placeholder="${esc(hintP)}" aria-label="수업책/진도/프린트">
    <div class="hw">
      ${prevText ? `<div class="hw-prev ${e.hwDone === 'X' ? 'is-x' : ''}">
        <span class="hw-text" title="${esc(ph?.date || '')} 숙제: ${esc(prevText)}">전날: ${esc(prevText)}</span>
        <span class="ox" role="group" aria-label="전날 숙제 완료">${['O', 'X'].map((v) =>
          `<button type="button" data-hw="${v}" class="${e.hwDone === v ? 'on ox-' + v : ''}">${v}</button>`).join('')}</span></div>` : ''}
      <input data-f="homework" value="${esc(e.homework)}" placeholder="오늘 숙제" aria-label="오늘 숙제">
    </div>
    <input data-f="note" value="${esc(e.note)}" placeholder="특이사항" aria-label="특이사항">
  </div>`;
}

function entry(key) { return (log.entries[key] ||= {}); }

function markDirty() {
  saveState = 'dirty';
  window.__dirty = true;
  paintSave();
  autosave();
}

function paintSave() {
  const el = $('#wl-save');
  if (!el) return;
  el.className = `save-state s-${saveState}`;
  el.textContent = { idle: log.updated_at ? '저장됨' : '새 일지', dirty: '입력 중…', saving: '저장 중…', saved: `저장됨 ${fmtTime(log.updated_at)}`, error: '저장 실패 — 다시 시도' }[saveState];
}

async function save() {
  if (saveState !== 'dirty' && saveState !== 'error') return;
  saveState = 'saving';
  paintSave();
  // 빈 항목은 저장하지 않음
  const entries = {};
  for (const [k, e] of Object.entries(log.entries)) {
    const c = Object.fromEntries(Object.entries(e).filter(([, v]) => v));
    if (Object.keys(c).length) entries[k] = c;
  }
  try {
    const r = await api.saveWorklog({ ...log, entries });
    log.updated_at = r.updated_at;
    log.updated_by = r.updated_by;
    if (saveState === 'saving') { saveState = 'saved'; window.__dirty = false; }
    refreshAlerts(true).then(() => window.dispatchEvent(new Event('alerts-changed'))).catch(() => {});
  } catch (e) {
    saveState = 'error';
    toast(e.message, 'err');
  }
  paintSave();
}

function bindLog() {
  const list = root.querySelector('.wl-list');
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.wl-row');
    if (!row) return;
    const key = row.dataset.key;
    const b = e.target.closest('[data-att]');
    if (b) {
      const en = entry(key);
      en.att = en.att === b.dataset.att ? '' : b.dataset.att;
      row.querySelectorAll('[data-att]').forEach((x) => { x.className = x.dataset.att === en.att ? `on att-${en.att}` : ''; });
      row.classList.toggle('is-absent', en.att === '결석');
      markDirty();
    }
    if (e.target.closest('[data-editrow]')) { editRow(rows.find((r) => r.key === key)); return; }
    const hb = e.target.closest('[data-hw]');
    if (hb) {
      const en = entry(key);
      const r = rows.find((x) => x.key === key);
      en.hwDone = en.hwDone === hb.dataset.hw ? '' : hb.dataset.hw;
      en.hwPrev = en.hwDone ? (en.hwPrev || prevHw[itemKey(r.item)]?.hw || '') : '';
      const wrap = hb.closest('.hw-prev');
      wrap.querySelectorAll('[data-hw]').forEach((x) => { x.className = x.dataset.hw === en.hwDone ? `on ox-${en.hwDone}` : ''; });
      wrap.classList.toggle('is-x', en.hwDone === 'X');
      markDirty();
    }
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-addslot]');
    if (b) addExtra(b.dataset.addslot);
  });
  list.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    entry(e.target.closest('.wl-row').dataset.key)[f] = e.target.value;
    markDirty();
  });
  // 진도 칸이 비어 있을 때 Tab 대신 → 키로 지난 기록 불러오기
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' || e.target.value || !e.target.dataset.f) return;
    const ik = e.target.closest('.wl-row').dataset.key.split('|')[1];
    const h = hints[ik]?.[e.target.dataset.f];
    if (h) { e.preventDefault(); e.target.value = h; e.target.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  root.querySelector('#wl-notice').addEventListener('input', (e) => { log.notice = e.target.value; markDirty(); });
  const rv = root.querySelector('#wl-review');
  rv.addEventListener('focus', () => { if (!rv.value) { rv.value = REVIEW_TEMPLATE; log.review = rv.value; } });
  rv.addEventListener('input', () => { log.review = rv.value; markDirty(); });
  root.querySelector('#wl-done').addEventListener('change', (e) => { log.done = e.target.checked; markDirty(); autosave.flush(); });
  root.querySelector('#wl-allpresent').addEventListener('click', () => {
    let n = 0;
    for (const r of rows) if (!r.orphan && isStudentItem(r.item) && !entry(r.key).att) { entry(r.key).att = '출석'; n++; }
    if (!n) return toast('출결이 비어 있는 학생이 없습니다.', 'warn');
    markDirty();
    drawLog();
  });
  root.querySelector('#wl-extra').addEventListener('click', () => addExtra());
  root.querySelector('#wl-allhw').addEventListener('click', () => {
    let n = 0;
    for (const r of rows) {
      const ph = prevHw[itemKey(r.item)];
      const en = log.entries[r.key] || {};
      if (r.orphan || !isStudentItem(r.item) || !(en.hwPrev || ph?.hw) || en.hwDone || en.att === '결석') continue;
      Object.assign(entry(r.key), { hwDone: 'O', hwPrev: en.hwPrev || ph.hw });
      n++;
    }
    if (!n) return toast('체크할 전날 숙제가 없습니다.', 'warn');
    toast(`${n}명 O 처리했습니다. X인 학생만 바꿔 주세요.`);
    markDirty();
    drawLog();
  });
  root.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => {
    log.extras = log.extras.filter((x) => !(x.removed && `${x.slot}|${itemKey(x.item)}` === b.dataset.undo));
    markDirty();
    drawLog();
  }));
}

function removedHtml() {
  const rm = (log.extras || []).filter((x) => x.removed);
  if (!rm.length) return '';
  return `<p class="removed-line no-print">오늘 제외: ${rm.map((x) => `<span class="pill">${esc(slotById(x.slot)?.label || '')} ${esc(itemLabel(x.item))}
    <button class="linklike" data-undo="${esc(`${x.slot}|${itemKey(x.item)}`)}">되돌리기</button></span>`).join(' ')}</p>`;
}

// ---------- 업무일지에서 학생 추가 · 수정 · 빼기 ----------
// "오늘만" = 이 날 일지에만 반영 (extras) / "시간표" = 이 날부터 매주 같은 요일 시간표에 반영 (이후 일지 자동 반영)
const keyOf = (slot, item) => `${slot}|${itemKey(item)}`;

function todayRemove(r) {
  if (r.extra) log.extras = (log.extras || []).filter((x) => x.removed || keyOf(x.slot, x.item) !== r.key);
  else (log.extras ||= []).push({ slot: r.slot, item: r.item, removed: true });
  delete log.entries[r.key];
}
function todayAdd(slot, item, carry) {
  const k = keyOf(slot, item);
  log.extras = (log.extras || []).filter((x) => !(x.removed && keyOf(x.slot, x.item) === k)); // 오늘 제외해 둔 것이면 되돌리기
  if (!worklogRows(date, teacherId).some((r) => r.key === k)) (log.extras ||= []).push({ slot, item });
  if (carry) log.entries[k] = { ...carry };
}
// 시간표(담당 칸) 여러 칸을 한 번에 바꿈 — 이 날짜부터 적용
async function changeMyCells(mutateCells, what) {
  const d = dayOfDate(date);
  await guard(() => applyFromDate(date, (g) => {
    mutateCells((slot, fn) => {
      const c = cellOf(g, d, slot, teacherId);
      setCell(g, d, slot, teacherId, { ...c, items: fn([...c.items]) });
    });
  }, `${teacherById(teacherId)?.name} ${what}`, [`${DAY_NAMES[d]} ${teacherById(teacherId)?.name}: ${what} (${date}부터)`]));
}
async function changeMyCell(slot, mutate, what) {
  await changeMyCells((cell) => cell(slot, mutate), what);
}

async function resolveStudent(name) {
  let s = activeStudents().find((x) => x.name === name);
  if (!s && await confirmBox(`"${name}"은(는) 등록된 학생이 아닙니다. 신규 학생으로 등록할까요?\n(취소하면 메모 항목으로 넣습니다)`, { ok: '신규 등록' })) {
    s = await guard(() => api.saveStudent({ name, status: 'active', enrolled_on: date }), `${name} 학생을 등록했습니다.`);
    await reload();
  }
  return s ? s.id : name;
}

async function editRow(r) {
  if (!r) return;
  const d = dayOfDate(date);
  const name = itemLabel(r.item);
  const weekly = DAYS.includes(d) ? `${fmtDate(date)}부터 매주 ${DAY_NAMES[d]}요일` : '';
  const slotOpts = slots().filter((s) => s.id !== r.slot).map((s) => `<option value="${s.id}">${esc(s.label)} ${esc(s.time || '')}</option>`).join('');
  const res = await modal({
    title: `${name} 수정 (${slotById(r.slot)?.label || ''})`,
    body: `
      <div class="edit-sec"><h4>교시 바꾸기</h4>
        <div class="add-row wrap"><select id="er-slot">${slotOpts}</select>
          <button class="btn" data-v="move-today">오늘만</button>
          ${weekly ? '<button class="btn btn-primary" data-v="move-tt">시간표에 반영</button>' : ''}</div></div>
      <div class="edit-sec"><h4>다른 학생으로 바꾸기</h4>
        <div class="add-row wrap"><input id="er-name" list="dl-er" placeholder="학생 이름" autocomplete="off">
          <button class="btn" data-v="swap-today">오늘만</button>
          ${weekly ? '<button class="btn btn-primary" data-v="swap-tt">시간표에 반영</button>' : ''}</div></div>
      <div class="edit-sec"><h4>빼기</h4>
        <div class="add-row wrap">
          <button class="btn" data-v="rm-today">${r.extra ? '오늘 추가 취소' : '오늘만 제외'}</button>
          ${weekly && !r.extra ? '<button class="btn btn-danger" data-v="rm-tt">시간표에서 빼기</button>' : ''}</div></div>
      ${r.extra && weekly ? `<div class="edit-sec"><h4>정기 수업으로</h4><div class="add-row wrap">
          <button class="btn btn-primary" data-v="keep-tt">시간표에 추가 (${weekly})</button></div></div>` : ''}
      <p class="subtle small">· <b>오늘만</b>: 이 날 일지에만 반영 (보강·결석·임시 변경)<br>
        · <b>시간표에 반영</b>: ${weekly || '평일만 가능'} 수업으로 바뀌고 이후 업무일지에도 자동 반영. 지난 일지는 그대로입니다.</p>
      <datalist id="dl-er">${activeStudents().map((s) => `<option value="${esc(s.name)}">${esc(s.grade)}</option>`).join('')}</datalist>`,
    foot: '<button class="btn" data-close>닫기</button>',
    onMount: (el, close) => el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.v;
      const nm = el.querySelector('#er-name').value.trim();
      if (v.startsWith('swap') && !nm) return toast('바꿀 학생 이름을 입력하세요.', 'warn');
      close({ v, slot: el.querySelector('#er-slot').value, name: nm });
    })),
  });
  if (!res) return;
  const carry = log.entries[r.key];
  const { v } = res;
  if (v === 'rm-today') { todayRemove(r); markDirty(); return drawLog(); }
  if (v === 'move-today') {
    if (rows.some((x) => x.key === keyOf(res.slot, r.item))) return toast('그 교시에 이미 있습니다.', 'warn');
    todayRemove(r); todayAdd(res.slot, r.item, carry); markDirty(); return drawLog();
  }
  if (v === 'swap-today') {
    const item = await resolveStudent(res.name);
    if (rows.some((x) => x.key === keyOf(r.slot, item))) return toast('이미 이 교시에 있는 학생입니다.', 'warn');
    todayRemove(r); todayAdd(r.slot, item); markDirty(); return drawLog();
  }
  // 이하: 시간표에 반영 (이 날부터)
  await flush();
  if (v === 'rm-tt') {
    await changeMyCell(r.slot, (items) => items.filter((x) => x !== r.item), `-${name}`);
    toast(`${date}부터 시간표에서 ${name}을(를) 뺐습니다.`);
  } else if (v === 'keep-tt') {
    todayRemove(r);
    await changeMyCell(r.slot, (items) => (items.includes(r.item) ? items : [...items, r.item]), `+${name}`);
    if (carry) log.entries[r.key] = { ...carry };
    markDirty();
    toast(`${date}부터 시간표에 ${name}을(를) 추가했습니다.`);
  } else if (v === 'move-tt') {
    const to = slotById(res.slot)?.label;
    await changeMyCells((cell) => {
      if (!r.extra) cell(r.slot, (items) => items.filter((x) => x !== r.item));
      cell(res.slot, (items) => (items.includes(r.item) ? items : [...items, r.item]));
    }, `${name} ${slotById(r.slot)?.label}→${to}`);
    if (r.extra) todayRemove(r);
    if (carry) log.entries[keyOf(res.slot, r.item)] = { ...carry };
    delete log.entries[r.key];
    markDirty();
    toast(`${date}부터 ${name}의 수업을 ${to}로 옮겼습니다.`);
  } else if (v === 'swap-tt') {
    const item = await resolveStudent(res.name);
    await changeMyCell(r.slot, (items) => {
      const out = items.filter((x) => x !== item);
      const i = out.indexOf(r.item);
      if (i >= 0) out[i] = item; else out.push(item);
      return out;
    }, `${name}→${itemLabel(item)}`);
    if (r.extra) todayRemove(r);
    delete log.entries[r.key];
    markDirty();
    toast(`${date}부터 ${name} 대신 ${itemLabel(item)}(으)로 바꿨습니다.`);
  }
  drawLog();
}

async function addExtra(presetSlot) {
  const f = await formModal('학생 추가', [
    { name: 'name', label: '학생 이름 (또는 메모)', required: true, list: 'dl-wl-students' },
    { name: 'slot', label: '교시', type: 'select', value: presetSlot || '', options: slots().map((s) => ({ value: s.id, label: `${s.label} (${s.time || ''})` })) },
    { name: 'mode', label: '추가 방식', type: 'select', value: 'today', options: [
      { value: 'today', label: '오늘만 추가 (보강·임시)' },
      { value: 'tt', label: `시간표에 추가 — ${fmtDate(date)}부터 매주 ${DAY_NAMES[dayOfDate(date)] || ''}요일` },
    ] },
  ], { ok: '추가', extra: `<datalist id="dl-wl-students">${activeStudents().map((s) => `<option value="${esc(s.name)}">${esc(s.grade)}</option>`).join('')}</datalist>` });
  if (!f) return;
  const item = await resolveStudent(f.name);
  const key = `${f.slot}|${itemKey(item)}`;
  if (rows.some((r) => r.key === key)) return toast('이미 목록에 있습니다.', 'warn');
  if (f.mode === 'tt') {
    if (!DAYS.includes(dayOfDate(date))) return toast('주말에는 시간표에 추가할 수 없습니다.', 'err');
    await flush();
    log.extras = (log.extras || []).filter((x) => !(x.removed && `${x.slot}|${itemKey(x.item)}` === key));
    await changeMyCell(f.slot, (items) => (items.includes(item) ? items : [...items, item]), `+${itemLabel(item)}`);
    toast(`${date}부터 시간표에 ${itemLabel(item)}을(를) 추가했습니다.`);
  } else {
    (log.extras ||= []).push({ slot: f.slot, item });
    entry(key).att = '보강';
    markDirty();
  }
  drawLog();
}

// ---------- 인쇄 ----------
async function printDialog() {
  await flush();
  const ts = state.teachers.filter((t) => t.active);
  const fields = [
    { name: 'from', label: '시작일', type: 'date', value: date, required: true },
    { name: 'to', label: '종료일', type: 'date', value: date, required: true },
  ];
  if (isAdmin()) fields.push({ name: 'teacher', label: '선생님', type: 'select', value: teacherId === 'all' ? 'all' : teacherId,
    options: [{ value: 'all', label: '전체 선생님 (선생님마다 1장)' }, ...ts.map((t) => ({ value: t.id, label: t.name }))] });
  fields.push({ name: 'blank', label: '', type: 'checkbox', value: true, text: '작성하지 않은 날도 시간표 기준 빈 양식으로 인쇄' });
  const f = await formModal('업무일지 인쇄 (A4, 일자별 1장)', fields, { ok: '인쇄' });
  if (!f) return;
  if (f.to < f.from) return toast('종료일이 시작일보다 빠릅니다.', 'err');
  if (datesBetween(f.from, f.to).length > 62) return toast('한 번에 최대 2개월까지 인쇄할 수 있습니다.', 'err');
  const tids = isAdmin() ? (f.teacher === 'all' ? ts.map((t) => t.id) : [Number(f.teacher)]) : [teacherId];
  const logs = await guard(() => api.getWorklogs(f.from, f.to, tids.length === 1 ? tids[0] : null));
  const byKey = Object.fromEntries(logs.map((w) => [`${w.log_date}|${w.teacher_id}`, w]));
  const pages = [];
  for (const d of datesBetween(f.from, f.to)) for (const tid of tids) {
    const w = byKey[`${d}|${tid}`];
    const base = worklogRows(d, tid);
    if (!w && (!f.blank || !base.length)) continue;
    pages.push({ date: d, teacherId: tid, log: w || { entries: {}, extras: [], notice: '', review: '' } });
  }
  if (!pages.length) return toast('인쇄할 일지가 없습니다.', 'warn');
  printWorklogs(pages);
}
