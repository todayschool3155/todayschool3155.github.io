// DB 함수 자동 테스트 (실제 Postgres 엔진 PGlite 사용, 인터넷·Supabase 불필요)
//   cd tools/dbtest && npm install && node test.mjs
// supabase/seed.sql 이 있어야 합니다 (tools/import_excel.py 로 생성).
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const root = new URL('../../supabase/', import.meta.url);
const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec(`create role anon; create role authenticated; create schema extensions;`); // Supabase 환경 흉내
const schema = fs.readFileSync(new URL('schema.sql', root), 'utf8');
await db.exec(schema);
await db.exec(schema); // 재실행 안전성
await db.exec(fs.readFileSync(new URL('seed.sql', root), 'utf8'));

let failed = 0;
const call = async (fn, args) => {
  const keys = Object.keys(args);
  const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  try {
    const res = await db.query(sql, keys.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
    return res.rows[0].r;
  } catch (e) { return { EXC: e.message }; }
};
const ok = (label, cond, extra = '') => { if (!cond) failed++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };

// 로그인 실패 기록 + 잠금
for (let i = 0; i < 5; i++) await call('api_login', { p_login: 'annie', p_password: 'wrong' });
const fails = (await db.query(`select count(*)::int n from audit_log where action='login_fail'`)).rows[0].n;
ok('failed logins recorded', fails === 5, fails);
let r = await call('api_login', { p_login: 'annie', p_password: 'today1234' });
ok('lockout after 5 fails', r.error === 'LOCKED');

r = await call('api_login', { p_login: 'ADMIN ', p_password: 'today1234' });
ok('admin login', !!r.token);
const at = r.token;
const b = await call('api_bootstrap', { p_token: at });
ok('bootstrap', b.teachers.length === 5 && b.students.length === 70 && b.versions.length === 1);
const users = await call('api_list_users', { p_token: at });
ok('users', users.length === 6);

await db.exec(`delete from audit_log where action='login_fail'`);
r = await call('api_login', { p_login: 'joie', p_password: 'today1234' });
const tt = r.token;
ok('teacher login', !!tt && r.user.teacher_id === 5);
const bt = await call('api_bootstrap', { p_token: tt });
ok('teacher gets no phone', bt.students.every((s) => s.phone === ''));
ok('teacher forbidden admin fn', (await call('api_list_users', { p_token: tt })).EXC === 'FORBIDDEN');
ok('bad token', (await call('api_bootstrap', { p_token: 'nope' })).EXC === 'AUTH_REQUIRED');

// 업무일지
const wl = { log_date: '2026-10-01', teacher_id: 5, entries: { 'p1|s1': { att: '출석' } }, extras: [{ slot: 'p1', item: 2, removed: true }], notice: '', review: '', done: true };
r = await call('api_save_worklog', { p_token: tt, p: wl });
ok('teacher saves own log', r.teacher_id === 5 && r.extras.length === 1, r.EXC || '');
ok('teacher cannot save others', (await call('api_save_worklog', { p_token: tt, p: { ...wl, teacher_id: 4 } })).EXC === 'FORBIDDEN');
r = await call('api_get_worklogs', { p_token: tt, p_from: '2026-09-01', p_to: '2026-10-31', p_teacher: 4 });
ok('teacher reads only own', r.length === 1 && r[0].teacher_id === 5);

// 시간표 — 관리자
const v0 = b.versions[0];
r = await call('api_save_version', { p_token: at, p: { effective_from: '2026-10-05', title: 't', memo: '', grid: v0.grid } });
ok('admin new version', r.id > 0, r.EXC || '');
ok('duplicate date', (await call('api_save_version', { p_token: at, p: { effective_from: '2026-10-05', grid: {} } })).EXC === 'DUPLICATE_DATE');

// 시간표 — 선생님(joie=5)은 본인 칸만
const g = structuredClone(v0.grid);
g['1']['p1']['5'].items.push(999);
r = await call('api_save_version', { p_token: tt, p: { ...v0, grid: g } });
ok('teacher edits own cell', r.id === v0.id, r.EXC || '');
const g2 = structuredClone(g); g2['1']['p1']['4'].items.pop();
ok('teacher blocked on other cell', (await call('api_save_version', { p_token: tt, p: { ...v0, grid: g2 } })).EXC === 'ONLY_OWN_CELLS');
ok('teacher cannot retitle', (await call('api_save_version', { p_token: tt, p: { ...v0, title: 'x', grid: g } })).EXC === 'ONLY_OWN_CELLS');
const g3 = structuredClone(g); g3['2']['p2']['5'] = { items: [1], note: '' };
r = await call('api_save_version', { p_token: tt, p: { effective_from: '2026-09-15', title: '조이 변경', memo: '', grid: g3 } });
ok('teacher new dated version (own cells only)', r.id > 0, r.EXC || '');
const g4 = structuredClone(g3); delete g4['3'];
ok('teacher new version touching others blocked', (await call('api_save_version', { p_token: tt, p: { effective_from: '2026-09-20', grid: g4 } })).EXC === 'ONLY_OWN_CELLS');
ok('teacher cannot delete version', (await call('api_delete_version', { p_token: tt, p_id: v0.id })).EXC === 'FORBIDDEN');

// 학생 — 선생님은 신규 등록만
r = await call('api_save_student', { p_token: tt, p: { name: '신입생', status: 'active' } });
ok('teacher creates student', r.name === '신입생', r.EXC || '');
ok('teacher cannot withdraw', (await call('api_save_student', { p_token: tt, p: { ...r, status: 'withdrawn' } })).EXC === 'FORBIDDEN');
r = await call('api_save_student', { p_token: at, p: { ...r, status: 'withdrawn', withdrawn_on: '2026-10-10' } });
ok('admin withdraws', r.status === 'withdrawn');

// 계정·비밀번호
ok('dup login', (await call('api_save_user', { p_token: at, p: { login_id: 'annie', role: 'teacher' } })).EXC === 'DUPLICATE_LOGIN');
const adminRow = users.find((u) => u.login_id === 'admin');
ok('cannot demote self', (await call('api_save_user', { p_token: at, p: { ...adminRow, role: 'teacher' } })).EXC === 'CANNOT_DEMOTE_SELF');
ok('change pw wrong old', (await call('api_change_password', { p_token: tt, p_old: 'bad', p_new: 'abcdef' })).EXC === 'BAD_PASSWORD');
r = await call('api_change_password', { p_token: tt, p_old: 'today1234', p_new: 'joie5678' });
ok('change pw', !r?.EXC);
await call('api_reset_password', { p_token: at, p_user_id: users.find((u) => u.login_id === 'joie').id });
r = await call('api_login', { p_login: 'joie', p_password: 'today1234' });
ok('reset pw', !!r.token && r.user.must_change === true);

// 테스트 성적 · 학생 기록 (위에서 비번 초기화로 세션이 끊겼으므로 다시 로그인)
const tt2 = (await call('api_login', { p_login: 'joie', p_password: 'today1234' })).token;
r = await call('api_save_test', { p_token: tt2, p: { test_date: '2026-10-30', subject: '영어', title: '10월 금요 테스트', items: ['듣기', '문법'], scores: { 1: { 듣기: '8', 문법: '92' }, 3: { note: '병결' } } } });
ok('teacher saves test', r.id > 0 && r.created_by === 'joie', r.EXC || '');
const testId = r.id;
r = await call('api_save_test', { p_token: at, p: { ...r, title: '10월 4주 금요 테스트' } });
ok('admin edits test', r.title === '10월 4주 금요 테스트' && r.updated_by === 'admin');
r = await call('api_get_tests', { p_token: tt2, p_from: '2026-10-01', p_to: '2026-10-31' });
ok('get tests', r.length === 1);
ok('teacher cannot delete test', (await call('api_delete_test', { p_token: tt2, p_id: testId })).EXC === 'FORBIDDEN');
r = await call('api_student_history', { p_token: tt2, p_student: 1, p_from: '2026-09-01', p_to: '2026-10-31' });
ok('student history (records from log + test)', r.records.length === 1 && r.records[0].entry.att === '출석' && r.tests.length === 1, JSON.stringify(r).slice(0, 120));
r = await call('api_student_history', { p_token: tt2, p_student: 2, p_from: '2026-09-01', p_to: '2026-10-31' });
ok('history excludes other students', r.records.length === 0 && r.tests.length === 0);
ok('no token → history blocked', (await call('api_student_history', { p_token: 'x', p_student: 1, p_from: '2026-09-01', p_to: '2026-10-31' })).EXC === 'AUTH_REQUIRED');

// 퇴사 · 퇴원 · 계정 삭제 — 기록 보존
{
  const t5 = b.teachers.find((t) => t.id === 5);
  r = await call('api_save_teacher', { p_token: at, p: { ...t5, active: false, retired_on: '2026-11-01' } });
  ok('teacher retire', r.active === false && r.retired_on === '2026-11-01', r.EXC || '');
  ok('retire audited', (await db.query(`select action from audit_log order by id desc limit 1`)).rows[0].action === 'teacher_retire');
  const joie = (await call('api_list_users', { p_token: at })).find((x) => x.login_id === 'joie');
  r = await call('api_delete_user', { p_token: at, p_id: joie.id });
  ok('delete account', !r?.EXC, r?.EXC || '');
  const logsLeft = (await db.query(`select count(*)::int n from worklogs where teacher_id = 5`)).rows[0].n;
  ok('worklogs kept after account delete', logsLeft >= 1, logsLeft);
  ok('tests kept after account delete', (await db.query(`select count(*)::int n from tests where created_by = 'joie'`)).rows[0].n === 1);
  ok('deleted user cannot login', (await call('api_login', { p_login: 'joie', p_password: 'today1234' })).error === 'BAD_LOGIN');
  let blocked = false;
  try { await db.exec('delete from teachers where id = 5'); } catch { blocked = true; }
  ok('teacher with logs cannot be hard-deleted (FK restrict)', blocked);
  ok('cannot delete own account', (await call('api_delete_user', { p_token: at, p_id: adminRow.id })).EXC === 'CANNOT_DELETE_SELF');
  r = await call('api_save_teacher', { p_token: at, p: { ...t5, active: true } });
  ok('teacher rehire clears retired_on', r.active === true && r.retired_on === null);
  ok('student with records cannot be deleted', (await call('api_delete_student', { p_token: at, p_id: 1 })).EXC === 'HAS_RECORDS');
  ok('student only in timetable cannot be deleted', (await call('api_delete_student', { p_token: at, p_id: 40 })).EXC === 'HAS_RECORDS');
  const fresh = await call('api_save_student', { p_token: at, p: { name: '오등록', status: 'active' } });
  ok('student without records can be deleted', !(await call('api_delete_student', { p_token: at, p_id: fresh.id }))?.EXC);
}

// 기타
ok('audit', (await call('api_get_audit', { p_token: at, p_from: '2026-01-01', p_to: '2030-12-31', p_limit: 100 })).length > 10);
ok('export', (await call('api_export', { p_token: at })).students.length === 71);
ok('ping', (await call('api_ping', {})) === 'ok');

// 권한: anon 은 api_* 만
const pr = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') ex from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`);
ok('anon only api_*', pr.rows.every((x) => x.ex === x.proname.startsWith('api_')));
ok('anon no table access', (await db.query(`select has_table_privilege('anon','students','select') s`)).rows[0].s === false);

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
