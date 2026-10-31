// 서버 통신 계층: Supabase(RPC) 또는 데모(localStorage) 백엔드
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const DEMO = !SUPABASE_URL || !SUPABASE_KEY;
const TOKEN_KEY = 'today_token';

const ERRORS = {
  AUTH_REQUIRED: '로그인이 필요합니다.',
  BAD_LOGIN: '아이디 또는 비밀번호가 올바르지 않습니다.',
  LOCKED: '로그인 실패가 반복되어 10분간 잠겼습니다.',
  BAD_PASSWORD: '현재 비밀번호가 올바르지 않습니다.',
  PASSWORD_TOO_SHORT: '비밀번호는 6자 이상이어야 합니다.',
  FORBIDDEN: '권한이 없습니다.',
  NOT_FOUND: '대상을 찾을 수 없습니다.',
  DUPLICATE_DATE: '같은 적용일의 시간표가 이미 있습니다.',
  DUPLICATE_LOGIN: '이미 사용 중인 아이디입니다.',
  CANNOT_DEMOTE_SELF: '본인 관리자 계정은 비활성화/권한변경할 수 없습니다.',
  ONLY_OWN_CELLS: '선생님은 본인 담당 칸만 수정할 수 있습니다.',
  HAS_RECORDS: '수업·일지·성적 기록이 있는 학생은 삭제할 수 없습니다. 퇴원 상태로 보관됩니다.',
  CANNOT_DELETE_SELF: '지금 로그인한 본인 계정은 삭제할 수 없습니다.',
};

export class ApiError extends Error {
  constructor(code) {
    super(ERRORS[code] || code);
    this.code = code;
  }
}

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

// ---------------------------------------------------------------- Supabase
async function rpc(fn, args = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.');
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = (body && body.message) || `HTTP ${res.status}`;
    throw new ApiError(code);
  }
  return body;
}

const remote = {
  call: (fn, args) => rpc(fn, { p_token: getToken(), ...args }),
  async login(login, password) {
    const r = await rpc('api_login', { p_login: login, p_password: password });
    if (r?.error) throw new ApiError(r.error);
    return r;
  },
  logout: () => rpc('api_logout', { p_token: getToken() }),
};

// ---------------------------------------------------------------- 데모(로컬)
const DB_KEY = 'today_demo_db';
let db = null;

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('today:' + s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadDb() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch { db = null; }
  if (db) { db.tests ||= []; db.seq.test ||= 1; return db; }
  let seed = { teachers: [], students: [], slots: [], versions: [] };
  try {
    const r = await fetch('data/seed.json', { cache: 'no-store' });
    if (r.ok) seed = await r.json();
  } catch {}
  const pw = await sha('today1234');
  const now = new Date().toISOString();
  db = {
    seq: { teacher: 100, student: 1000, version: 100, user: 100, audit: 1, test: 1 },
    settings: {
      academy: { name: '오늘학원' },
      slots: seed.slots.length ? seed.slots : [
        { id: 'p1', label: '2:00', time: '2:00~2:50' }, { id: 'p2', label: '2:50', time: '2:50~3:40' },
        { id: 'p3', label: '3:40', time: '3:40~4:30' }, { id: 'p4', label: '4:30', time: '4:30~5:20' },
        { id: 'p5', label: '5:40', time: '5:40~6:30' }, { id: 'p6', label: '6:30', time: '6:30~7:20' },
      ],
    },
    teachers: seed.teachers.map((t, i) => ({ id: t.id, name: t.name, subject: t.subject, color: t.color, sort: i + 1, active: true })),
    students: seed.students.map((s) => ({ school: '', phone: '', memo: '', enrolled_on: null, withdrawn_on: null, ...s })),
    versions: seed.versions.map((v) => ({ ...v, updated_at: now, updated_by: 'import' })),
    users: [
      { id: 1, login_id: 'admin', name: '관리자', role: 'admin', teacher_id: null, pw, must_change: true, active: true, last_login: null },
      ...seed.teachers.map((t, i) => ({ id: i + 2, login_id: t.login, name: t.name, role: 'teacher', teacher_id: t.id, pw, must_change: true, active: true, last_login: null })),
    ],
    sessions: {},
    worklogs: {},
    tests: [],
    audit: [],
  };
  save();
  return db;
}
const save = () => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} };
const clone = (o) => JSON.parse(JSON.stringify(o));
const pubUser = (u) => ({ id: u.id, login_id: u.login_id, name: u.name, role: u.role, teacher_id: u.teacher_id, must_change: u.must_change });

function audit(login, action, target = '', detail = null) {
  db.audit.unshift({ id: db.seq.audit++, at: new Date().toISOString(), login_id: login, action, target, detail });
  if (db.audit.length > 5000) db.audit.length = 5000;
}
function auth(admin = false) {
  const s = db.sessions[getToken()];
  const u = s && db.users.find((x) => x.id === s && x.active);
  if (!u) throw new ApiError('AUTH_REQUIRED');
  if (admin && u.role !== 'admin') throw new ApiError('FORBIDDEN');
  return u;
}
// grid 에서 한 선생님 칸을 뺀 나머지를 정렬된 형태로 (선생님 권한 검사용, 서버 _strip_teacher 와 동일)
function stripTeacher(g, tid) {
  const out = {};
  for (const d of Object.keys(g || {}).sort()) for (const s of Object.keys(g[d]).sort()) for (const t of Object.keys(g[d][s]).sort()) {
    if (Number(t) === Number(tid)) continue;
    const c = g[d][s][t];
    ((out[d] ||= {})[s] ||= {})[t] = { items: c.items || [], note: c.note || '' };
  }
  return out;
}
function upsert(list, row, seqKey) {
  if (row.id == null) { row.id = db.seq[seqKey]++; list.push(row); return row; }
  const i = list.findIndex((x) => x.id === row.id);
  if (i < 0) throw new ApiError('NOT_FOUND');
  list[i] = { ...list[i], ...row };
  return list[i];
}

const local = {
  async login(login, password) {
    await loadDb();
    login = login.trim().toLowerCase();
    const u = db.users.find((x) => x.login_id === login && x.active);
    if (!u || u.pw !== (await sha(password))) { audit(login, 'login_fail'); save(); throw new ApiError('BAD_LOGIN'); }
    const token = crypto.randomUUID();
    db.sessions[token] = u.id;
    u.last_login = new Date().toISOString();
    audit(u.login_id, 'login');
    save();
    return { token, user: pubUser(u) };
  },
  async logout() {
    await loadDb();
    const s = db.sessions[getToken()];
    const u = db.users.find((x) => x.id === s);
    if (u) audit(u.login_id, 'logout');
    delete db.sessions[getToken()];
    save();
  },
  async call(fn, a) {
    await loadDb();
    const r = await this.fns[fn](a);
    save();
    return r === undefined ? null : clone(r);
  },
  fns: {
    api_bootstrap() {
      const u = auth();
      return { user: pubUser(u), settings: db.settings, teachers: [...db.teachers].sort((a, b) => a.sort - b.sort),
        students: db.students, versions: [...db.versions].sort((a, b) => a.effective_from.localeCompare(b.effective_from)) };
    },
    async api_change_password({ p_old, p_new }) {
      const u = auth();
      if (u.pw !== (await sha(p_old))) throw new ApiError('BAD_PASSWORD');
      if (p_new.length < 6) throw new ApiError('PASSWORD_TOO_SHORT');
      u.pw = await sha(p_new); u.must_change = false;
      audit(u.login_id, 'password_change', u.login_id);
    },
    api_save_version({ p }) {
      const u = auth();
      if (u.role !== 'admin') {
        if (!u.teacher_id) throw new ApiError('FORBIDDEN');
        const same = (a, b) => JSON.stringify(stripTeacher(a, u.teacher_id)) === JSON.stringify(stripTeacher(b, u.teacher_id));
        if (p.id == null) {
          const sorted = [...db.versions].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
          const base = sorted.filter((v) => v.effective_from <= p.effective_from).pop() || sorted[0];
          if (!base) throw new ApiError('FORBIDDEN');
          if (!same(p.grid, base.grid)) throw new ApiError('ONLY_OWN_CELLS');
        } else {
          const old = db.versions.find((v) => v.id === p.id);
          if (!old) throw new ApiError('NOT_FOUND');
          if (p.effective_from !== old.effective_from || (p.title || '') !== (old.title || '') || (p.memo || '') !== (old.memo || '')
            || !same(p.grid, old.grid)) throw new ApiError('ONLY_OWN_CELLS');
        }
      }
      if (db.versions.some((v) => v.effective_from === p.effective_from && v.id !== p.id)) throw new ApiError('DUPLICATE_DATE');
      const isNew = p.id == null;
      const { changes, ...row } = p;
      const r = upsert(db.versions, { ...row, updated_at: new Date().toISOString(), updated_by: u.login_id }, 'version');
      audit(u.login_id, isNew ? 'timetable_create' : 'timetable_update', r.effective_from, { title: r.title, changes });
      return r;
    },
    api_delete_version({ p_id }) {
      const u = auth(true);
      const v = db.versions.find((x) => x.id === p_id);
      db.versions = db.versions.filter((x) => x.id !== p_id);
      audit(u.login_id, 'timetable_delete', v?.effective_from);
    },
    api_save_student({ p }) {
      const u = auth();
      if (u.role !== 'admin' && (p.id != null || (p.status || 'active') !== 'active')) throw new ApiError('FORBIDDEN');
      const old = db.students.find((x) => x.id === p.id);
      const r = upsert(db.students, { ...p, name: p.name.trim() }, 'student');
      const action = !old ? 'student_create' : old.status !== r.status
        ? (r.status === 'withdrawn' ? 'student_withdraw' : 'student_reactivate') : 'student_update';
      audit(u.login_id, action, r.name, { status: r.status, withdrawn_on: r.withdrawn_on });
      return r;
    },
    api_delete_student({ p_id }) {
      const u = auth(true);
      const used = Object.values(db.worklogs).some((w) => Object.keys(w.entries || {}).some((k) => k.split('|')[1] === `s${p_id}`)
          || (w.extras || []).some((x) => x.item === p_id))
        || db.tests.some((t) => t.scores?.[p_id] != null)
        || db.versions.some((v) => JSON.stringify(v.grid).match(new RegExp(`[\\[,]${p_id}[,\\]]`)));
      if (used) throw new ApiError('HAS_RECORDS');
      const s = db.students.find((x) => x.id === p_id);
      db.students = db.students.filter((x) => x.id !== p_id);
      audit(u.login_id, 'student_delete', s?.name);
    },
    api_save_teacher({ p }) {
      const u = auth(true);
      const isNew = p.id == null;
      if (isNew && p.sort == null) p.sort = Math.max(0, ...db.teachers.map((t) => t.sort)) + 1;
      const was = db.teachers.find((t) => t.id === p.id)?.active;
      const r = upsert(db.teachers, { active: true, ...p }, 'teacher');
      if (r.active) r.retired_on = null;
      audit(u.login_id, isNew ? 'teacher_create' : was && !r.active ? 'teacher_retire' : !was && r.active ? 'teacher_rehire' : 'teacher_update',
        r.name, { active: r.active, retired_on: r.retired_on || null });
      return r;
    },
    api_list_users() {
      auth(true);
      return db.users.map((x) => ({ ...pubUser(x), active: x.active, last_login: x.last_login }));
    },
    async api_save_user({ p }) {
      const u = auth(true);
      p.login_id = p.login_id.trim().toLowerCase();
      if (db.users.some((x) => x.login_id === p.login_id && x.id !== p.id)) throw new ApiError('DUPLICATE_LOGIN');
      if (p.id === u.id && (p.role !== 'admin' || p.active === false)) throw new ApiError('CANNOT_DEMOTE_SELF');
      const isNew = p.id == null;
      const row = isNew ? { ...p, pw: await sha('today1234'), must_change: true, active: true, last_login: null } : p;
      const r = upsert(db.users, row, 'user');
      audit(u.login_id, isNew ? 'user_create' : 'user_update', r.login_id, { active: r.active, role: r.role });
      return { ...pubUser(r), active: r.active };
    },
    api_delete_user({ p_id }) {
      const u = auth(true);
      if (p_id === u.id) throw new ApiError('CANNOT_DELETE_SELF');
      const t = db.users.find((x) => x.id === p_id);
      if (!t) throw new ApiError('NOT_FOUND');
      db.users = db.users.filter((x) => x.id !== p_id);
      for (const [k, v] of Object.entries(db.sessions)) if (v === p_id) delete db.sessions[k];
      audit(u.login_id, 'user_delete', t.login_id, { name: t.name, role: t.role, teacher: db.teachers.find((x) => x.id === t.teacher_id)?.name });
    },
    async api_reset_password({ p_user_id }) {
      const u = auth(true);
      const t = db.users.find((x) => x.id === p_user_id);
      t.pw = await sha('today1234'); t.must_change = true;
      audit(u.login_id, 'password_reset', t.login_id);
    },
    api_save_settings({ p_key, p_value }) {
      const u = auth(true);
      db.settings[p_key] = p_value;
      audit(u.login_id, 'settings_update', p_key);
    },
    api_get_worklogs({ p_from, p_to, p_teacher }) {
      const u = auth();
      if (u.role !== 'admin') p_teacher = u.teacher_id ?? -1;
      return Object.values(db.worklogs).filter((w) => w.log_date >= p_from && w.log_date <= p_to
        && (p_teacher == null || w.teacher_id === p_teacher));
    },
    api_save_worklog({ p }) {
      const u = auth();
      if (u.role !== 'admin' && u.teacher_id !== p.teacher_id) throw new ApiError('FORBIDDEN');
      const r = { ...p, updated_at: new Date().toISOString(), updated_by: u.login_id };
      db.worklogs[`${p.log_date}|${p.teacher_id}`] = r;
      const t = db.teachers.find((x) => x.id === p.teacher_id);
      audit(u.login_id, 'worklog_save', `${p.log_date} ${t?.name || ''}`, { rows: Object.keys(p.entries || {}).length, done: !!p.done });
      return r;
    },
    api_get_audit({ p_from, p_to, p_limit = 1000 }) {
      auth(true);
      const to = new Date(p_to); to.setDate(to.getDate() + 1);
      return db.audit.filter((a) => a.at >= p_from && a.at < to.toISOString()).slice(0, p_limit);
    },
    api_stats() {
      auth(true);
      const logs = Object.values(db.worklogs);
      const y = new Date(); y.setFullYear(y.getFullYear() - 1);
      const ys = y.toISOString().slice(0, 10);
      return { worklogs: logs.length, worklogs_oldest: logs.map((w) => w.log_date).sort()[0] || null,
        worklogs_over_1y: logs.filter((w) => w.log_date < ys).length, audit: db.audit.length,
        versions: db.versions.length, students: db.students.length };
    },
    api_purge_worklogs({ p_before }) {
      const u = auth(true);
      let n = 0;
      for (const k of Object.keys(db.worklogs)) if (db.worklogs[k].log_date < p_before) { delete db.worklogs[k]; n++; }
      audit(u.login_id, 'worklog_purge', p_before, { deleted: n });
      return n;
    },
    api_export() {
      const u = auth(true);
      audit(u.login_id, 'export');
      return { exported_at: new Date().toISOString(), settings: db.settings, teachers: db.teachers, students: db.students,
        versions: db.versions, worklogs: Object.values(db.worklogs), tests: db.tests };
    },
    api_get_tests({ p_from, p_to }) {
      auth();
      return db.tests.filter((t) => t.test_date >= p_from && t.test_date <= p_to)
        .sort((a, b) => b.test_date.localeCompare(a.test_date) || b.id - a.id);
    },
    api_save_test({ p }) {
      const u = auth();
      db.seq.test ||= 1;
      const now = new Date().toISOString();
      const r = upsert(db.tests, p.id == null ? { ...p, created_by: u.login_id, updated_at: now, updated_by: u.login_id } : { ...p, updated_at: now, updated_by: u.login_id }, 'test');
      audit(u.login_id, 'test_save', `${r.test_date} ${r.subject} ${r.title}`, { students: Object.keys(r.scores || {}).length });
      return r;
    },
    api_delete_test({ p_id }) {
      const u = auth(true);
      const t = db.tests.find((x) => x.id === p_id);
      db.tests = db.tests.filter((x) => x.id !== p_id);
      audit(u.login_id, 'test_delete', t ? `${t.test_date} ${t.title}` : '');
    },
    api_student_history({ p_student, p_from, p_to }) {
      auth();
      const records = [];
      for (const w of Object.values(db.worklogs)) {
        if (w.log_date < p_from || w.log_date > p_to) continue;
        for (const [key, entry] of Object.entries(w.entries || {}))
          if (key.split('|')[1] === `s${p_student}`) records.push({ log_date: w.log_date, teacher_id: w.teacher_id, key, entry });
      }
      records.sort((a, b) => b.log_date.localeCompare(a.log_date) || a.key.localeCompare(b.key));
      const tests = db.tests.filter((t) => t.test_date >= p_from && t.test_date <= p_to && t.scores?.[p_student] != null)
        .sort((a, b) => a.test_date.localeCompare(b.test_date));
      return { records, tests };
    },
  },
};

// ---------------------------------------------------------------- 공통 API
const be = DEMO ? local : remote;
const c = (fn, args) => be.call(fn, args);

export const api = {
  async login(id, pw) { const r = await be.login(id, pw); setToken(r.token); return r; },
  async logout() { try { await be.logout(); } finally { setToken(null); } },
  bootstrap: () => c('api_bootstrap'),
  changePassword: (oldPw, newPw) => c('api_change_password', { p_old: oldPw, p_new: newPw }),
  saveVersion: (p) => c('api_save_version', { p }),
  deleteVersion: (id) => c('api_delete_version', { p_id: id }),
  saveStudent: (p) => c('api_save_student', { p }),
  deleteStudent: (id) => c('api_delete_student', { p_id: id }),
  saveTeacher: (p) => c('api_save_teacher', { p }),
  listUsers: () => c('api_list_users'),
  saveUser: (p) => c('api_save_user', { p }),
  resetPassword: (id) => c('api_reset_password', { p_user_id: id }),
  deleteUser: (id) => c('api_delete_user', { p_id: id }),
  saveSettings: (key, value) => c('api_save_settings', { p_key: key, p_value: value }),
  getWorklogs: (from, to, teacher = null) => c('api_get_worklogs', { p_from: from, p_to: to, p_teacher: teacher }),
  saveWorklog: (p) => c('api_save_worklog', { p }),
  getAudit: (from, to, limit = 2000) => c('api_get_audit', { p_from: from, p_to: to, p_limit: limit }),
  stats: () => c('api_stats'),
  purgeWorklogs: (before) => c('api_purge_worklogs', { p_before: before }),
  exportAll: () => c('api_export'),
  getTests: (from, to) => c('api_get_tests', { p_from: from, p_to: to }),
  saveTest: (p) => c('api_save_test', { p }),
  deleteTest: (id) => c('api_delete_test', { p_id: id }),
  studentHistory: (sid, from, to) => c('api_student_history', { p_student: sid, p_from: from, p_to: to }),
  resetDemo() { try { localStorage.removeItem(DB_KEY); } catch {} db = null; setToken(null); },
};
