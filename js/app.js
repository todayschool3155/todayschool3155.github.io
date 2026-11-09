import { api, DEMO, getToken } from './api.js?v=202611092336';
import { state, reload, isAdmin, academyName, alerts, refreshAlerts, notices, refreshNotices, noticeState, noticeRead } from './store.js?v=202611092336';
import { esc, $, toast, guard, formModal, confirmBox } from './util.js?v=202611092336';
import * as home from './views/home.js?v=202611092336';
import * as timetable from './views/timetable.js?v=202611092336';
import * as worklog from './views/worklog.js?v=202611092336';
import * as students from './views/students.js?v=202611092336';
import * as admin from './views/admin.js?v=202611092336';
import * as audit from './views/audit.js?v=202611092336';
import * as tests from './views/tests.js?v=202611092336';
import * as stats from './views/stats.js?v=202611092336';
import * as noticesView from './views/notices.js?v=202611092336';
import './studentcard.js';

// bottom: 휴대폰 하단 메뉴에 표시 (나머지는 우측 상단 메뉴)
// \uFE0E: 아이폰에서 아이콘이 컬러 이모지로 바뀌지 않고 선 모양으로 보이게
const ROUTES = {
  home: { label: '홈', icon: '⌂\uFE0E', view: home, bottom: true },
  timetable: { label: '시간표', icon: '▦', view: timetable, bottom: true },
  worklog: { label: '업무일지', icon: '✎\uFE0E', view: worklog, bottom: true },
  notices: { label: '공지', icon: '✉\uFE0E', view: noticesView, bottom: true },
  tests: { label: '성적', icon: '✓\uFE0E', view: tests, bottom: true },
  students: { label: '학생', icon: '☺\uFE0E', view: students, admin: true, bottom: true },
  stats: { label: '통계', icon: '▤', view: stats, admin: true },
  admin: { label: '관리', icon: '⚙\uFE0E', view: admin, admin: true },
  audit: { label: '로그', icon: '☰\uFE0E', view: audit, admin: true },
};

const app = $('#app');
let current = null;

async function boot() {
  if (!getToken()) return showLogin();
  try {
    await reload();
  } catch (e) {
    if (e.code === 'AUTH_REQUIRED') return showLogin();
    app.innerHTML = `<div class="boot-error"><h1>${esc(academyName())}</h1><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">다시 시도</button></div>`;
    return;
  }
  renderShell();
  window.addEventListener('hashchange', route);
  route();
  refreshAlerts(true).then(paintAlerts).catch(() => {});
  window.addEventListener('alerts-changed', paintAlerts);
  refreshNotices(true).then(paintNotices).catch(() => {});
  window.addEventListener('notices-changed', paintNotices);
}

// 공지: 메뉴 배지(안 읽은 진행·예정 공지) + 선생님 화면 상단 알림
function paintNotices() {
  const unread = isAdmin() ? [] : notices.list.filter((n) => noticeState(n) !== 'past' && !noticeRead(n));
  document.querySelectorAll('[data-route="notices"]').forEach((a) => {
    a.querySelector('.nbadge')?.remove();
    if (unread.length) a.insertAdjacentHTML('beforeend', `<span class="nbadge nbadge-notice" title="확인하지 않은 공지">${unread.length}</span>`);
  });
  const bar = $('#notice-banner');
  if (!bar) return;
  const onNotices = location.hash.startsWith('#/notices');
  bar.hidden = !unread.length || onNotices;
  if (unread.length) bar.innerHTML = `📢 확인하지 않은 공지 <b>${unread.length}건</b>: ${esc(unread[0].title)}${unread.length > 1 ? ` 외 ${unread.length - 1}건` : ''}
    <a href="#/notices">공지 보기</a>`;
}

// 업무일지 미작성 알림: 메뉴 배지 + (선생님) 상단 배너
function paintAlerts() {
  const n = alerts.missing.length;
  document.querySelectorAll('[data-route="worklog"]').forEach((a) => {
    a.querySelector('.nbadge')?.remove();
    if (n) a.insertAdjacentHTML('beforeend', `<span class="nbadge" title="밀린 업무일지">${n > 99 ? '99+' : n}</span>`);
  });
  const bar = $('#alert-banner');
  if (!bar) return;
  const first = alerts.missing[0];
  const onHome = /^#\/?(home)?$/.test(location.hash || '#/home');
  bar.hidden = !n || isAdmin() || onHome;
  if (n && !isAdmin()) bar.innerHTML = `🔔 작성하지 않은 업무일지가 <b>${n}건</b> 있습니다.
    <a href="#/worklog/${first.date}/${first.teacherId}">가장 오래된 날(${first.date.slice(5).replace('-', '/')})부터 작성하기</a> · <a href="#/home">전체 보기</a>`;
}

function showLogin() {
  document.title = '로그인 · 시간표·업무일지';
  app.innerHTML = `
    <main class="login">
      <form class="login-card" id="login-form">
        <img class="login-logo" src="img/logo.webp" alt="오늘학원 영어수학전문학원">
        <p class="login-sub">시간표 · 업무일지</p>
        ${DEMO ? '<p class="demo-note">데모 모드 — 데이터가 이 브라우저에만 저장됩니다.</p>' : ''}
        <label>아이디<input name="uid" autocomplete="username" required autocapitalize="off" spellcheck="false"></label>
        <label>비밀번호<input name="pw" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary btn-block" type="submit">로그인</button>
        <p class="login-err" role="alert"></p>
      </form>
    </main>`;
  const f = $('#login-form');
  f.uid.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      await api.login(f.uid.value, f.pw.value);
      location.reload();
    } catch (err) {
      $('.login-err').textContent = err.message;
      btn.disabled = false;
    }
  });
}

function renderShell() {
  const nav = Object.entries(ROUTES).filter(([, r]) => !r.admin || isAdmin());
  app.innerHTML = `
    <header class="topbar no-print">
      <a class="brand" href="#/home"><img class="logo" src="img/mark.png" alt=""><span>${esc(academyName())}</span></a>
      <nav class="topnav">${nav.map(([k, r]) => `<a href="#/${k}" data-route="${k}">${r.label}</a>`).join('')}</nav>
      <div class="usermenu">
        ${DEMO ? '<span class="badge badge-warn" title="Supabase 연결 전 테스트용">데모</span>' : ''}
        <button class="btn btn-ghost" id="user-btn" aria-haspopup="true">${esc(state.user.name || state.user.login_id)} ▾</button>
        <div class="dropdown" id="user-dd" hidden>
          <div class="dd-info">${esc(state.user.login_id)} · ${isAdmin() ? '관리자' : '선생님'}</div>
          ${nav.filter(([, r]) => !r.bottom).map(([k, r]) => `<a class="dd-link" href="#/${k}">${r.icon} ${r.label}</a>`).join('')}
          <button data-act="pw">비밀번호 변경</button>
          <button data-act="logout">로그아웃</button>
        </div>
      </div>
    </header>
    ${state.user.must_change ? '<div class="banner no-print">초기 비밀번호(today1234)를 사용 중입니다. <button class="linklike" data-act="pw">지금 변경하기</button></div>' : ''}
    <div class="banner banner-notice no-print" id="notice-banner" hidden></div>
    <div class="banner banner-alarm no-print" id="alert-banner" hidden></div>
    <main id="view" class="view"></main>
    <nav class="bottomnav no-print">${nav.filter(([, r]) => r.bottom).map(([k, r]) => `<a href="#/${k}" data-route="${k}"><span class="bn-ico">${r.icon}</span>${r.label}</a>`).join('')}</nav>
    <div id="print-root"></div>`;

  const dd = $('#user-dd');
  $('#user-btn').addEventListener('click', (e) => { e.stopPropagation(); dd.hidden = !dd.hidden; });
  document.addEventListener('click', () => { dd.hidden = true; });
  app.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'logout') {
      if (window.__dirty && !(await confirmBox('저장하지 않은 내용이 있습니다. 로그아웃할까요?'))) return;
      await api.logout().catch(() => {});
      location.hash = '';
      location.reload();
    } else if (act === 'pw') {
      changePassword();
    }
  });
}

async function changePassword() {
  const r = await formModal('비밀번호 변경', [
    { name: 'old', label: '현재 비밀번호', type: 'password', required: true },
    { name: 'new1', label: '새 비밀번호 (6자 이상)', type: 'password', required: true },
    { name: 'new2', label: '새 비밀번호 확인', type: 'password', required: true },
  ], { ok: '변경' });
  if (!r) return;
  if (r.new1 !== r.new2) return toast('새 비밀번호가 서로 다릅니다.', 'err');
  await guard(() => api.changePassword(r.old, r.new1), '비밀번호가 변경되었습니다.');
  state.user.must_change = false;
  $('.banner')?.remove();
}

async function route() {
  let [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  if (!ROUTES[name] || (ROUTES[name].admin && !isAdmin())) name = 'home';
  if (current?.leave && !(await current.leave())) {
    history.replaceState(null, '', `#/${current.name}`);
    return;
  }
  document.querySelectorAll('.modal-wrap').forEach((w) => w.querySelector('[data-close]')?.click());
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  document.title = `${ROUTES[name].label} · ${academyName()}`;
  const view = $('#view');
  view.innerHTML = '';
  view.className = `view view-${name}`;
  current = { name, ...ROUTES[name].view };
  try {
    await ROUTES[name].view.render(view, rest);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`;
  }
  if (name !== 'home') refreshAlerts().then(paintAlerts).catch(() => {});
  refreshNotices().then(paintNotices).catch(() => {});
}

window.addEventListener('beforeunload', (e) => {
  if (window.__dirty) { e.preventDefault(); e.returnValue = ''; }
});

boot();
