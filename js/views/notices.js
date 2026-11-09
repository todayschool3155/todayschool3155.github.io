// 공지사항: 관리자 작성(대상·기간·요일·교시 선택) / 선생님 확인 표시. 오늘 기준 최신순, 지난 공지는 뒤로
import { api } from '../api.js?v=202611092336';
import {
  state, isAdmin, slots, slotById, teacherById, refreshNotices, notices as cache, noticeState, sortNotices, noticeRead, DAYS,
} from '../store.js?v=202611092336';
import { esc, $, today, addDays, mondayOf, fmtDateTime, toast, guard, modal, confirmBox, DAY_NAMES, WEEKDAYS, weekday, ymd } from '../util.js?v=202611092336';

let root, tab = 'live', users = [];

export async function render(el) {
  root = el;
  root.innerHTML = '<div class="loading">불러오는 중…</div>';
  const [list] = await Promise.all([guard(() => refreshNotices(true)), ensureUsers(true)]);
  draw(list);
}

// 관리자 화면의 확인 현황(대상 계정 수)용 — 홈·업무일지에서도 호출
export async function ensureUsers(force = false) {
  if (isAdmin() && (force || !users.length)) users = await api.listUsers().catch(() => []);
}

const STATE_LABEL = { now: '진행 중', soon: '예정', past: '지난 공지' };
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${WEEKDAYS[weekday(d)]})`;

export function noticeMeta(n) {
  const who = n.targets?.length ? n.targets.map((t) => teacherById(t)?.name || `#${t}`).join(', ') : '전체 선생님';
  const when = n.start_date === n.end_date ? md(n.start_date) : `${md(n.start_date)} ~ ${md(n.end_date)}`;
  const days = n.weekdays?.length ? n.weekdays.slice().sort().map((d) => DAY_NAMES[d]).join('·') + '요일' : '';
  const time = n.slots?.length ? n.slots.map((s) => slotById(s)?.label || s).join(', ') : '하루 종일';
  return { who, when, days, time };
}

// 대상 선생님들의 로그인 계정 (확인 현황용)
function recipients(n) {
  const tids = n.targets?.length ? n.targets : state.teachers.filter((t) => t.active).map((t) => t.id);
  return users.filter((u) => u.active && u.role === 'teacher' && tids.includes(u.teacher_id));
}

export function noticeCard(n, { compact = false } = {}) {
  const m = noticeMeta(n);
  const st = noticeState(n);
  const isToday = st === 'now';
  let foot = '';
  if (isAdmin()) {
    const rs = recipients(n);
    const read = rs.filter((u) => n.reads?.[u.login_id]);
    const unread = rs.filter((u) => !n.reads?.[u.login_id]);
    foot = `<span class="small subtle">확인 ${read.length}/${rs.length}${unread.length ? ` · 미확인: ${unread.map((u) => esc(u.name || u.login_id)).join(', ')}` : ''}</span>
      ${compact ? '' : `<span class="row-actions">
        <button class="btn btn-sm" data-ncopy="${n.id}">복사</button>
        <button class="btn btn-sm" data-nedit="${n.id}">수정</button>
        <button class="btn btn-sm btn-danger" data-ndel="${n.id}">삭제</button></span>`}`;
  } else {
    foot = noticeRead(n)
      ? `<span class="small ok-line">✓ 확인함 ${fmtDateTime(n.reads[state.user.login_id]).slice(5)}</span>`
      : `<button class="btn btn-sm btn-primary" data-nack="${n.id}">확인했습니다</button>`;
  }
  return `<article class="notice ${n.important ? 'is-important' : ''} st-${st} ${!isAdmin() && !noticeRead(n) && st !== 'past' ? 'is-unread' : ''}">
    <header>
      ${n.important ? '<span class="badge badge-err">중요</span>' : ''}
      <span class="badge ${isToday ? 'badge-ok' : ''}">${STATE_LABEL[st]}</span>
      <h3>${esc(n.title)}</h3>
    </header>
    <p class="notice-meta small"><span>대상 <b>${esc(m.who)}</b></span><span>기간 <b>${m.when}</b></span>${m.days ? `<span>요일 <b>${m.days}</b></span>` : ''}<span>시간 <b>${esc(m.time)}</b></span></p>
    ${n.body ? `<div class="notice-body pre">${esc(n.body)}</div>` : ''}
    <footer>${foot}<span class="small subtle">${esc(n.created_by)} · ${fmtDateTime(n.created_at).slice(5)}</span></footer>
  </article>`;
}

// 확인 버튼 (홈·업무일지에서도 사용)
export async function ackNotice(id) {
  const r = await guard(() => api.ackNotice(id));
  const i = cache.list.findIndex((n) => n.id === id);
  if (i >= 0) cache.list[i] = r;
  window.dispatchEvent(new Event('notices-changed'));
  return r;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-nack]');
  if (!b) return;
  b.disabled = true;
  await ackNotice(Number(b.dataset.nack));
  toast('확인했습니다.');
  if (root?.isConnected && location.hash.startsWith('#/notices')) draw(cache.list);
});

function draw(list) {
  const sorted = sortNotices(list);
  const live = sorted.filter((n) => noticeState(n) !== 'past');
  const past = sorted.filter((n) => noticeState(n) === 'past');
  const shown = tab === 'live' ? live : tab === 'past' ? past : sorted;
  root.innerHTML = `
    <div class="toolbar">
      <div class="seg" role="tablist">
        ${[['live', `진행·예정 ${live.length}`], ['past', `지난 공지 ${past.length}`], ['all', '전체']].map(([k, l]) =>
          `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      ${isAdmin() ? '<button class="btn btn-primary" id="n-new">+ 공지 작성</button>' : ''}
    </div>
    <p class="subtle small">오늘 기준 최신 공지가 위에 오고, 기간이 끝난 공지는 자동으로 뒤(지난 공지)로 갑니다.</p>
    <div class="notice-list">${shown.map((n) => noticeCard(n)).join('') || '<div class="empty">공지가 없습니다.</div>'}</div>`;
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(list); }));
  $('#n-new')?.addEventListener('click', () => edit(null));
  root.querySelector('.notice-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-nedit],[data-ncopy],[data-ndel]');
    if (!b) return;
    const n = list.find((x) => x.id === Number(b.dataset.nedit || b.dataset.ncopy || b.dataset.ndel));
    if (b.dataset.nedit) edit(n);
    else if (b.dataset.ncopy) edit({ ...n, id: undefined, reads: {}, start_date: today(), end_date: n.end_date < today() ? today() : n.end_date });
    else if (await confirmBox(`"${n.title}" 공지를 삭제할까요?`, { ok: '삭제', danger: true })) {
      await guard(() => api.deleteNotice(n.id), '삭제했습니다.');
      draw(await refreshNotices(true));
    }
  });
}

// ---------- 작성·수정 ----------
async function edit(n) {
  const t0 = today();
  const cur = n || { title: '', body: '', important: false, targets: [], start_date: t0, end_date: t0, weekdays: [], slots: [] };
  const ts = state.teachers.filter((t) => t.active || cur.targets?.includes(t.id));
  const res = await modal({
    title: n?.id ? '공지 수정' : '공지 작성',
    wide: true,
    body: `<form class="form notice-form" id="nf">
      <div class="field"><label for="nf-title">제목</label><input id="nf-title" value="${esc(cur.title)}" required placeholder="예: 11/12(수) 학부모 상담 주간"></div>
      <div class="field"><label for="nf-body">내용</label><textarea id="nf-body" rows="5" placeholder="선생님들께 전달할 내용">${esc(cur.body)}</textarea></div>
      <label class="check"><input type="checkbox" id="nf-imp" ${cur.important ? 'checked' : ''}> 중요 공지 (맨 위에 빨간 표시)</label>

      <fieldset class="nf-set"><legend>대상</legend>
        <label class="check"><input type="radio" name="who" value="all" ${!cur.targets?.length ? 'checked' : ''}> 전체 선생님</label>
        <label class="check"><input type="radio" name="who" value="some" ${cur.targets?.length ? 'checked' : ''}> 선택한 선생님만</label>
        <div class="nf-opts" data-for="who">${ts.map((t) => `<label class="chipbox"><input type="checkbox" name="tid" value="${t.id}" ${cur.targets?.includes(t.id) ? 'checked' : ''}>${esc(t.name)}</label>`).join('')}</div>
      </fieldset>

      <fieldset class="nf-set"><legend>기간</legend>
        <div class="add-row wrap"><input type="date" id="nf-from" value="${cur.start_date}"> ~ <input type="date" id="nf-to" value="${cur.end_date}">
          <button type="button" class="btn btn-sm" data-range="today">오늘만</button>
          <button type="button" class="btn btn-sm" data-range="week">이번 주</button>
          <button type="button" class="btn btn-sm" data-range="next">다음 주</button>
          <button type="button" class="btn btn-sm" data-range="month">이번 달</button></div>
      </fieldset>

      <fieldset class="nf-set"><legend>요일</legend>
        <label class="check"><input type="radio" name="dow" value="all" ${!cur.weekdays?.length ? 'checked' : ''}> 기간 중 매일</label>
        <label class="check"><input type="radio" name="dow" value="some" ${cur.weekdays?.length ? 'checked' : ''}> 선택한 요일만</label>
        <div class="nf-opts" data-for="dow">${DAYS.map((d) => `<label class="chipbox"><input type="checkbox" name="wd" value="${d}" ${cur.weekdays?.includes(d) ? 'checked' : ''}>${DAY_NAMES[d]}</label>`).join('')}</div>
      </fieldset>

      <fieldset class="nf-set"><legend>시간</legend>
        <label class="check"><input type="radio" name="tm" value="all" ${!cur.slots?.length ? 'checked' : ''}> 하루 종일</label>
        <label class="check"><input type="radio" name="tm" value="some" ${cur.slots?.length ? 'checked' : ''}> 선택한 교시만</label>
        <div class="nf-opts" data-for="tm">${slots().map((s) => `<label class="chipbox"><input type="checkbox" name="sl" value="${s.id}" ${cur.slots?.includes(s.id) ? 'checked' : ''}>${esc(s.label)}</label>`).join('')}</div>
      </fieldset>
      <p class="subtle small" id="nf-preview"></p>
    </form>`,
    foot: '<button class="btn" data-close>취소</button><button class="btn btn-primary" id="nf-ok">저장</button>',
    onMount: (el, close) => {
      const f = el.querySelector('#nf');
      const sync = () => {
        for (const [radio, box] of [['who', 'who'], ['dow', 'dow'], ['tm', 'tm']]) {
          const some = f.querySelector(`input[name=${radio}]:checked`).value === 'some';
          el.querySelector(`.nf-opts[data-for=${box}]`).classList.toggle('is-off', !some);
        }
        const v = read();
        const m = noticeMeta(v);
        el.querySelector('#nf-preview').textContent = `→ ${m.who} · ${m.when}${m.days ? ' · ' + m.days : ''} · ${m.time}`;
      };
      const read = () => {
        const pick = (radio, name, num) => (f.querySelector(`input[name=${radio}]:checked`).value === 'some'
          ? [...f.querySelectorAll(`input[name=${name}]:checked`)].map((x) => (num ? Number(x.value) : x.value)) : []);
        return {
          ...(n?.id ? { id: n.id } : {}),
          title: el.querySelector('#nf-title').value.trim(), body: el.querySelector('#nf-body').value.trim(),
          important: el.querySelector('#nf-imp').checked,
          targets: pick('who', 'tid', true), weekdays: pick('dow', 'wd', true), slots: pick('tm', 'sl', false),
          start_date: el.querySelector('#nf-from').value || t0, end_date: el.querySelector('#nf-to').value || t0,
        };
      };
      // 체크박스를 누르면 "선택" 쪽 라디오가 자동으로 선택
      f.addEventListener('change', (e) => {
        const box = e.target.closest('.nf-opts');
        if (box && e.target.checked) f.querySelector(`input[name=${box.dataset.for}][value=some]`).checked = true;
        sync();
      });
      f.addEventListener('input', sync);
      el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
        const r = b.dataset.range;
        const mon = mondayOf(t0);
        const [a, z] = r === 'today' ? [t0, t0] : r === 'week' ? [t0, addDays(mon, 4)] : r === 'next' ? [addDays(mon, 7), addDays(mon, 11)]
          : [t0, ymd(new Date(Number(t0.slice(0, 4)), Number(t0.slice(5, 7)), 0))];
        el.querySelector('#nf-from').value = a; el.querySelector('#nf-to').value = z < a ? a : z;
        sync();
      }));
      el.querySelector('#nf-ok').addEventListener('click', () => {
        const v = read();
        if (!v.title) return toast('제목을 입력하세요.', 'err');
        if (v.end_date < v.start_date) return toast('종료일이 시작일보다 빠릅니다.', 'err');
        if (f.querySelector('input[name=who]:checked').value === 'some' && !v.targets.length) return toast('대상 선생님을 고르세요.', 'err');
        if (f.querySelector('input[name=dow]:checked').value === 'some' && !v.weekdays.length) return toast('요일을 고르세요.', 'err');
        if (f.querySelector('input[name=tm]:checked').value === 'some' && !v.slots.length) return toast('교시를 고르세요.', 'err');
        close(v);
      });
      sync();
    },
  });
  if (!res) return;
  await guard(() => api.saveNotice(res), n?.id ? '수정했습니다.' : '공지를 올렸습니다.');
  tab = 'live';
  draw(await refreshNotices(true));
}
