-- =====================================================================
--  공지사항 (2026-11-09 추가) — 새 테이블·함수만 만들고 기존 데이터는 건드리지 않음
--  이미 운영 중인 DB: 이 파일만 SQL Editor 에서 실행 (다시 실행해도 안전)
-- =====================================================================
create table if not exists notices (
  id serial primary key,
  title text not null,
  body text not null default '',
  important boolean not null default false,
  targets jsonb not null default '[]'::jsonb,    -- 대상 선생님 id 목록, [] = 전체
  start_date date not null,
  end_date date not null,
  weekdays jsonb not null default '[]'::jsonb,   -- [1..5] (1=월), [] = 모든 요일
  slots jsonb not null default '[]'::jsonb,      -- 교시 id 목록, [] = 하루 종일
  reads jsonb not null default '{}'::jsonb,      -- { 로그인아이디: 확인 시각 }
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
create index if not exists notices_dates_idx on notices (end_date desc, start_date desc);
alter table notices enable row level security;

-- 목록: 관리자 = 전체, 선생님 = 전체 대상 + 본인이 대상인 공지
create or replace function api_get_notices(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _auth(p_token);
  return (select coalesce(jsonb_agg(to_jsonb(n) order by n.start_date desc, n.id desc), '[]'::jsonb) from notices n
    where u.role = 'admin' or n.targets = '[]'::jsonb or n.targets @> to_jsonb(u.teacher_id));
end $$;

create or replace function api_save_notice(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r notices;
begin
  u := _admin(p_token);
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'TITLE_REQUIRED'; end if;
  if (p->>'end_date')::date < (p->>'start_date')::date then raise exception 'BAD_DATES'; end if;
  if (p->>'id') is null then
    insert into notices (title, body, important, targets, start_date, end_date, weekdays, slots, created_by, updated_by)
    values (trim(p->>'title'), coalesce(p->>'body', ''), coalesce((p->>'important')::boolean, false),
            coalesce(p->'targets', '[]'::jsonb), (p->>'start_date')::date, (p->>'end_date')::date,
            coalesce(p->'weekdays', '[]'::jsonb), coalesce(p->'slots', '[]'::jsonb), u.login_id, u.login_id)
    returning * into r;
    perform _audit(u.login_id, 'notice_create', r.title, jsonb_build_object('targets', r.targets, 'from', r.start_date, 'to', r.end_date));
  else
    update notices set title = trim(p->>'title'), body = coalesce(p->>'body', ''), important = coalesce((p->>'important')::boolean, false),
      targets = coalesce(p->'targets', '[]'::jsonb), start_date = (p->>'start_date')::date, end_date = (p->>'end_date')::date,
      weekdays = coalesce(p->'weekdays', '[]'::jsonb), slots = coalesce(p->'slots', '[]'::jsonb),
      updated_at = now(), updated_by = u.login_id
    where id = (p->>'id')::int returning * into r;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform _audit(u.login_id, 'notice_update', r.title);
  end if;
  return to_jsonb(r);
end $$;

create or replace function api_delete_notice(p_token text, p_id int)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; t text;
begin
  u := _admin(p_token);
  delete from notices where id = p_id returning title into t;
  perform _audit(u.login_id, 'notice_delete', t);
end $$;

-- 확인(읽음) 표시: 그 공지의 대상인 사람만
create or replace function api_ack_notice(p_token text, p_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r notices;
begin
  u := _auth(p_token);
  update notices set reads = reads || jsonb_build_object(u.login_id, now())
   where id = p_id and (u.role = 'admin' or targets = '[]'::jsonb or targets @> to_jsonb(u.teacher_id))
  returning * into r;
  if not found then raise exception 'NOT_FOUND'; end if;
  return to_jsonb(r);
end $$;

-- 전체 백업에 공지 포함
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
    'tests', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tests t),
    'notices', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from notices n));
end $$;

revoke all on notices from anon, authenticated;
revoke execute on function api_get_notices(text), api_save_notice(text, jsonb), api_delete_notice(text, int), api_ack_notice(text, int) from public;
grant execute on function api_get_notices(text), api_save_notice(text, jsonb), api_delete_notice(text, int), api_ack_notice(text, int), api_export(text) to anon, authenticated;
