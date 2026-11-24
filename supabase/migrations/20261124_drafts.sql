-- =====================================================================
--  예비 시간표 (2026-11-24 추가) — 관리자만 보고 고치는 초안. 새 테이블·함수만 추가, 기존 데이터는 건드리지 않음
--  확정하면 앱이 기존 api_save_version 으로 "적용 시작일" 버전을 만들거나 바꿈
--  이미 운영 중인 DB: 이 파일만 SQL Editor 에서 실행 (다시 실행해도 안전)
-- =====================================================================
create table if not exists timetable_drafts (
  id serial primary key,
  title text not null default '',
  memo text not null default '',
  grid jsonb not null default '{}'::jsonb,
  base_version_id int,                 -- 만들 때 기준이 된 시간표 버전
  confirmed_from date,                 -- 확정한 적용 시작일 (아직이면 null)
  confirmed_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
alter table timetable_drafts enable row level security;

create or replace function api_get_drafts(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _admin(p_token);
  return (select coalesce(jsonb_agg(to_jsonb(d) order by d.updated_at desc), '[]'::jsonb) from timetable_drafts d);
end $$;

create or replace function api_save_draft(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r timetable_drafts; old_from date; is_confirm boolean;
begin
  u := _admin(p_token);
  if (p->>'id') is null then
    insert into timetable_drafts (title, memo, grid, base_version_id, created_by, updated_by)
    values (coalesce(p->>'title', ''), coalesce(p->>'memo', ''), coalesce(p->'grid', '{}'::jsonb),
            nullif(p->>'base_version_id', '')::int, u.login_id, u.login_id)
    returning * into r;
    perform _audit(u.login_id, 'draft_create', r.title);
  else
    select confirmed_from into old_from from timetable_drafts where id = (p->>'id')::int;
    if not found then raise exception 'NOT_FOUND'; end if;
    is_confirm := coalesce((p->>'confirm')::boolean, false);
    update timetable_drafts set title = coalesce(p->>'title', ''), memo = coalesce(p->>'memo', ''),
      grid = coalesce(p->'grid', '{}'::jsonb),
      confirmed_from = case when is_confirm then (p->>'confirmed_from')::date else confirmed_from end,
      confirmed_at = case when is_confirm then now() else confirmed_at end,
      updated_at = now(), updated_by = u.login_id
    where id = (p->>'id')::int returning * into r;
    perform _audit(u.login_id, case when is_confirm then 'draft_confirm' else 'draft_update' end,
      r.title, jsonb_build_object('changes', p->'changes', 'confirmed_from', r.confirmed_from));
  end if;
  return to_jsonb(r);
end $$;

create or replace function api_delete_draft(p_token text, p_id int)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; t text;
begin
  u := _admin(p_token);
  delete from timetable_drafts where id = p_id returning title into t;
  perform _audit(u.login_id, 'draft_delete', t);
end $$;

-- 전체 백업에 예비 시간표 포함
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
    'notices', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from notices n),
    'drafts', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from timetable_drafts d));
end $$;

revoke all on timetable_drafts from anon, authenticated;
revoke execute on function api_get_drafts(text), api_save_draft(text, jsonb), api_delete_draft(text, int) from public;
grant execute on function api_get_drafts(text), api_save_draft(text, jsonb), api_delete_draft(text, int), api_export(text) to anon, authenticated;
