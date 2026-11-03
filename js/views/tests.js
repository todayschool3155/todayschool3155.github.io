// 테스트 성적: 금요 테스트 등 입력·조회·인쇄 (관리자·선생님 모두 입력 가능)
import { api } from '../api.js?v=202611032203';
import { state, isAdmin, activeStudents, studentById, versionFor, cellOf, slots, dayOfDate, DAYS, teacherById } from '../store.js?v=202611032203';
import { esc, $, today, addDays, addMonths, fmtDate, fmtDateTime, toast, guard, confirmBox, modal, weekday, DAY_NAMES } from '../util.js?v=202611032203';
import { num } from '../chart.js?v=202611032203';
import { studentLink } from '../studentcard.js?v=202611032203';
import { printTest } from '../print.js?v=202611032203';

const DEFAULT_ITEMS = { 영어: ['듣기', '문법'], 수학: ['개별', '공통'] };
let root, tests = [], months = 3, cur = null, dirty = false;

export async function render(el) {
  root = el;
  cur = null;
  await loadList();
}

export async function leave() {
  if (dirty && !(await confirmBox('저장하지 않은 성적이 있습니다. 나갈까요?', { ok: '나가기', danger: true }))) return false;
  dirty = false; window.__dirty = false;
  return true;
}

async function loadList() {
  root.innerHTML = '<div class="loading">불러오는 중…</div>';
  tests = await guard(() => api.getTests(addMonths(today(), -months), addDays(today(), 7)));
  drawList();
}

const avg = (t, item) => {
  const v = Object.values(t.scores).map((x) => num(x[item])).filter((x) => x != null);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const fmtAvg = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toString());

function drawList() {
  root.innerHTML = `
    <div class="toolbar">
      <div class="tb-group">
        <select id="ts-range">${[1, 3, 6, 12].map((m) => `<option value="${m}" ${m === months ? 'selected' : ''}>최근 ${m}개월</option>`).join('')}</select>
      </div>
      <div class="tb-group"><button class="btn btn-primary" id="ts-new">+ 테스트 입력</button></div>
    </div>
    <div class="table-scroll"><table class="list">
      <thead><tr><th>날짜</th><th>과목</th><th>테스트</th><th>응시</th><th>항목별 평균</th><th class="hide-sm">입력</th></tr></thead>
      <tbody>${tests.map((t) => `<tr class="clickable" data-id="${t.id}">
        <td class="nowrap">${fmtDate(t.test_date)}</td><td><span class="tag tag-${t.subject === '수학' ? 'math' : t.subject === '영어' ? 'eng' : 'etc'}">${esc(t.subject)}</span></td>
        <td><b>${esc(t.title)}</b></td><td>${Object.keys(t.scores).length}명</td>
        <td class="small">${t.items.map((i) => `${esc(i)} <b>${fmtAvg(avg(t, i))}</b>`).join(' · ')}</td>
        <td class="hide-sm small subtle">${esc(t.updated_by)} ${fmtDateTime(t.updated_at)}</td></tr>`).join('')
        || '<tr><td colspan="6" class="empty">입력된 테스트가 없습니다. "+ 테스트 입력"을 눌러 시작하세요.</td></tr>'}</tbody>
    </table></div>
    <p class="subtle small">학생 이름을 누르면 성적 추이를 볼 수 있습니다. 점수 칸에 숫자 대신 "병결", "재시험" 등을 적으면 평균에서 빠집니다.</p>`;
  $('#ts-range').addEventListener('change', (e) => { months = Number(e.target.value); loadList(); });
  $('#ts-new').addEventListener('click', () => edit(null));
  root.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) edit(tests.find((t) => t.id === Number(tr.dataset.id)));
  });
}

// 이번 주 금요일 (주말이면 지난 금요일)
function fridayOf(d) {
  const w = weekday(d);
  return addDays(d, w === 6 ? -1 : w === 0 ? -2 : 5 - w);
}

// 시간표에서 수업(요일 × 교시 × 선생님)을 골라 그 학생들을 명단에 추가
async function pickClasses() {
  const v = versionFor(cur.test_date);
  const d = DAYS.includes(dayOfDate(cur.test_date)) ? dayOfDate(cur.test_date) : 5;
  const tids = state.teachers.filter((t) => t.active && (cur.subject === '기타' || t.subject === cur.subject)).map((t) => t.id);
  const opts = [];
  for (const s of slots()) for (const tid of tids) {
    const ids = cellOf(v?.grid, d, s.id, tid).items.filter((it) => typeof it === 'number' && studentById(it)?.status === 'active');
    if (ids.length) opts.push({ key: `${s.id}|${tid}`, label: `${s.label} ${teacherById(tid)?.name}`, ids });
  }
  if (!opts.length) return toast(`${DAY_NAMES[d]}요일 ${cur.subject} 수업이 시간표에 없습니다.`, 'warn');
  const picked = await modal({
    title: `${DAY_NAMES[d]}요일 수업에서 학생 불러오기`,
    body: `<p class="subtle small">테스트를 본 수업을 고르세요. (${esc(cur.subject)} 선생님 수업)</p>
      <div class="pick-list">${opts.map((o) => `<label class="check"><input type="checkbox" value="${o.key}"> <b>${esc(o.label)}</b>
        <span class="subtle small">${o.ids.length}명 · ${esc(o.ids.slice(0, 5).map((i) => studentById(i).name).join(', '))}${o.ids.length > 5 ? ' …' : ''}</span></label>`).join('')}</div>`,
    foot: '<button class="btn" data-close>취소</button><button class="btn btn-primary" id="pk-ok">불러오기</button>',
    onMount: (el, close) => el.querySelector('#pk-ok').addEventListener('click', () =>
      close([...el.querySelectorAll('input:checked')].map((x) => x.value))),
  });
  if (!picked?.length) return;
  let n = 0;
  for (const o of opts) if (picked.includes(o.key)) for (const id of o.ids) if (!cur.scores[id]) { cur.scores[id] = {}; n++; }
  toast(n ? `${n}명을 추가했습니다.` : '이미 모두 명단에 있습니다.', n ? 'ok' : 'warn');
  if (n) { setDirty(); drawEditor(); }
}

function edit(t) {
  const date = fridayOf(today());
  cur = t ? structuredClone(t) : {
    test_date: date, subject: '영어', title: `${Number(date.slice(5, 7))}월 금요 테스트`, items: [...DEFAULT_ITEMS.영어], scores: {}, memo: '',
  };
  dirty = false;
  drawEditor();
}

function setDirty() { dirty = true; window.__dirty = true; const b = $('#te-state'); if (b) b.textContent = '저장 안 됨'; }

function drawEditor() {
  const ids = Object.keys(cur.scores).map(Number).sort((a, b) => (studentById(a)?.name || '').localeCompare(studentById(b)?.name || '', 'ko'));
  root.innerHTML = `
    <div class="toolbar">
      <div class="tb-group"><button class="btn" id="te-back">← 목록</button><span id="te-state" class="save-state">${cur.id ? '저장됨' : '새 테스트'}</span></div>
      <div class="tb-group">
        <button class="btn" id="te-print" ${cur.id ? '' : 'disabled'}>인쇄</button>
        ${cur.id && isAdmin() ? '<button class="btn btn-danger" id="te-del">삭제</button>' : ''}
        <button class="btn btn-primary" id="te-save">저장</button>
      </div>
    </div>
    <section class="card te-form">
      <label>날짜<input type="date" id="te-date" value="${cur.test_date}"></label>
      <label>과목<select id="te-subj">${['영어', '수학', '기타'].map((s) => `<option ${s === cur.subject ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="grow">테스트 이름<input id="te-title" value="${esc(cur.title)}"></label>
      <label class="grow">평가 항목 (쉼표로 구분)<input id="te-items" value="${esc(cur.items.join(', '))}"></label>
    </section>
    <div class="table-scroll"><table class="list te-table">
      <thead><tr><th>NO</th><th>이름</th>${cur.items.map((i) => `<th>${esc(i)}</th>`).join('')}<th>비고</th><th></th></tr></thead>
      <tbody>${ids.length ? '' : `<tr><td colspan="${cur.items.length + 4}" class="empty">아래 "수업에서 학생 불러오기"로 응시 학생을 추가하세요.</td></tr>`}${ids.map((id, n) => `<tr data-sid="${id}"><td>${n + 1}</td>
        <td class="nowrap">${studentLink(id)} <small class="subtle">${esc(studentById(id)?.grade || '')}</small></td>
        ${cur.items.map((i) => `<td><input class="score" data-item="${esc(i)}" value="${esc(cur.scores[id]?.[i] ?? '')}" inputmode="decimal" aria-label="${esc(i)}"></td>`).join('')}
        <td><input data-item="note" value="${esc(cur.scores[id]?.note ?? '')}" placeholder="병결, 재시험…" aria-label="비고"></td>
        <td><button class="icon-btn danger" data-rm="${id}" aria-label="삭제">✕</button></td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="2">평균</th>${cur.items.map((i) => `<th data-avg="${esc(i)}">${fmtAvg(avg(cur, i))}</th>`).join('')}<th colspan="2"></th></tr></tfoot>
    </table></div>
    <form class="add-row te-add" id="te-add">
      <input id="te-name" list="dl-te" placeholder="학생 추가 (이름)" autocomplete="off">
      <button class="btn" type="submit">추가</button>
      <button class="btn btn-primary" type="button" id="te-roster">수업에서 학생 불러오기</button>
    </form>
    <datalist id="dl-te">${activeStudents().map((s) => `<option value="${esc(s.name)}">${esc(s.grade)}</option>`).join('')}</datalist>
    <p class="subtle small">Enter 키 또는 ↓ 키로 다음 학생 칸으로 이동합니다.</p>`;
  bindEditor();
}

function bindEditor() {
  $('#te-back').addEventListener('click', async () => {
    if (dirty && !(await confirmBox('저장하지 않은 내용이 있습니다. 목록으로 갈까요?', { danger: true }))) return;
    dirty = false; window.__dirty = false; loadList();
  });
  const meta = () => {
    cur.test_date = $('#te-date').value || cur.test_date;
    cur.title = $('#te-title').value.trim();
    const items = $('#te-items').value.split(',').map((x) => x.trim()).filter(Boolean);
    const changed = items.join() !== cur.items.join();
    cur.items = items;
    setDirty();
    if (changed) drawEditor();
  };
  $('#te-date').addEventListener('change', meta);
  $('#te-title').addEventListener('input', meta);
  $('#te-items').addEventListener('change', meta);
  $('#te-subj').addEventListener('change', (e) => {
    const old = cur.subject;
    cur.subject = e.target.value;
    if (cur.items.join() === (DEFAULT_ITEMS[old] || []).join() && DEFAULT_ITEMS[cur.subject]) cur.items = [...DEFAULT_ITEMS[cur.subject]];
    setDirty();
    drawEditor();
  });
  const tbody = root.querySelector('.te-table tbody');
  tbody.addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-sid]');
    const item = e.target.dataset.item;
    if (!tr || !item) return;
    const sc = (cur.scores[tr.dataset.sid] ||= {});
    if (e.target.value.trim()) sc[item] = e.target.value.trim(); else delete sc[item];
    const th = root.querySelector(`[data-avg="${CSS.escape(item)}"]`);
    if (th) th.textContent = fmtAvg(avg(cur, item));
    setDirty();
  });
  // Enter / ↓ : 아래 학생 같은 항목으로
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const tr = e.target.closest('tr');
    const idx = [...tr.querySelectorAll('input')].indexOf(e.target);
    const next = e.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
    if (next) { e.preventDefault(); next.querySelectorAll('input')[idx]?.focus(); next.querySelectorAll('input')[idx]?.select(); }
  });
  tbody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    delete cur.scores[b.dataset.rm];
    setDirty();
    drawEditor();
  });
  $('#te-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#te-name').value.trim();
    const s = activeStudents().filter((x) => x.name === name);
    if (!s.length) return toast('재원생 목록에 없는 이름입니다.', 'warn');
    for (const x of s) cur.scores[x.id] ||= {};
    setDirty();
    drawEditor();
    $('#te-name').focus();
  });
  $('#te-roster').addEventListener('click', pickClasses);
  $('#te-save').addEventListener('click', async () => {
    if (!cur.title) return toast('테스트 이름을 입력하세요.', 'err');
    if (!cur.items.length) return toast('평가 항목을 입력하세요.', 'err');
    const saved = await guard(() => api.saveTest(cur), '저장했습니다.');
    cur = structuredClone(saved);
    dirty = false; window.__dirty = false;
    drawEditor();
  });
  $('#te-print').addEventListener('click', () => printTest(cur));
  $('#te-del')?.addEventListener('click', async () => {
    if (!(await confirmBox(`"${cur.title}" 성적을 삭제할까요?`, { ok: '삭제', danger: true }))) return;
    await guard(() => api.deleteTest(cur.id), '삭제했습니다.');
    dirty = false; window.__dirty = false;
    loadList();
  });
}
