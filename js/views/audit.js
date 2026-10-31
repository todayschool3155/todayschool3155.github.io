// 로그 기록: 로그인/시간표·학생·일지 변경 이력 조회, CSV 저장
import { api } from '../api.js?v=202611010012';
import { esc, $, today, addDays, fmtDateTime, guard, download } from '../util.js?v=202611010012';

const ACTIONS = {
  login: '로그인', login_fail: '로그인 실패', logout: '로그아웃', password_change: '비밀번호 변경', password_reset: '비밀번호 초기화',
  timetable_create: '시간표 버전 생성', timetable_update: '시간표 수정', timetable_delete: '시간표 버전 삭제',
  student_create: '학생 등록', student_update: '학생 정보 수정', student_withdraw: '학생 퇴원', student_reactivate: '학생 재등록', student_delete: '학생 삭제',
  teacher_create: '선생님 추가', teacher_update: '선생님 수정', teacher_retire: '선생님 퇴사', teacher_rehire: '선생님 복직',
  user_create: '계정 생성', user_update: '계정 수정', user_delete: '계정 삭제',
  settings_update: '설정 변경', worklog_save: '업무일지 저장', worklog_purge: '일지 정리(삭제)', export: '전체 백업',
  test_save: '성적 입력', test_delete: '성적 삭제',
};
const GROUPS = {
  '': '전체', auth: '로그인', timetable: '시간표', student: '학생', worklog: '업무일지', test: '성적', admin: '관리',
};
const groupOf = (a) => (a.startsWith('login') || a === 'logout' || a.startsWith('password') ? 'auth'
  : a.startsWith('timetable') ? 'timetable' : a.startsWith('student') ? 'student' : a.startsWith('worklog') ? 'worklog' : a.startsWith('test') ? 'test' : 'admin');

let root, from = addDays(today(), -7), to = today(), group = '', q = '', rows = [];

export async function render(el) {
  root = el;
  root.innerHTML = `
    <div class="toolbar">
      <div class="tb-group">
        <input type="date" id="au-from" value="${from}"> ~ <input type="date" id="au-to" value="${to}">
        <select id="au-group">${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}" ${k === group ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="search" id="au-q" placeholder="아이디·대상 검색" value="${esc(q)}">
      </div>
      <div class="tb-group"><button class="btn" id="au-csv">CSV 저장</button></div>
    </div>
    <div id="au-list"></div>`;
  $('#au-from').addEventListener('change', (e) => { from = e.target.value; load(); });
  $('#au-to').addEventListener('change', (e) => { to = e.target.value; load(); });
  $('#au-group').addEventListener('change', (e) => { group = e.target.value; paint(); });
  $('#au-q').addEventListener('input', (e) => { q = e.target.value.trim(); paint(); });
  $('#au-csv').addEventListener('click', csv);
  await load();
}

async function load() {
  $('#au-list').innerHTML = '<div class="loading">불러오는 중…</div>';
  rows = await guard(() => api.getAudit(from, to, 5000));
  paint();
}

const filtered = () => rows.filter((r) => (!group || groupOf(r.action) === group)
  && (!q || r.login_id.includes(q) || (r.target || '').includes(q) || JSON.stringify(r.detail || '').includes(q)));

function detailText(r) {
  const d = r.detail;
  if (!d) return '';
  if (Array.isArray(d.changes)) return d.changes.join(' · ');
  return Object.entries(d).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
}

function paint() {
  const list = filtered();
  $('#au-list').innerHTML = `<p class="subtle">${list.length}건</p>
    <div class="table-scroll"><table class="list audit">
      <thead><tr><th>시간</th><th>아이디</th><th>작업</th><th>대상</th><th>상세</th></tr></thead>
      <tbody>${list.map((r) => `<tr class="${r.action === 'login_fail' ? 'is-warn' : ''}">
        <td class="nowrap small">${fmtDateTime(r.at)}</td><td>${esc(r.login_id)}</td>
        <td><span class="tag tag-${groupOf(r.action)}">${esc(ACTIONS[r.action] || r.action)}</span></td>
        <td>${esc(r.target)}</td><td class="small detail">${esc(detailText(r))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">기록 없음</td></tr>'}
      </tbody></table></div>`;
}

function csv() {
  const q2 = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['시간', '아이디', '작업', '대상', '상세'].join(',')]
    .concat(filtered().map((r) => [fmtDateTime(r.at), r.login_id, ACTIONS[r.action] || r.action, r.target, detailText(r)].map(q2).join(',')));
  download(`로그_${from}_${to}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}
