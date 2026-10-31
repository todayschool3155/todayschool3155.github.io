-- =====================================================================
--  오늘학원 시간표 · 업무일지  —  Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 전체 붙여넣고 [Run] 1회 실행
--  (다시 실행해도 안전: 테이블은 if not exists, 함수는 create or replace)
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- 테이블 ----------
create table if not exists teachers (
  id serial primary key,
  name text not null,
  subject text not null default '',
  color text not null default '#e5e7eb',
  sort int not null default 0,
  active boolean not null default true,       -- false = 퇴사 (기록은 영구 보관)
  retired_on date,
  created_at timestamptz not null default now()
);
alter table teachers add column if not exists retired_on date;

create table if not exists students (
  id serial primary key,
  name text not null,
  grade text not null default '',
  school text not null default '',
  phone text not null default '',
  memo text not null default '',
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  enrolled_on date,
  withdrawn_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_users (
  id serial primary key,
  login_id text not null unique,
  name text not null default '',
  role text not null default 'teacher' check (role in ('admin', 'teacher')),
  teacher_id int references teachers(id) on delete set null,
  pw_hash text not null,
  must_change boolean not null default true,
  active boolean not null default true,
  last_login timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id int not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

-- 시간표 버전: effective_from(적용 시작일)부터 다음 버전 전까지 적용
-- grid = { "요일(1=월..5=금)": { "교시id": { "선생님id": { "items": [학생id(숫자) | "메모"(문자)], "note": "" } } } }
create table if not exists timetable_versions (
  id serial primary key,
  effective_from date not null unique,
  title text not null default '',
  memo text not null default '',
  grid jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- 업무일지: 날짜 × 선생님 1건
-- entries = { "교시id|항목키": { "att": "출석", "progress": "", "homework": "", "note": "" } }
create table if not exists worklogs (
  log_date date not null,
  teacher_id int not null references teachers(id) on delete restrict,  -- 선생님 기록이 있으면 삭제 불가 (일지 보호)
  entries jsonb not null default '{}'::jsonb,
  extras jsonb not null default '[]'::jsonb,
  notice text not null default '',
  review text not null default '',
  done boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  primary key (log_date, teacher_id)
);

-- (이미 설치된 DB 업그레이드) 선생님 삭제 시 일지가 함께 지워지지 않도록
alter table worklogs drop constraint if exists worklogs_teacher_id_fkey;
alter table worklogs add constraint worklogs_teacher_id_fkey foreign key (teacher_id) references teachers(id) on delete restrict;

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  login_id text not null default '',
  action text not null,
  target text not null default '',
  detail jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);

-- 모든 테이블은 직접 접근 차단 (RLS on + 정책 없음) → 아래 api_* 함수로만 접근
alter table teachers enable row level security;
alter table students enable row level security;
alter table app_users enable row level security;
alter table sessions enable row level security;
alter table settings enable row level security;
alter table timetable_versions enable row level security;
alter table worklogs enable row level security;
alter table audit_log enable row level security;

-- ---------- 기본 데이터 ----------
insert into app_users (login_id, name, role, pw_hash)
values ('admin', '관리자', 'admin', extensions.crypt('today1234', extensions.gen_salt('bf')))
on conflict (login_id) do nothing;

insert into settings (key, value) values
  ('academy', '{"name": "오늘학원"}'::jsonb),
  ('slots', '[{"id":"p1","label":"2:00","time":"2:00~2:50"},{"id":"p2","label":"2:50","time":"2:50~3:40"},{"id":"p3","label":"3:40","time":"3:40~4:30"},{"id":"p4","label":"4:30/4:50","time":"4:30~5:20 / 4:50~5:40"},{"id":"p5","label":"5:40","time":"5:40~6:30"},{"id":"p6","label":"6:30","time":"6:30~7:20"},{"id":"p7","label":"7:20","time":"7:20~8:10"}]'::jsonb)
on conflict (key) do nothing;

-- ---------- 내부 함수 ----------
create or replace function _audit(p_login text, p_action text, p_target text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (login_id, action, target, detail) values (coalesce(p_login, ''), p_action, coalesce(p_target, ''), p_detail);
$$;

create or replace function _auth(p_token text)
returns app_users language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  select a.* into u from sessions s join app_users a on a.id = s.user_id
   where s.token = p_token and s.expires_at > now() and a.active;
  if not found then raise exception 'AUTH_REQUIRED'; end if;
  update sessions set expires_at = now() + interval '14 days' where token = p_token
    and expires_at < now() + interval '13 days';
  return u;
end $$;

create or replace function _admin(p_token text)
returns app_users language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _auth(p_token);
  if u.role <> 'admin' then raise exception 'FORBIDDEN'; end if;
  return u;
end $$;

create or replace function _user_json(u app_users)
returns jsonb language sql stable as $$
  select jsonb_build_object('id', u.id, 'login_id', u.login_id, 'name', u.name, 'role', u.role,
    'teacher_id', u.teacher_id, 'must_change', u.must_change);
$$;

-- ---------- 공개 API ----------
create or replace function api_ping() returns text language sql as $$ select 'ok'::text $$;

create or replace function api_login(p_login text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; t text; fails int;
begin
  p_login := lower(trim(p_login));
  select count(*) into fails from audit_log
   where action = 'login_fail' and login_id = p_login and at > now() - interval '10 minutes';
  if fails >= 5 then return jsonb_build_object('error', 'LOCKED'); end if;

  select * into u from app_users where login_id = p_login and active;
  if not found or u.pw_hash <> crypt(p_password, u.pw_hash) then
    -- 예외를 던지면 실패 기록까지 롤백되므로 오류는 값으로 반환
    perform _audit(p_login, 'login_fail', '');
    return jsonb_build_object('error', 'BAD_LOGIN');
  end if;

  t := encode(gen_random_bytes(32), 'hex');
  insert into sessions (token, user_id, expires_at) values (t, u.id, now() + interval '14 days');
  update app_users set last_login = now() where id = u.id;
  perform _audit(u.login_id, 'login', '');
  -- 정리: 만료 세션, 1년 넘은 로그
  delete from sessions where expires_at < now();
  delete from audit_log where at < now() - interval '400 days';
  return jsonb_build_object('token', t, 'user', _user_json(u));
end $$;

create or replace function api_logout(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  select a.* into u from sessions s join app_users a on a.id = s.user_id where s.token = p_token;
  delete from sessions where token = p_token;
  if found then perform _audit(u.login_id, 'logout', ''); end if;
end $$;

create or replace function api_change_password(p_token text, p_old text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users;
begin
  u := _auth(p_token);
  if u.pw_hash <> crypt(p_old, u.pw_hash) then raise exception 'BAD_PASSWORD'; end if;
  if length(p_new) < 6 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  update app_users set pw_hash = crypt(p_new, gen_salt('bf')), must_change = false where id = u.id;
  delete from sessions where user_id = u.id and token <> p_token;
  perform _audit(u.login_id, 'password_change', u.login_id);
end $$;

create or replace function api_bootstrap(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _auth(p_token);
  return jsonb_build_object(
    'user', _user_json(u),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from settings),
    'teachers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort, t.id), '[]'::jsonb) from teachers t),
    -- 선생님 계정에는 연락처·메모를 보내지 않음
    'students', (select coalesce(jsonb_agg(case when u.role = 'admin' then to_jsonb(s)
                   else jsonb_build_object('id', s.id, 'name', s.name, 'grade', s.grade, 'school', s.school, 'status', s.status,
                                           'phone', '', 'memo', '', 'enrolled_on', s.enrolled_on, 'withdrawn_on', s.withdrawn_on) end
                   order by s.name), '[]'::jsonb) from students s),
    'versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.effective_from), '[]'::jsonb) from timetable_versions v)
  );
end $$;

-- 시간표 grid 에서 특정 선생님 칸을 뺀 나머지 (선생님 권한 검사용)
create or replace function _strip_teacher(g jsonb, tid text)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(dk, dv), '{}'::jsonb) from (
    select d.key as dk,
      (select coalesce(jsonb_object_agg(s.key, s.value - tid), '{}'::jsonb)
         from jsonb_each(d.value) s where (s.value - tid) <> '{}'::jsonb) as dv
    from jsonb_each(coalesce(g, '{}'::jsonb)) d) x
  where dv <> '{}'::jsonb;
$$;

-- 시간표 버전 저장 (id 없으면 신규)
-- 관리자: 전체 / 선생님: 기존 버전에서 "본인 칸"만 변경 가능
create or replace function api_save_version(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r timetable_versions; old timetable_versions;
begin
  u := _auth(p_token);
  if u.role <> 'admin' then
    if u.teacher_id is null then raise exception 'FORBIDDEN'; end if;
    if (p->>'id') is null then
      -- 새 적용일 버전: 그 날짜에 적용 중인 버전과 비교해 본인 칸만 달라야 함
      select * into old from timetable_versions where effective_from <= (p->>'effective_from')::date
       order by effective_from desc limit 1;
      if not found then select * into old from timetable_versions order by effective_from limit 1; end if;
      if not found then raise exception 'FORBIDDEN'; end if;
      if _strip_teacher(p->'grid', u.teacher_id::text) <> _strip_teacher(old.grid, u.teacher_id::text) then
        raise exception 'ONLY_OWN_CELLS';
      end if;
    else
      select * into old from timetable_versions where id = (p->>'id')::int;
      if not found then raise exception 'NOT_FOUND'; end if;
      if (p->>'effective_from')::date <> old.effective_from
         or coalesce(p->>'title', '') <> old.title or coalesce(p->>'memo', '') <> old.memo
         or _strip_teacher(p->'grid', u.teacher_id::text) <> _strip_teacher(old.grid, u.teacher_id::text) then
        raise exception 'ONLY_OWN_CELLS';
      end if;
    end if;
  end if;
  if (p->>'id') is null then
    insert into timetable_versions (effective_from, title, memo, grid, updated_by)
    values ((p->>'effective_from')::date, coalesce(p->>'title', ''), coalesce(p->>'memo', ''),
            coalesce(p->'grid', '{}'::jsonb), u.login_id)
    returning * into r;
    perform _audit(u.login_id, 'timetable_create', r.effective_from::text, jsonb_build_object('title', r.title));
  else
    update timetable_versions set effective_from = (p->>'effective_from')::date,
      title = coalesce(p->>'title', ''), memo = coalesce(p->>'memo', ''),
      grid = coalesce(p->'grid', '{}'::jsonb), updated_at = now(), updated_by = u.login_id
    where id = (p->>'id')::int returning * into r;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform _audit(u.login_id, 'timetable_update', r.effective_from::text,
      jsonb_build_object('title', r.title, 'changes', p->'changes'));
  end if;
  return to_jsonb(r);
exception when unique_violation then raise exception 'DUPLICATE_DATE';
end $$;

create or replace function api_delete_version(p_token text, p_id int)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; d date;
begin
  u := _admin(p_token);
  delete from timetable_versions where id = p_id returning effective_from into d;
  perform _audit(u.login_id, 'timetable_delete', d::text);
end $$;

create or replace function api_save_student(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r students; old students;
begin
  -- 선생님은 신규 등록만 가능 (수정·탈퇴는 관리자)
  u := _auth(p_token);
  if u.role <> 'admin' and ((p->>'id') is not null or coalesce(p->>'status', 'active') <> 'active') then
    raise exception 'FORBIDDEN';
  end if;
  if (p->>'id') is null then
    insert into students (name, grade, school, phone, memo, status, enrolled_on, withdrawn_on)
    values (trim(p->>'name'), coalesce(p->>'grade', ''), coalesce(p->>'school', ''), coalesce(p->>'phone', ''),
            coalesce(p->>'memo', ''), coalesce(p->>'status', 'active'),
            nullif(p->>'enrolled_on', '')::date, nullif(p->>'withdrawn_on', '')::date)
    returning * into r;
    perform _audit(u.login_id, 'student_create', r.name, jsonb_build_object('grade', r.grade));
  else
    select * into old from students where id = (p->>'id')::int;
    update students set name = trim(p->>'name'), grade = coalesce(p->>'grade', ''),
      school = coalesce(p->>'school', ''), phone = coalesce(p->>'phone', ''), memo = coalesce(p->>'memo', ''),
      status = coalesce(p->>'status', 'active'), enrolled_on = nullif(p->>'enrolled_on', '')::date,
      withdrawn_on = nullif(p->>'withdrawn_on', '')::date, updated_at = now()
    where id = (p->>'id')::int returning * into r;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform _audit(u.login_id,
      case when old.status <> r.status then 'student_' || case when r.status = 'withdrawn' then 'withdraw' else 'reactivate' end
           else 'student_update' end,
      r.name, jsonb_build_object('status', r.status, 'withdrawn_on', r.withdrawn_on));
  end if;
  return to_jsonb(r);
end $$;

-- 완전 삭제는 "기록이 하나도 없는" 학생만 (잘못 등록한 경우). 기록이 있으면 퇴원 상태로 보관해야 함
create or replace function api_delete_student(p_token text, p_id int)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; n text;
begin
  u := _admin(p_token);
  if exists (select 1 from worklogs w where exists (select 1 from jsonb_object_keys(w.entries) k where split_part(k, '|', 2) = 's' || p_id)
               or jsonb_path_exists(w.extras, '$[*] ? (@.item == $id)', jsonb_build_object('id', p_id)))
     or exists (select 1 from tests t where t.scores ? p_id::text)
     or exists (select 1 from timetable_versions v where jsonb_path_exists(v.grid, '$.*.*.*.items[*] ? (@ == $id)', jsonb_build_object('id', p_id)))
  then raise exception 'HAS_RECORDS'; end if;
  delete from students where id = p_id returning name into n;
  perform _audit(u.login_id, 'student_delete', n);
end $$;

-- 선생님은 삭제하지 않고 퇴사(active=false, retired_on) 처리 → 과거 일지·시간표 영구 보관
create or replace function api_save_teacher(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r teachers; was_active boolean;
begin
  u := _admin(p_token);
  if (p->>'id') is null then
    insert into teachers (name, subject, color, sort, active)
    values (trim(p->>'name'), coalesce(p->>'subject', ''), coalesce(p->>'color', '#e5e7eb'),
            coalesce((p->>'sort')::int, (select coalesce(max(sort), 0) + 1 from teachers)), coalesce((p->>'active')::boolean, true))
    returning * into r;
    perform _audit(u.login_id, 'teacher_create', r.name);
  else
    select active into was_active from teachers where id = (p->>'id')::int;
    update teachers set name = trim(p->>'name'), subject = coalesce(p->>'subject', ''),
      color = coalesce(p->>'color', color), sort = coalesce((p->>'sort')::int, sort),
      active = coalesce((p->>'active')::boolean, active),
      retired_on = case when coalesce((p->>'active')::boolean, active) then null else nullif(p->>'retired_on', '')::date end
    where id = (p->>'id')::int returning * into r;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform _audit(u.login_id,
      case when was_active and not r.active then 'teacher_retire' when not was_active and r.active then 'teacher_rehire' else 'teacher_update' end,
      r.name, jsonb_build_object('active', r.active, 'retired_on', r.retired_on));
  end if;
  return to_jsonb(r);
end $$;

create or replace function api_list_users(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'login_id', login_id, 'name', name, 'role', role,
    'teacher_id', teacher_id, 'must_change', must_change, 'active', active, 'last_login', last_login) order by role, login_id), '[]'::jsonb)
    from app_users);
end $$;

-- 로그인 계정 삭제: 계정만 지움. 일지·시간표·로그는 선생님/아이디 기준으로 그대로 남음
create or replace function api_delete_user(p_token text, p_id int)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; t app_users;
begin
  u := _admin(p_token);
  if p_id = u.id then raise exception 'CANNOT_DELETE_SELF'; end if;
  select * into t from app_users where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  delete from app_users where id = p_id;  -- 세션은 cascade 로 함께 삭제
  perform _audit(u.login_id, 'user_delete', t.login_id,
    jsonb_build_object('name', t.name, 'role', t.role, 'teacher', (select name from teachers where id = t.teacher_id)));
end $$;

-- 계정 저장 (신규 계정 비밀번호 = today1234)
create or replace function api_save_user(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; r app_users;
begin
  u := _admin(p_token);
  if (p->>'id') is null then
    insert into app_users (login_id, name, role, teacher_id, pw_hash)
    values (lower(trim(p->>'login_id')), coalesce(p->>'name', ''), coalesce(p->>'role', 'teacher'),
            nullif(p->>'teacher_id', '')::int, crypt('today1234', gen_salt('bf')))
    returning * into r;
    perform _audit(u.login_id, 'user_create', r.login_id);
  else
    update app_users set login_id = lower(trim(p->>'login_id')), name = coalesce(p->>'name', ''),
      role = coalesce(p->>'role', role), teacher_id = nullif(p->>'teacher_id', '')::int,
      active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::int returning * into r;
    if not found then raise exception 'NOT_FOUND'; end if;
    if r.id = u.id and (r.role <> 'admin' or not r.active) then raise exception 'CANNOT_DEMOTE_SELF'; end if;
    if not r.active then delete from sessions where user_id = r.id; end if;
    perform _audit(u.login_id, 'user_update', r.login_id, jsonb_build_object('active', r.active, 'role', r.role));
  end if;
  return _user_json(r) || jsonb_build_object('active', r.active);
exception when unique_violation then raise exception 'DUPLICATE_LOGIN';
end $$;

create or replace function api_reset_password(p_token text, p_user_id int)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; lid text;
begin
  u := _admin(p_token);
  update app_users set pw_hash = crypt('today1234', gen_salt('bf')), must_change = true
   where id = p_user_id returning login_id into lid;
  delete from sessions where user_id = p_user_id;
  perform _audit(u.login_id, 'password_reset', lid);
end $$;

create or replace function api_save_settings(p_token text, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _admin(p_token);
  insert into settings (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value;
  perform _audit(u.login_id, 'settings_update', p_key);
end $$;

-- 업무일지 조회: 선생님은 본인 것만
create or replace function api_get_worklogs(p_token text, p_from date, p_to date, p_teacher int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _auth(p_token);
  if u.role <> 'admin' then p_teacher := coalesce(u.teacher_id, -1); end if;
  return (select coalesce(jsonb_agg(to_jsonb(w) order by w.log_date, w.teacher_id), '[]'::jsonb) from worklogs w
    where w.log_date between p_from and p_to and (p_teacher is null or w.teacher_id = p_teacher));
end $$;

create or replace function api_save_worklog(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r worklogs; tid int := (p->>'teacher_id')::int; d date := (p->>'log_date')::date;
begin
  u := _auth(p_token);
  if u.role <> 'admin' and (u.teacher_id is null or u.teacher_id <> tid) then raise exception 'FORBIDDEN'; end if;
  insert into worklogs (log_date, teacher_id, entries, extras, notice, review, done, updated_at, updated_by)
  values (d, tid, coalesce(p->'entries', '{}'::jsonb), coalesce(p->'extras', '[]'::jsonb),
          coalesce(p->>'notice', ''), coalesce(p->>'review', ''), coalesce((p->>'done')::boolean, false), now(), u.login_id)
  on conflict (log_date, teacher_id) do update set entries = excluded.entries, extras = excluded.extras,
    notice = excluded.notice, review = excluded.review, done = excluded.done, updated_at = now(), updated_by = u.login_id
  returning * into r;
  perform _audit(u.login_id, 'worklog_save', d::text || ' ' || (select name from teachers where id = tid),
    jsonb_build_object('rows', (select count(*) from jsonb_object_keys(r.entries)), 'done', r.done));
  return to_jsonb(r);
end $$;

create or replace function api_get_audit(p_token text, p_from date, p_to date, p_limit int default 1000)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return (select coalesce(jsonb_agg(to_jsonb(a) order by a.at desc), '[]'::jsonb) from (
    select * from audit_log
     where at >= (p_from::timestamp at time zone 'Asia/Seoul') and at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
     order by at desc limit p_limit) a);
end $$;

create or replace function api_stats(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return jsonb_build_object(
    'worklogs', (select count(*) from worklogs),
    'worklogs_oldest', (select min(log_date) from worklogs),
    'worklogs_over_1y', (select count(*) from worklogs where log_date < current_date - interval '1 year'),
    'audit', (select count(*) from audit_log),
    'versions', (select count(*) from timetable_versions),
    'students', (select count(*) from students));
end $$;

create or replace function api_purge_worklogs(p_token text, p_before date)
returns int language plpgsql security definer set search_path = public as $$
declare u app_users; n int;
begin
  u := _admin(p_token);
  delete from worklogs where log_date < p_before;
  get diagnostics n = row_count;
  perform _audit(u.login_id, 'worklog_purge', p_before::text, jsonb_build_object('deleted', n));
  return n;
end $$;

create or replace function api_export(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _admin(p_token);
  perform _audit(u.login_id, 'export', '');
  return jsonb_build_object(
    'exported_at', now(),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from settings),
    'teachers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from teachers t),
    'students', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from students s),
    'versions', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from timetable_versions v),
    'worklogs', (select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from worklogs w),
    'tests', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tests t));
end $$;

-- =====================================================================
--  테스트 성적 (금요 테스트 등)
--  items  = ["듣기", "문법"]           (평가 항목)
--  scores = { "학생id": { "듣기": "8", "문법": "92", "note": "병결" } }
-- =====================================================================
create table if not exists tests (
  id serial primary key,
  test_date date not null,
  subject text not null default '',
  title text not null default '',
  items jsonb not null default '[]'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  memo text not null default '',
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
create index if not exists tests_date_idx on tests (test_date desc);
alter table tests enable row level security;

create or replace function api_get_tests(p_token text, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _auth(p_token);
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.test_date desc, t.id desc), '[]'::jsonb)
    from tests t where t.test_date between p_from and p_to);
end $$;

-- 관리자·선생님 모두 입력/수정 가능
create or replace function api_save_test(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r tests;
begin
  u := _auth(p_token);
  if (p->>'id') is null then
    insert into tests (test_date, subject, title, items, scores, memo, created_by, updated_by)
    values ((p->>'test_date')::date, coalesce(p->>'subject', ''), coalesce(p->>'title', ''),
            coalesce(p->'items', '[]'::jsonb), coalesce(p->'scores', '{}'::jsonb), coalesce(p->>'memo', ''), u.login_id, u.login_id)
    returning * into r;
  else
    update tests set test_date = (p->>'test_date')::date, subject = coalesce(p->>'subject', ''), title = coalesce(p->>'title', ''),
      items = coalesce(p->'items', '[]'::jsonb), scores = coalesce(p->'scores', '{}'::jsonb), memo = coalesce(p->>'memo', ''),
      updated_at = now(), updated_by = u.login_id
    where id = (p->>'id')::int returning * into r;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  perform _audit(u.login_id, 'test_save', r.test_date::text || ' ' || r.subject || ' ' || r.title,
    jsonb_build_object('students', (select count(*) from jsonb_object_keys(r.scores))));
  return to_jsonb(r);
end $$;

create or replace function api_delete_test(p_token text, p_id int)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; t text;
begin
  u := _admin(p_token);
  delete from tests where id = p_id returning test_date::text || ' ' || title into t;
  perform _audit(u.login_id, 'test_delete', t);
end $$;

-- 학생 한 명의 수업 기록(모든 선생님) + 테스트 — 학생 카드용, 선생님도 조회 가능(진도 인수인계)
create or replace function api_student_history(p_token text, p_student int, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _auth(p_token);
  return jsonb_build_object(
    'records', (select coalesce(jsonb_agg(jsonb_build_object('log_date', w.log_date, 'teacher_id', w.teacher_id,
                  'key', e.key, 'entry', e.value) order by w.log_date desc, e.key), '[]'::jsonb)
                from worklogs w, jsonb_each(w.entries) e
                where w.log_date between p_from and p_to and split_part(e.key, '|', 2) = 's' || p_student),
    'tests', (select coalesce(jsonb_agg(to_jsonb(t) order by t.test_date), '[]'::jsonb)
              from tests t where t.test_date between p_from and p_to and t.scores ? p_student::text));
end $$;

-- ---------- 권한: 브라우저(anon)는 api_* 만 호출 가능 ----------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'api\_%'
  loop
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
