revoke delete on table "public"."shidduchim" from "authenticated";

revoke insert on table "public"."shidduchim" from "authenticated";

revoke update on table "public"."shidduchim" from "authenticated";


  create table if not exists "public"."deleted_shidduch_tombstones" (
    "account_id" bigint not null,
    "shidduch_id" bigint not null,
    "deleted_at" timestamp with time zone not null default now()
      );


alter table "public"."deleted_shidduch_tombstones" enable row level security;


  create table if not exists "public"."storage_purge_queue" (
    "id" bigint generated always as identity not null,
    "account_id" bigint not null,
    "kind" text not null,
    "bucket" text not null,
    "storage_path" text not null,
    "reason" text,
    "phase" smallint not null default 1,
    "attempt" integer not null default 0,
    "not_before" timestamp with time zone not null default now(),
    "claimed_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."storage_purge_queue" enable row level security;

alter table "public"."shidduchim" add column if not exists "archived_at" timestamp with time zone;

do $$
begin
  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'shidduchim'
      and a.attname = 'id'
      and not a.attgenerated = 'a'
  ) then
    alter table "public"."shidduchim" alter column "id" set generated always;
  end if;
end
$$;

CREATE UNIQUE INDEX IF NOT EXISTS deleted_shidduch_tombstones_pkey ON public.deleted_shidduch_tombstones USING btree (account_id, shidduch_id);

CREATE INDEX IF NOT EXISTS storage_purge_queue_account_idx ON public.storage_purge_queue USING btree (account_id);

CREATE UNIQUE INDEX IF NOT EXISTS storage_purge_queue_account_kind_bucket_path_key ON public.storage_purge_queue USING btree (account_id, kind, bucket, storage_path);

CREATE INDEX IF NOT EXISTS storage_purge_queue_claim_idx ON public.storage_purge_queue USING btree (account_id, not_before, claimed_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS storage_purge_queue_pkey ON public.storage_purge_queue USING btree (id);

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'deleted_shidduch_tombstones'
      and c.conname = 'deleted_shidduch_tombstones_pkey'
  ) then
    alter table "public"."deleted_shidduch_tombstones"
      add constraint "deleted_shidduch_tombstones_pkey"
      primary key using index "deleted_shidduch_tombstones_pkey";
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'storage_purge_queue'
      and c.conname = 'storage_purge_queue_pkey'
  ) then
    alter table "public"."storage_purge_queue"
      add constraint "storage_purge_queue_pkey"
      primary key using index "storage_purge_queue_pkey";
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'storage_purge_queue'
      and c.conname = 'storage_purge_queue_account_id_fkey'
  ) then
    alter table "public"."storage_purge_queue"
      add constraint "storage_purge_queue_account_id_fkey"
      foreign key (account_id) references public.accounts(id) on delete restrict not valid;
  end if;
end
$$;
alter table "public"."storage_purge_queue"
  validate constraint "storage_purge_queue_account_id_fkey";

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'storage_purge_queue'
      and c.conname = 'storage_purge_queue_account_kind_bucket_path_key'
  ) then
    alter table "public"."storage_purge_queue"
      add constraint "storage_purge_queue_account_kind_bucket_path_key"
      unique using index "storage_purge_queue_account_kind_bucket_path_key";
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'storage_purge_queue'
      and c.conname = 'storage_purge_queue_attempt_check'
  ) then
    alter table "public"."storage_purge_queue"
      add constraint "storage_purge_queue_attempt_check"
      check ((attempt >= 0)) not valid;
  end if;
end
$$;

alter table "public"."storage_purge_queue" validate constraint "storage_purge_queue_attempt_check";

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'storage_purge_queue'
      and c.conname = 'storage_purge_queue_kind_check'
  ) then
    alter table "public"."storage_purge_queue"
      add constraint "storage_purge_queue_kind_check"
      check ((kind = any (array['object'::text, 'prefix'::text, 'quarantine'::text]))) not valid;
  end if;
end
$$;

alter table "public"."storage_purge_queue" validate constraint "storage_purge_queue_kind_check";

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'storage_purge_queue'
      and c.conname = 'storage_purge_queue_phase_check'
  ) then
    alter table "public"."storage_purge_queue"
      add constraint "storage_purge_queue_phase_check"
      check ((((kind = 'prefix'::text) and (phase = any (array[1, 2]))) or ((kind <> 'prefix'::text) and (phase = 1)))) not valid;
  end if;
end
$$;

alter table "public"."storage_purge_queue" validate constraint "storage_purge_queue_phase_check";

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'storage_purge_queue'
      and c.conname = 'storage_purge_queue_reason_check'
  ) then
    alter table "public"."storage_purge_queue"
      add constraint "storage_purge_queue_reason_check"
      check ((((kind = 'quarantine'::text) and (reason = any (array['unsupported_path'::text, 'legacy_path'::text, 'unknown_bucket'::text]))) or ((kind <> 'quarantine'::text) and (reason is null)))) not valid;
  end if;
end
$$;

alter table "public"."storage_purge_queue" validate constraint "storage_purge_queue_reason_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.account_storage_cleanup_fence(p_account_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.account_storage_lock(p_account_id);
  if not exists (select 1 from public.accounts where id = p_account_id) then
    return true;
  end if;
  return not exists (
    select 1 from public.storage_purge_queue where account_id = p_account_id
  ) and not exists (
    select 1
    from storage.objects
    where bucket_id in ('documents', 'entity-files', 'attachments')
      and (name = p_account_id::text or name like p_account_id::text || '/%')
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.account_storage_lock(p_account_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_account_id is null then
    raise exception 'account storage lock requires an account'
      using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(format('myshadchan-account-storage:%s', p_account_id), 0)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ack_shidduch_storage_purge(p_kind text, p_bucket text, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_row public.storage_purge_queue;
begin
  if v_account_id is null or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'Storage purge is not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_row
  from public.storage_purge_queue
  where account_id = v_account_id
    and kind = p_kind and bucket = p_bucket and storage_path = p_path
    and claimed_at is not null
  for update;
  if not found then
    return false;
  end if;
  if v_row.kind = 'prefix' and v_row.phase = 1 then
    update public.storage_purge_queue
    set phase = 2, not_before = now() + interval '24 hours',
        claimed_at = null, updated_at = now()
    where id = v_row.id;
  else
    delete from public.storage_purge_queue where id = v_row.id;
  end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_shidduch(p_id bigint)
 RETURNS SETOF public.shidduchim
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_row public.shidduchim;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'archive_shidduch requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;
  select s.* into v_row from public.shidduchim s
  where s.id = p_id and s.account_id = v_account_id
  for update;
  if not found then return; end if;
  update public.shidduchim set archived_at = coalesce(archived_at, now()) where id = p_id;
  return query select * from public.shidduch_row(p_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.authorize_shidduch_storage_removal(p_kind text, p_bucket text, p_queue_path text, p_object_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
begin
  if v_account_id is null or public.current_member_role() not in ('parent_admin', 'self_manager') then
    return false;
  end if;
  return exists (
    select 1
    from public.storage_purge_queue q
    where q.account_id = v_account_id
      and q.kind = p_kind
      and q.bucket = p_bucket
      and q.storage_path = p_queue_path
      and q.claimed_at is not null
      and (
        (p_kind = 'object' and p_object_path = p_queue_path)
        or (p_kind = 'prefix' and p_object_path like p_queue_path || '%')
      )
  ) and not public.storage_purge_path_referenced(p_bucket, p_object_path);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_shidduch_storage_purge()
 RETURNS SETOF public.storage_purge_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
begin
  if v_account_id is null or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'Storage purge is not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  update public.storage_purge_queue q
  set claimed_at = now(), attempt = q.attempt + 1, updated_at = now()
  from (
    select id
    from public.storage_purge_queue
    where account_id = v_account_id
      and not_before <= now()
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by id
    limit 100
    for update skip locked
  ) picked
  where q.id = picked.id
  returning q.*;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_owned_inbox_shidduch(p_id bigint, p_single_id bigint DEFAULT NULL::bigint, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
begin
  if v_account_id is null or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'Inbox suggestion cleanup requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_id and s.account_id = v_account_id
      and s.name_en is null
      and (p_single_id is null or s.single_id = p_single_id)
      and (p_created_at is null or s.created_at = p_created_at)
  ) then
    return false;
  end if;
  perform public.delete_shidduch(p_id);
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_shidduch(p_id bigint)
 RETURNS SETOF public.shidduchim
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_shidduch public.shidduchim;
  v_resume public.resumes;
  v_file jsonb;
  v_path text;
  v_prefix text;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'delete_shidduch requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;
  select s.* into v_shidduch from public.shidduchim s
  where s.id = p_id and s.account_id = v_account_id
  for update;
  if not found then return; end if;

  if exists (
    select 1
    from public.ai_reread_attempts a
    join public.resumes r on r.id = a.resume_id
    where r.shidduchim_id = p_id
      and a.status = 'in_progress'
      and a.lease_expires_at > now()
  ) then
    raise exception 'Please wait: this resume is being made easy to read.'
      using errcode = '55P03';
  end if;

  for v_resume in
    select r.* from public.resumes r where r.shidduchim_id = p_id
  loop
    if jsonb_typeof(v_resume.files) = 'array' then
      for v_file in select value from jsonb_array_elements(v_resume.files) loop
        v_path := v_file->>'path';
        if v_path is null or v_path = v_file->>'source_inbox_attachment_path' then
          continue;
        elsif v_path ~ ('^' || v_account_id::text || '/resumes/' || p_id::text || '/[^/]+$')
              and not v_path ~ '(^|/)(\.\.?)(/|$)' and not v_path ~ '[*?]' then
          perform public.storage_purge_queue_object(v_account_id, 'documents', v_path);
        else
          perform public.storage_purge_queue_quarantine(v_account_id, 'documents', v_path, 'unsupported_path');
        end if;
      end loop;
    end if;
  end loop;

  for v_path in
    select rp.path
    from public.resume_photos rp
    join public.resumes r on r.id = rp.resume_id
    where r.shidduchim_id = p_id
  loop
    if v_path ~ ('^' || v_account_id::text || '/photos/(shared|private_parent)/' || p_id::text || '/[^/]+$')
       and not v_path ~ '(^|/)(\.\.?)(/|$)' and not v_path ~ '[*?]' then
      perform public.storage_purge_queue_object(v_account_id, 'documents', v_path);
    else
      perform public.storage_purge_queue_quarantine(v_account_id, 'documents', v_path, 'unsupported_path');
    end if;
  end loop;

  for v_path in
    select ef.storage_path
    from public.entity_files ef
    where ef.account_id = v_account_id
      and ef.target_type = 'shidduch' and ef.target_id = p_id
  loop
    if v_path ~ ('^' || v_account_id::text || '/shidduch/' || p_id::text || '/[^/]+$')
       and not v_path ~ '(^|/)(\.\.?)(/|$)' and not v_path ~ '[*?]' then
      perform public.storage_purge_queue_object(v_account_id, 'entity-files', v_path);
    else
      perform public.storage_purge_queue_quarantine(v_account_id, 'entity-files', v_path, 'unsupported_path');
    end if;
  end loop;

  foreach v_prefix in array array[
    v_account_id::text || '/resumes/' || p_id::text || '/',
    v_account_id::text || '/photos/shared/' || p_id::text || '/',
    v_account_id::text || '/photos/private_parent/' || p_id::text || '/',
    v_account_id::text || '/shidduch/' || p_id::text || '/'
  ] loop
    insert into public.storage_purge_queue (account_id, kind, bucket, storage_path)
    values (
      v_account_id, 'prefix',
      case when v_prefix like '%/shidduch/%' then 'entity-files' else 'documents' end,
      v_prefix
    ) on conflict (account_id, kind, bucket, storage_path) do nothing;
  end loop;

  delete from public.shidduchim where id = p_id and account_id = v_account_id;
  return;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.entity_files_target_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context_id bigint := public.current_context_id();
  v_account_id bigint := coalesce(v_context_id, new.account_id);
  v_parent_id bigint;
begin
  if v_account_id is null or new.account_id is distinct from v_account_id then
    raise exception 'entity file account context mismatch'
      using errcode = 'insufficient_privilege';
  end if;
  if new.storage_path is null
     or new.storage_path !~ ('^' || v_account_id::text || '/' || new.target_type || '/' || new.target_id::text || '/[^/]+$')
     or new.storage_path ~ '(^|/)(\.\.?)(/|$)'
     or new.storage_path ~ '[*?]' then
    raise exception 'entity file storage path does not match its target'
      using errcode = 'check_violation';
  end if;

  perform public.account_storage_lock(v_account_id);
  if new.target_type = 'shidduch' then
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = new.target_id and s.account_id = v_account_id
    for share;
    if v_parent_id is null then
      raise exception 'entity file shidduch target is missing'
        using errcode = 'foreign_key_violation';
    end if;
    if exists (
      select 1 from public.deleted_shidduch_tombstones t
      where t.account_id = v_account_id and t.shidduch_id = new.target_id
    ) then
      raise exception 'entity file shidduch target is deleted'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_shidduch(p_id bigint)
 RETURNS SETOF public.shidduchim
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_row public.shidduchim;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'restore_shidduch requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;
  select s.* into v_row from public.shidduchim s
  where s.id = p_id and s.account_id = v_account_id
  for update;
  if not found then return; end if;
  update public.shidduchim set archived_at = null where id = p_id;
  return query select * from public.shidduch_row(p_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shidduch_delete_tombstone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.deleted_shidduch_tombstones (account_id, shidduch_id, deleted_at)
  values (old.account_id, old.id, now())
  on conflict (account_id, shidduch_id) do nothing;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shidduch_storage_path_allowed(p_bucket text, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_shidduch_id bigint;
begin
  if v_account_id is null or p_bucket is null or p_name is null then
    return false;
  end if;

  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/resumes/single-[0-9]+/[^/]+$') then
    return true;
  end if;
  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/photos/(shared|private_parent)/single-[0-9]+/[^/]+$') then
    return true;
  end if;
  if p_bucket = 'entity-files'
     and p_name ~ ('^' || v_account_id::text || '/(reference|shadchan|single|connection)/[0-9]+/[^/]+$') then
    return true;
  end if;

  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/resumes/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 3)::bigint;
  elsif p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/photos/(shared|private_parent)/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 4)::bigint;
  elsif p_bucket = 'entity-files'
     and p_name ~ ('^' || v_account_id::text || '/shidduch/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 3)::bigint;
  else
    return false;
  end if;

  return exists (
    select 1
    from public.shidduchim s
    where s.id = v_shidduch_id
      and s.account_id = v_account_id
  )
  and not exists (
    select 1
    from public.deleted_shidduch_tombstones t
    where t.account_id = v_account_id and t.shidduch_id = v_shidduch_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.storage_account_write_allowed(p_account_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_account_id is null or p_account_id is distinct from public.current_context_id() then
    return false;
  end if;
  perform public.account_storage_lock(p_account_id);
  return exists (select 1 from public.accounts where id = p_account_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.storage_purge_path_referenced(p_bucket text, p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (p_bucket = 'documents' and exists (
      select 1
      from public.resumes r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.files) = 'array' then r.files else '[]'::jsonb end
      ) f(value)
      where f.value->>'path' = p_path
         or f.value->>'source_inbox_attachment_path' = p_path
    ))
    or (p_bucket = 'documents' and exists (
      select 1 from public.resume_photos rp where rp.path = p_path
    ))
    or (p_bucket = 'entity-files' and exists (
      select 1 from public.entity_files ef where ef.storage_path = p_path
    ))
    or (p_bucket = 'attachments' and exists (
      select 1
      from public.inbox_items i
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(i.attachments) = 'array' then i.attachments else '[]'::jsonb end
      ) a(value)
      where a.value->>'path' = p_path
    ));
$function$
;

CREATE OR REPLACE FUNCTION public.storage_purge_queue_object(p_account_id bigint, p_bucket text, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_bucket not in ('documents', 'entity-files')
     or p_path is null
     or public.storage_purge_path_referenced(p_bucket, p_path) then
    return;
  end if;
  insert into public.storage_purge_queue (account_id, kind, bucket, storage_path)
  values (p_account_id, 'object', p_bucket, p_path)
  on conflict (account_id, kind, bucket, storage_path) do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.storage_purge_queue_quarantine(p_account_id bigint, p_bucket text, p_path text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_reason not in ('unsupported_path', 'legacy_path', 'unknown_bucket') then
    raise exception 'invalid Storage quarantine reason' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.storage_purge_queue (account_id, kind, bucket, storage_path, reason)
  values (p_account_id, 'quarantine', p_bucket, p_path, p_reason)
  on conflict (account_id, kind, bucket, storage_path) do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.account_has_domain_data(p_account_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
       exists (select 1 from public.singles where account_id = p_account_id)
    or exists (select 1 from public.shadchanim where account_id = p_account_id)
    or exists (select 1 from public."references" where account_id = p_account_id)
    or exists (select 1 from public.shidduchim where account_id = p_account_id)
    or exists (select 1 from public.resumes where account_id = p_account_id)
    or exists (select 1 from public.reference_links where account_id = p_account_id)
    or exists (select 1 from public.date_records where account_id = p_account_id)
    or exists (select 1 from public.redts where account_id = p_account_id)
    or exists (select 1 from public.shidduch_education where account_id = p_account_id)
    or exists (select 1 from public.shidduchim_external_links where account_id = p_account_id)
    or exists (select 1 from public.interactions where account_id = p_account_id)
    or exists (select 1 from public.identity_signals where account_id = p_account_id)
    or exists (select 1 from public.inbox_items where account_id = p_account_id)
    -- A queued Inbox object is a live cleanup obligation. Letting account
    -- disposal cascade this row would orphan the Storage object permanently.
    or exists (select 1 from public.inbox_attachment_purge where account_id = p_account_id)
    -- Shidduch object/prefix/quarantine work is equally live. Account
    -- deletion must not cascade this queue before the Storage drain.
    or exists (select 1 from public.storage_purge_queue where account_id = p_account_id)
    or exists (select 1 from public.tasks where account_id = p_account_id)
    or exists (select 1 from public.outbound_share_history where account_id = p_account_id);
$function$
;

CREATE OR REPLACE FUNCTION public.account_is_disposable(p_account_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Whether an account holds nothing that must outlive it. This is the ONE
  -- data fence behind both halves of the no-orphan invariant: guard_persona_
  -- removal() refuses to archive an account's last active membership unless
  -- this returns true, and dispose_orphaned_account() refuses to delete
  -- unless it does. Sharing the predicate is what makes "delete it, or leave
  -- it reachable" total -- two separately-maintained lists would drift and
  -- leave a state that is neither disposable nor removable.
  --
  -- It is deliberately STRICTER than account_has_domain_data() (which this
  -- calls): that one asks "would a person lose work", which is the right
  -- question for a warning and the wrong one for a DELETE. Every table below
  -- either cascades from accounts -- and so would be destroyed silently -- or
  -- is a cross-account edge whose other side would be left dangling.
  --
  -- Coverage is not maintained by hand: official_demo_account_orphan.sql
  -- derives every account-scoped base table from the catalog and fails if one
  -- is not named in this function's source. A table that deliberately does
  -- NOT block is named here in prose instead, with its reason:
  --   * account_members   -- only ARCHIVED rows remain by the time this is
  --                          consulted; dispose_orphaned_account() deletes them.
  --   * member_state      -- `on delete set null`; dispose repoints it first.
  --   * demo_onboarding_intents -- cascades, so dispose NULLs its account_id
  --                          first to keep the caller's retry state alive.
  --   * demo_clear_receipts -- carries no FK by design; the historical
  --                          root_account_id is the whole point of the ledger.
  --   * demo_run_member_state -- run-scoped and `set null`; a live run is
  --                          already blocked by demo_runs/demo_run_accounts.
  select not (
       public.account_has_domain_data(p_account_id)
    -- Billing and AI entitlement. `subscription` is the server-authoritative
    -- record (accounts.plan is a decoy) -- losing it silently is unacceptable.
    or exists (select 1 from public.subscription where account_id = p_account_id)
    or exists (select 1 from public.ai_usage where account_id = p_account_id)
    or exists (select 1 from public.ai_parse_attempts where account_id = p_account_id)
    or exists (select 1 from public.ai_reread_attempts where account_id = p_account_id)
    or exists (select 1 from public.stripe_events where account_id = p_account_id)
    or exists (select 1 from public.analytics_events where account_id = p_account_id)
    or exists (select 1 from public.account_deletion_requests where account_id = p_account_id)
    -- Content and marketplace surfaces account_has_domain_data does not ask about.
    or exists (select 1 from public.listings where account_id = p_account_id)
    or exists (select 1 from public.listing_withdrawal_locks where account_id = p_account_id)
    or exists (select 1 from public.invites where account_id = p_account_id)
    or exists (select 1 from public.entity_files where account_id = p_account_id)
    or exists (select 1 from public.medical_notes where account_id = p_account_id)
    or exists (select 1 from public.resume_photos where account_id = p_account_id)
    or exists (select 1 from public.single_preferences where account_id = p_account_id)
    or exists (select 1 from public.single_notes where account_id = p_account_id)
    or exists (select 1 from public.share_links where account_id = p_account_id)
    or exists (select 1 from public.trusted_senders where account_id = p_account_id)
    -- Discussion. Private parent-to-parent messages are the most sensitive
    -- rows in the product; they must never be a cascade casualty.
    or exists (select 1 from public.messages where account_id = p_account_id)
    or exists (select 1 from public.threads where account_id = p_account_id)
    or exists (select 1 from public.thread_participants where account_id = p_account_id)
    or exists (select 1 from public.message_notifications where account_id = p_account_id)
    or exists (select 1 from public.task_notifications where account_id = p_account_id)
    -- Cross-account edges: deleting this side would strand the other.
    or exists (
      select 1 from public.connections
      where household_account_id = p_account_id or shadchanus_account_id = p_account_id
    )
    or exists (
      select 1 from public.connection_invites
      where inviter_account_id = p_account_id or accepted_by_account_id = p_account_id
    )
    or exists (
      select 1 from public.child_grants
      where proposer_account_id = p_account_id or grantee_account_id = p_account_id
    )
    -- A live demo lifecycle owns this account's cleanup; never race it.
    or exists (select 1 from public.demo_runs where root_account_id = p_account_id)
    or exists (select 1 from public.demo_run_accounts where account_id = p_account_id)
    or exists (select 1 from public.demo_run_ingest_claims where account_id = p_account_id)
    or exists (select 1 from public.storage_purge_queue where account_id = p_account_id)
    -- Uploaded bytes. Deleting the row would leave the object unreferenced
    -- and unreachable, which is a leak in the other direction.
    or exists (
      select 1 from storage.objects
      where bucket_id in ('documents', 'entity-files', 'attachments')
        and (name = p_account_id::text or name like p_account_id::text || '/%')
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.add_resume_file(p_path text, p_filename text, p_mime_type text, p_size bigint, p_shidduchim_id bigint DEFAULT NULL::bigint, p_single_id bigint DEFAULT NULL::bigint, p_source_inbox_item_id bigint DEFAULT NULL::bigint, p_source_inbox_attachment_path text DEFAULT NULL::text)
 RETURNS SETOF public.resumes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_parent_id bigint;
  v_entry jsonb;
  v_source_attachment jsonb;
begin
  v_account_id := public.current_context_id();

  -- Upload/catalog lock order is account -> shidduch parent -> Inbox source.
  -- The parent FOR SHARE is taken before any resume row write so delete's
  -- parent FOR UPDATE cannot race a late catalog insert.
  if p_shidduchim_id is not null then
    perform public.account_storage_lock(v_account_id);
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for share;
    if v_parent_id is null then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
    if exists (
      select 1 from public.deleted_shidduch_tombstones t
      where t.account_id = v_account_id and t.shidduch_id = p_shidduchim_id
    ) then
      raise exception 'shidduch % is deleted', p_shidduchim_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_size < 0 then
    raise exception 'resume file size must not be negative';
  end if;

  if (p_source_inbox_item_id is null) <> (p_source_inbox_attachment_path is null) then
    raise exception 'source Inbox provenance must be provided together';
  end if;

  if p_source_inbox_item_id is not null then
    if public.current_member_role() is null or public.current_member_role() = 'single' then
      raise exception 'resume attachment is not available to this role';
    end if;

    select attachment
      into v_source_attachment
      from public.inbox_items i,
           jsonb_array_elements(coalesce(i.attachments, '[]'::jsonb)) attachment
     where i.id = p_source_inbox_item_id
       and i.account_id = v_account_id
       and i.status = 'unresolved'
       and attachment->>'path' = p_source_inbox_attachment_path
     limit 1
     for share;

    if v_source_attachment is null then
      raise exception 'Inbox attachment not found';
    end if;

    if p_source_inbox_attachment_path is null
       or p_source_inbox_attachment_path not like v_account_id::text || '/%' then
      raise exception 'Inbox attachment is outside the current account';
    end if;

    if nullif(trim(coalesce(v_source_attachment->>'type', '')), '') is not null
       and lower(v_source_attachment->>'type') not in (
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       )
       and lower(v_source_attachment->>'type') not like 'image/%' then
      raise exception 'Inbox attachment type is not eligible for a resume';
    end if;

    if nullif(trim(coalesce(v_source_attachment->>'type', '')), '') is null
       and lower(coalesce(v_source_attachment->>'title', '')) !~ '\.(pdf|doc|docx|gif|heic|heif|jpe?g|png|webp)$' then
      raise exception 'Inbox attachment type is not eligible for a resume';
    end if;

    if p_path is null or p_path not like v_account_id::text || '/resumes/%' then
      raise exception 'resume destination is outside the current account';
    end if;
  end if;

  if p_shidduchim_id is not null then
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
  else
    if not exists (
      select 1 from public.singles s
      where s.id = p_single_id and s.account_id = v_account_id
    ) then
      raise exception 'single % not found in current account', p_single_id;
    end if;
  end if;

  v_entry := jsonb_build_object(
    'path', p_path,
    'filename', coalesce(v_source_attachment->>'title', p_filename),
    'uploaded_at', now(),
    'uploaded_by', public.current_member_id(),
    'mime_type', coalesce(v_source_attachment->>'type', p_mime_type),
    'size', p_size
  );

  if p_source_inbox_item_id is not null then
    v_entry := v_entry || jsonb_build_object(
      'source_inbox_item_id', p_source_inbox_item_id,
      'source_inbox_attachment_path', p_source_inbox_attachment_path
    );
  end if;

  if p_shidduchim_id is not null then
    return query
    insert into public.resumes (account_id, shidduchim_id, files)
    values (v_account_id, p_shidduchim_id, jsonb_build_array(v_entry))
    on conflict (shidduchim_id) where shidduchim_id is not null do update
      set files = case
        when p_source_inbox_item_id is not null and exists (
          select 1
            from jsonb_array_elements(coalesce(public.resumes.files, '[]'::jsonb)) existing_file
           where existing_file->>'source_inbox_item_id' = p_source_inbox_item_id::text
             and existing_file->>'source_inbox_attachment_path' = p_source_inbox_attachment_path
        ) then public.resumes.files
        else coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
      end
    returning *;
  else
    return query
    insert into public.resumes (account_id, single_id, files)
    values (v_account_id, p_single_id, jsonb_build_array(v_entry))
    on conflict (single_id) where single_id is not null do update
      set files = case
        when p_source_inbox_item_id is not null and exists (
          select 1
            from jsonb_array_elements(coalesce(public.resumes.files, '[]'::jsonb)) existing_file
           where existing_file->>'source_inbox_item_id' = p_source_inbox_item_id::text
             and existing_file->>'source_inbox_attachment_path' = p_source_inbox_attachment_path
        ) then public.resumes.files
        else coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
      end
    returning *;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_resume_photo(p_path text, p_shidduchim_id bigint DEFAULT NULL::bigint, p_single_id bigint DEFAULT NULL::bigint, p_visibility text DEFAULT 'shared'::text)
 RETURNS SETOF public.resume_photos
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_resume_id bigint;
  v_parent_id bigint;
begin
  v_account_id := public.current_context_id();

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_shidduchim_id is not null then
    perform public.account_storage_lock(v_account_id);
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for share;
    if v_parent_id is null then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
    if exists (
      select 1 from public.deleted_shidduch_tombstones t
      where t.account_id = v_account_id and t.shidduch_id = p_shidduchim_id
    ) then
      raise exception 'shidduch % is deleted', p_shidduchim_id
        using errcode = 'foreign_key_violation';
    end if;
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;

    insert into public.resumes (account_id, shidduchim_id)
    values (v_account_id, p_shidduchim_id)
    on conflict (shidduchim_id) where shidduchim_id is not null
      do update set shidduchim_id = excluded.shidduchim_id
    returning id into v_resume_id;
  else
    if not exists (
      select 1 from public.singles s
      where s.id = p_single_id and s.account_id = v_account_id
    ) then
      raise exception 'single % not found in current account', p_single_id;
    end if;

    insert into public.resumes (account_id, single_id)
    values (v_account_id, p_single_id)
    on conflict (single_id) where single_id is not null
      do update set single_id = excluded.single_id
    returning id into v_resume_id;
  end if;

  return query
  insert into public.resume_photos (account_id, resume_id, path, visibility)
  values (v_account_id, v_resume_id, p_path, coalesce(p_visibility, 'shared'))
  returning *;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_ai_reread_sections(p_account_id bigint, p_resume_id bigint, p_attempt_id bigint, p_generation bigint, p_original_sections jsonb, p_next_sections jsonb, p_schema_version smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_attempt public.ai_reread_attempts;
  v_shidduch_id bigint;
begin
  if p_account_id is null or p_resume_id is null or p_attempt_id is null
     or p_generation is null or p_next_sections is null
     or p_schema_version is null then
    raise exception 're-read apply requires account, resume, attempt, generation, sections and schema version'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Lock the shidduch parent before the ledger generation. Delete takes the
  -- parent FOR UPDATE first, so apply/delete share one lock order.
  select s.id into v_shidduch_id
  from public.shidduchim s
  join public.resumes r on r.shidduchim_id = s.id
  where r.id = p_resume_id and r.account_id = p_account_id
  for share of s;

  -- Lock the ledger generation before touching the resume. The sections CAS
  -- and this completion update are one transaction, so an exception after
  -- the row update rolls both changes back and release_ai_reread_attempt()
  -- can safely refund the reservation.
  select * into v_attempt
  from public.ai_reread_attempts
  where id = p_attempt_id
    and account_id = p_account_id
    and resume_id = p_resume_id
  for update;
  if not found then
    raise exception 'ai_reread_attempts % is not applicable to account % and resume %',
      p_attempt_id, p_account_id, p_resume_id;
  end if;

  if v_attempt.generation <> p_generation
     or v_attempt.status <> 'in_progress' then
    if v_attempt.generation = p_generation and v_attempt.status = 'completed' then
      return jsonb_build_object('outcome', 'applied');
    end if;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  if not exists (
    select 1 from public.resumes
    where id = p_resume_id and account_id = p_account_id
  ) then
    raise exception 're-read resume does not belong to account'
      using errcode = 'foreign_key_violation';
  end if;

  update public.resumes
  set sections = p_next_sections
  where id = p_resume_id
    and account_id = p_account_id
    and sections is not distinct from p_original_sections;
  if not found then
    return jsonb_build_object('outcome', 'cas_failed');
  end if;

  update public.ai_reread_attempts
  set status = 'completed', result_schema_version = p_schema_version,
      lease_expires_at = now(), updated_at = now()
  where id = p_attempt_id and account_id = p_account_id
    and resume_id = p_resume_id
    and status = 'in_progress' and generation = p_generation;
  if not found then
    -- The locked row should make this unreachable. Keep it fail-closed so a
    -- future change cannot persist sections without consuming the unit.
    raise exception 're-read completion fence changed';
  end if;

  return jsonb_build_object('outcome', 'applied');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_ai_resume_read(p_account_id bigint, p_resume_id bigint, p_attempt_id bigint, p_generation bigint, p_file_identity text, p_fields jsonb, p_extracted jsonb, p_sections jsonb, p_schema_version smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_attempt public.ai_reread_attempts;
  v_resume public.resumes;
  v_shidduch_id bigint;
  v_sections jsonb;
  v_extracted jsonb;
  v_selected_uploaded_at timestamptz;
  v_latest_uploaded_at timestamptz;
  v_selected_position bigint;
  v_latest_position bigint;
begin
  if p_account_id is null or p_resume_id is null or p_attempt_id is null
     or p_generation is null or p_file_identity is null
     or btrim(p_file_identity) = '' or p_fields is null
     or jsonb_typeof(p_fields) <> 'object' or p_sections is null
     or jsonb_typeof(p_sections) <> 'object' or p_schema_version is null then
    raise exception 'resume read apply requires account, resume, attempt, generation, file, fields, sections and schema version'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Lock order is parent shidduch FOR SHARE -> attempt -> resume.
  select s.id into v_shidduch_id
  from public.shidduchim s
  join public.resumes r on r.shidduchim_id = s.id
  where r.id = p_resume_id and r.account_id = p_account_id
  for share of s;

  select * into v_attempt
  from public.ai_reread_attempts
  where id = p_attempt_id
    and account_id = p_account_id
    and resume_id = p_resume_id
  for update;
  if not found then
    raise exception 'ai_reread_attempts % is not applicable to account % and resume %',
      p_attempt_id, p_account_id, p_resume_id;
  end if;

  if v_attempt.generation <> p_generation
     or v_attempt.status <> 'in_progress' then
    if v_attempt.generation = p_generation and v_attempt.status = 'completed' then
      return jsonb_build_object('outcome', 'applied');
    end if;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  select * into v_resume
  from public.resumes
  where id = p_resume_id and account_id = p_account_id
  for update;
  if not found then
    raise exception 'resume % does not belong to account %', p_resume_id, p_account_id
      using errcode = 'foreign_key_violation';
  end if;

  -- The caller names the uploaded version it displayed. A later upload must
  -- not let this inference write into whichever file happens to be newest by
  -- the time the model returns. Array position breaks ties, so an append with
  -- the same timestamp is still detected as a newer version.
  select (entry.value ->> 'uploaded_at')::timestamptz, entry.ordinality
    into v_selected_uploaded_at, v_selected_position
  from jsonb_array_elements(
    case when jsonb_typeof(v_resume.files) = 'array'
      then v_resume.files else '[]'::jsonb end
  ) with ordinality as entry(value, ordinality)
  where entry.value ->> 'path' = p_file_identity
  limit 1;

  select (entry.value ->> 'uploaded_at')::timestamptz, entry.ordinality
    into v_latest_uploaded_at, v_latest_position
  from jsonb_array_elements(
    case when jsonb_typeof(v_resume.files) = 'array'
      then v_resume.files else '[]'::jsonb end
  ) with ordinality as entry(value, ordinality)
  order by (entry.value ->> 'uploaded_at')::timestamptz desc, entry.ordinality desc
  limit 1;

  if v_selected_uploaded_at is null
     or v_latest_uploaded_at is null
     or v_selected_position <> v_latest_position then
    return jsonb_build_object('outcome', 'stale_file');
  end if;

  v_sections := case
    when jsonb_typeof(v_resume.sections) = 'object' then v_resume.sections
    else '{}'::jsonb
  end;
  v_sections := v_sections || jsonb_build_object(
    'learningHistory', case
      when jsonb_typeof(v_sections -> 'learningHistory') = 'array'
           and jsonb_array_length(v_sections -> 'learningHistory') > 0
        then v_sections -> 'learningHistory'
      when jsonb_typeof(v_sections -> 'learningHistory') not in ('array', 'null')
        then v_sections -> 'learningHistory'
      when jsonb_typeof(p_sections -> 'learningHistory') = 'array'
        then p_sections -> 'learningHistory'
      else '[]'::jsonb
    end,
    'references', case
      when jsonb_typeof(v_sections -> 'references') = 'array'
           and jsonb_array_length(v_sections -> 'references') > 0
        then v_sections -> 'references'
      when jsonb_typeof(v_sections -> 'references') not in ('array', 'null')
        then v_sections -> 'references'
      when jsonb_typeof(p_sections -> 'references') = 'array'
        then p_sections -> 'references'
      else '[]'::jsonb
    end,
    'additionalSections', case
      when jsonb_typeof(v_sections -> 'additionalSections') = 'array'
           and jsonb_array_length(v_sections -> 'additionalSections') > 0
        then v_sections -> 'additionalSections'
      when jsonb_typeof(v_sections -> 'additionalSections') not in ('array', 'null')
        then v_sections -> 'additionalSections'
      when jsonb_typeof(p_sections -> 'additionalSections') = 'array'
        then p_sections -> 'additionalSections'
      else '[]'::jsonb
    end,
    'schemaVersion', p_schema_version
  );

  v_extracted := case
    when v_resume.extracted is null
         or jsonb_typeof(v_resume.extracted) = 'null'
         or v_resume.extracted = '{}'::jsonb
      then coalesce(p_extracted, '{}'::jsonb)
    else v_resume.extracted
  end;

  if v_resume.shidduchim_id is not null then
    update public.shidduchim
    set name_en = case when (name_en is null or btrim(name_en) = '')
        and jsonb_typeof(p_fields -> 'name_en') = 'string'
      then nullif(btrim(p_fields ->> 'name_en'), '') else name_en end,
      name_he = case when (name_he is null or btrim(name_he) = '')
        and jsonb_typeof(p_fields -> 'name_he') = 'string'
      then nullif(btrim(p_fields ->> 'name_he'), '') else name_he end,
      father_en = case when (father_en is null or btrim(father_en) = '')
        and jsonb_typeof(p_fields -> 'father_en') = 'string'
      then nullif(btrim(p_fields ->> 'father_en'), '') else father_en end,
      father_he = case when (father_he is null or btrim(father_he) = '')
        and jsonb_typeof(p_fields -> 'father_he') = 'string'
      then nullif(btrim(p_fields ->> 'father_he'), '') else father_he end,
      mother_en = case when (mother_en is null or btrim(mother_en) = '')
        and jsonb_typeof(p_fields -> 'mother_en') = 'string'
      then nullif(btrim(p_fields ->> 'mother_en'), '') else mother_en end,
      mother_he = case when (mother_he is null or btrim(mother_he) = '')
        and jsonb_typeof(p_fields -> 'mother_he') = 'string'
      then nullif(btrim(p_fields ->> 'mother_he'), '') else mother_he end,
      seminary_en = case when (seminary_en is null or btrim(seminary_en) = '')
        and jsonb_typeof(p_fields -> 'seminary_en') = 'string'
      then nullif(btrim(p_fields ->> 'seminary_en'), '') else seminary_en end,
      seminary_he = case when (seminary_he is null or btrim(seminary_he) = '')
        and jsonb_typeof(p_fields -> 'seminary_he') = 'string'
      then nullif(btrim(p_fields ->> 'seminary_he'), '') else seminary_he end,
      shul_en = case when (shul_en is null or btrim(shul_en) = '')
        and jsonb_typeof(p_fields -> 'shul_en') = 'string'
      then nullif(btrim(p_fields ->> 'shul_en'), '') else shul_en end,
      shul_he = case when (shul_he is null or btrim(shul_he) = '')
        and jsonb_typeof(p_fields -> 'shul_he') = 'string'
      then nullif(btrim(p_fields ->> 'shul_he'), '') else shul_he end,
      location_en = case when (location_en is null or btrim(location_en) = '')
        and jsonb_typeof(p_fields -> 'location_en') = 'string'
      then nullif(btrim(p_fields ->> 'location_en'), '') else location_en end,
      location_he = case when (location_he is null or btrim(location_he) = '')
        and jsonb_typeof(p_fields -> 'location_he') = 'string'
      then nullif(btrim(p_fields ->> 'location_he'), '') else location_he end,
      age = case when age is null
        and jsonb_typeof(p_fields -> 'age') = 'number'
        and p_fields ->> 'age' ~ '^-?[0-9]+$'
      then (p_fields ->> 'age')::integer else age end,
      height = case when (height is null or btrim(height) = '')
        and jsonb_typeof(p_fields -> 'height') = 'string'
      then nullif(btrim(p_fields ->> 'height'), '') else height end,
      person_gender = case when (person_gender is null or btrim(person_gender) = '')
        and jsonb_typeof(p_fields -> 'person_gender') = 'string'
      then nullif(btrim(p_fields ->> 'person_gender'), '') else person_gender end,
      kohen_status = case when (kohen_status is null or btrim(kohen_status) = '')
        and jsonb_typeof(p_fields -> 'kohen_status') = 'string'
      then nullif(btrim(p_fields ->> 'kohen_status'), '') else kohen_status end,
      marital_status = case when (marital_status is null or btrim(marital_status) = '')
        and jsonb_typeof(p_fields -> 'marital_status') = 'string'
      then nullif(btrim(p_fields ->> 'marital_status'), '') else marital_status end
    where id = v_resume.shidduchim_id and account_id = p_account_id;
    if not found then
      raise exception 'resume % has no owned shidduch %', p_resume_id, v_resume.shidduchim_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  update public.resumes
  set extracted = v_extracted,
      sections = v_sections
  where id = p_resume_id and account_id = p_account_id;
  if not found then
    raise exception 'resume % disappeared during apply', p_resume_id;
  end if;

  update public.ai_reread_attempts
  set status = 'completed', result_schema_version = p_schema_version,
      lease_expires_at = now(), updated_at = now()
  where id = p_attempt_id and account_id = p_account_id
    and resume_id = p_resume_id and status = 'in_progress'
    and generation = p_generation;
  if not found then
    raise exception 'resume read completion fence changed';
  end if;

  return jsonb_build_object('outcome', 'applied');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_ai_reread_attempt(p_account_id bigint, p_resume_id bigint, p_request_id uuid, p_current_schema_version smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_lease constant interval := interval '5 minutes';
  v_period text := to_char(now(), 'YYYY-MM');
  v_attempt public.ai_reread_attempts;
  v_limit integer;
  v_new_count integer;
  v_reclaim_attempt_id bigint;
  v_shidduch_id bigint;
begin
  if p_account_id is null or p_resume_id is null or p_request_id is null then
    raise exception 're-read claim requires account, resume and request'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Lock order is parent shidduch FOR SHARE -> attempts. A delete takes the
  -- same parent first FOR UPDATE order, so claim/delete cannot deadlock.
  select s.id into v_shidduch_id
  from public.shidduchim s
  join public.resumes r on r.shidduchim_id = s.id
  where r.id = p_resume_id and r.account_id = p_account_id
  for share of s;

  -- The service-role RPC is an independent trust boundary from the Worker.
  -- Reject a forged account/resume pair before retention, quota reservation,
  -- or any ledger write can occur.
  if not exists (
    select 1
    from public.resumes
    where id = p_resume_id and account_id = p_account_id
  ) then
    raise exception 're-read resume does not belong to account'
      using errcode = 'foreign_key_violation';
  end if;

  with doomed as (
    select id
    from public.ai_reread_attempts
    where status in ('completed', 'failed')
      and updated_at < now() - interval '30 days'
    order by updated_at
    limit 100
  )
  delete from public.ai_reread_attempts a
  using doomed
  where a.id = doomed.id;

  perform pg_advisory_xact_lock(
    hashtextextended(format('ai-reread-resume:%s', p_resume_id), 0)
  );

  select * into v_attempt
  from public.ai_reread_attempts
  where account_id = p_account_id
    and resume_id = p_resume_id
    and request_id = p_request_id
  for update;

  if found then
    if v_attempt.status = 'completed' then
      return jsonb_build_object(
        'outcome', 'replayed', 'attempt_id', v_attempt.id,
        'generation', v_attempt.generation
      );
    end if;

    if v_attempt.status = 'in_progress' then
      if v_attempt.lease_expires_at > now() then
        return jsonb_build_object(
          'outcome', 'in_progress', 'attempt_id', v_attempt.id,
          'generation', v_attempt.generation
        );
      end if;
      update public.ai_reread_attempts
      set generation = generation + 1,
          lease_expires_at = now() + c_lease, updated_at = now()
      where id = v_attempt.id
      returning * into v_attempt;
      return jsonb_build_object(
        'outcome', 'reserved', 'attempt_id', v_attempt.id,
        'generation', v_attempt.generation
      );
    end if;

    -- A failed request may be retried with the same idempotency key.  It
    -- keeps its ledger row, but must reserve one new unit before becoming
    -- the next generation; the update below avoids a unique-key insert.
    if v_attempt.status = 'failed' then
      v_reclaim_attempt_id := v_attempt.id;
    end if;
  end if;

  select * into v_attempt
  from public.ai_reread_attempts
  where resume_id = p_resume_id and status = 'in_progress'
  for update;
  if found then
    if v_attempt.account_id = p_account_id
       and v_attempt.lease_expires_at <= now() then
      update public.ai_reread_attempts
      set request_id = p_request_id, generation = generation + 1,
          lease_expires_at = now() + c_lease, updated_at = now()
      where id = v_attempt.id and account_id = p_account_id
      returning * into v_attempt;
      return jsonb_build_object(
        'outcome', 'reserved', 'attempt_id', v_attempt.id,
        'generation', v_attempt.generation
      );
    end if;
    return jsonb_build_object(
      'outcome', 'busy', 'attempt_id', v_attempt.id,
      'generation', v_attempt.generation
    );
  end if;

  v_limit := public.ai_resume_limit_for_account(p_account_id);
  if v_limit <= 0 then
    if exists (
      select 1 from public.subscription
      where account_id = p_account_id and plan = 'ai' and status = 'active'
    ) then
      return jsonb_build_object('outcome', 'no_allowance');
    end if;
    return jsonb_build_object('outcome', 'not_entitled');
  end if;

  insert into public.ai_usage as u (account_id, period, resumes_parsed)
  values (p_account_id, v_period, 1)
  on conflict (account_id, period) do update
    set resumes_parsed = u.resumes_parsed + 1
    where u.resumes_parsed < v_limit
  returning u.resumes_parsed into v_new_count;
  if not found then
    return jsonb_build_object('outcome', 'no_allowance');
  end if;

  if v_reclaim_attempt_id is not null then
    update public.ai_reread_attempts
    set period = v_period, status = 'in_progress', generation = generation + 1,
        lease_expires_at = now() + c_lease, updated_at = now()
    where id = v_reclaim_attempt_id and account_id = p_account_id
      and status = 'failed'
    returning * into v_attempt;
  else
    insert into public.ai_reread_attempts
      (account_id, resume_id, request_id, period, status, generation,
       lease_expires_at, updated_at)
    values
      (p_account_id, p_resume_id, p_request_id, v_period, 'in_progress', 1,
       now() + c_lease, now())
    returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'outcome', 'reserved', 'attempt_id', v_attempt.id,
    'generation', v_attempt.generation
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_account_data(p_account_id bigint, p_requested_by_auth_uid uuid, p_include_export boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_context_id bigint;
  v_demo boolean;
  v_export jsonb;
  v_deleted_account_id bigint;
begin
  if v_user_id is null then
    raise exception 'delete_account_data requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_requested_by_auth_uid is distinct from v_user_id then
    raise exception 'delete_account_data caller mismatch'
      using errcode = 'insufficient_privilege';
  end if;

  v_context_id := public.current_context_id();
  if v_context_id is distinct from p_account_id then
    raise exception 'delete_account_data account mismatch'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1
    from public.account_members am
    where am.account_id = p_account_id
      and am.user_id = v_user_id
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'only an active account owner may delete account data'
      using errcode = 'insufficient_privilege';
  end if;

  select a.demo into v_demo
  from public.accounts a
  where a.id = p_account_id
  for update;
  if not found then
    raise exception 'account not found for deletion: %', p_account_id
      using errcode = 'no_data';
  end if;
  if v_demo then
    raise exception 'demo accounts must be cleared through the demo lifecycle'
      using errcode = 'check_violation';
  end if;

  if not public.account_storage_cleanup_fence(p_account_id) then
    raise exception 'account has pending Storage cleanup; drain it before deletion'
      using errcode = 'check_violation';
  end if;

  if p_include_export then
    v_export := public.export_full_account_bundle();
  end if;

  if exists (
    select 1
    from storage.objects
    where bucket_id in ('documents', 'entity-files', 'attachments')
      and (name = p_account_id::text or name like p_account_id::text || '/%')
  ) then
    raise exception 'account has storage objects; remove them through the Storage API before deletion'
      using errcode = 'check_violation';
  end if;

  delete from public.child_grants
  where proposer_account_id = p_account_id
     or grantee_account_id = p_account_id;

  delete from public.connection_invites
  where inviter_account_id = p_account_id
     or accepted_by_account_id = p_account_id;

  delete from public.connections
  where household_account_id = p_account_id
     or shadchanus_account_id = p_account_id;

  delete from public.stripe_events
  where account_id = p_account_id;

  delete from public.accounts
  where id = p_account_id
  returning id into v_deleted_account_id;

  if not found then
    raise exception 'account disappeared during deletion: %', p_account_id
      using errcode = 'serialization_failure';
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'deleted_account_id', v_deleted_account_id,
    'export', v_export
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dispose_orphaned_account(p_account_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_exists boolean;
begin
  -- Deletes an account that no longer has any live member. This is the
  -- "delete it" half of the invariant assert_account_not_orphaned() enforces;
  -- the other half is that a caller which gets `false` back must leave the
  -- account reachable instead. It is never correct to call this and ignore
  -- the result.
  if p_account_id is null then
    return false;
  end if;

  select true into v_exists
  from public.accounts where id = p_account_id
  for update;
  if not found then
    -- Already gone (a concurrent lifecycle finished first). The invariant
    -- holds, so this is success, not failure.
    return true;
  end if;

  if exists (
    select 1 from public.account_members
    where account_id = p_account_id and status = 'active'
  ) then
    return false;
  end if;

  if not public.account_is_disposable(p_account_id) then
    return false;
  end if;

  -- The same queue/object fence used by delete_account_data(). This path is
  -- service_role-only but is still an account deletion path, so it must not
  -- erase a pending prefix sweep or race a Storage upload.
  if not public.account_storage_cleanup_fence(p_account_id) then
    return false;
  end if;

  -- Release the two references that must survive the account rather than
  -- cascade with it. member_state would be SET NULL anyway; the intent would
  -- be DELETED, taking the caller's retry state and attempts counter with it
  -- (measured -- prepare_demo_onboarding then returned state=null).
  update public.member_state
  set active_account_id = null, updated_at = now()
  where active_account_id = p_account_id;

  update public.demo_onboarding_intents
  set account_id = null, updated_at = now()
  where account_id = p_account_id;

  delete from public.account_members where account_id = p_account_id;
  delete from public.accounts where id = p_account_id;
  return true;
end;
$function$
;

create or replace view "public"."reference_links_summary" as  SELECT rl.id,
    rl.account_id,
    rl.created_at,
    rl.reference_id,
    rl.shidduchim_id,
    rl.resume_id,
    rl.call_status,
    rl.what_they_said,
    rl.conversation_log,
    rl.relationship_override,
    COALESCE(rl.relationship_override, r.relationship) AS effective_relationship,
    COALESCE(jsonb_array_length(rl.conversation_log), 0) AS conversation_log_count,
    r.name_en AS reference_name_en,
    r.name_he AS reference_name_he,
    r.phone AS reference_phone,
    s.name_en AS shidduch_name_en,
    s.name_he AS shidduch_name_he,
    s.pipeline_state AS shidduch_pipeline_state,
    s.visibility AS shidduch_visibility,
    s.single_id,
    c.first_name_en AS single_first_name_en,
    c.first_name_he AS single_first_name_he,
    s.archived_at AS shidduch_archived_at
   FROM (((public.reference_links rl
     LEFT JOIN public."references" r ON ((r.id = rl.reference_id)))
     LEFT JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
     LEFT JOIN public.singles c ON ((c.id = s.single_id)));


create or replace view "public"."references_summary" as  SELECT r.id,
    r.account_id,
    r.created_at,
    r.name_en,
    r.name_he,
    r.relationship,
    r.phone,
    r.school,
    r.grad_year,
    r.name_norm_en,
    r.name_norm_he,
    r.phone_norm,
    count(DISTINCT rl.shidduchim_id) FILTER (WHERE (s.archived_at IS NULL)) AS linked_shidduchim_count,
    count(DISTINCT rl.id) FILTER (WHERE (rl.call_status = ANY (ARRAY['answered'::text, 'they_will_call_back'::text]))) AS contacted_count,
    max(i.created_at) FILTER (WHERE (i.kind = 'call_logged'::text)) AS last_conversation_at,
    count(DISTINCT t.id) FILTER (WHERE (t.done_date IS NULL)) AS open_task_count
   FROM ((((public."references" r
     LEFT JOIN public.reference_links rl ON ((rl.reference_id = r.id)))
     LEFT JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
     LEFT JOIN public.interactions i ON (((i.target_type = 'reference'::text) AND (i.target_id = r.id))))
     LEFT JOIN public.tasks t ON (((t.target_type = 'reference'::text) AND (t.target_id = r.id))))
  GROUP BY r.id;


create or replace view "public"."shadchan_stats" as  SELECT sh.id,
    sh.account_id,
    count(s.id) FILTER (WHERE (s.archived_at IS NULL)) AS nb_suggestions,
    count(s.id) FILTER (WHERE ((s.archived_at IS NULL) AND (s.pipeline_state <> 'new'::public.pipeline_state))) AS nb_progressed,
    count(s.id) FILTER (WHERE ((s.archived_at IS NULL) AND (s.pipeline_state = 'yes'::public.pipeline_state))) AS nb_reached_yes,
    max(s.redt_date) FILTER (WHERE (s.archived_at IS NULL)) AS last_redt_date,
    count(DISTINCT s.single_id) FILTER (WHERE ((s.archived_at IS NULL) AND (s.pipeline_state = ANY (ARRAY['new'::public.pipeline_state, 'look_into'::public.pipeline_state, 'not_sure'::public.pipeline_state])))) AS nb_open_singles
   FROM (public.shadchanim sh
     LEFT JOIN public.shidduchim s ON ((s.shadchan_id = sh.id)))
  GROUP BY sh.id;


CREATE OR REPLACE FUNCTION public.shidduch_row(p_shidduchim_id bigint)
 RETURNS SETOF public.shidduchim
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    s.id, s.account_id, s.created_at, s.single_id, s.shadchan_id,
    s.name_en, s.name_he, s.seminary_en, s.seminary_he,
    s.shul_en, s.shul_he, s.location_en, s.location_he,
    s.age, s.height, s.pipeline_state, s.first_suggested_by,
    s.first_suggested_at, s.redt_date, public.shidduch_close_reason(s.id),
    s.origin, s.owner_member_id, s.visibility, s.index, s.background, s.dob,
    s.existing_children_note, s.father_en, s.father_he, s.marital_status,
    s.mother_en, s.mother_he, s.kohen_status, s.person_gender, s.archived_at
  from public.shidduchim s where s.id = p_shidduchim_id;
$function$
;

create or replace view "public"."shidduchim_catch_summary" as  SELECT a.target_id AS shidduchim_id,
    a.account_id,
    count(DISTINCT b.target_id) AS catch_count
   FROM (((public.identity_signals a
     JOIN public.identity_signals b ON (((b.account_id = a.account_id) AND (b.target_type = 'shidduch'::text) AND (b.target_id <> a.target_id) AND (((a.name_en_norm IS NOT NULL) AND (b.name_en_norm = a.name_en_norm)) OR ((a.name_he_norm IS NOT NULL) AND (b.name_he_norm = a.name_he_norm)) OR ((a.name_en_key IS NOT NULL) AND (b.name_en_key = a.name_en_key)) OR ((a.name_he_key IS NOT NULL) AND (b.name_he_key = a.name_he_key))) AND (((a.parents_norm IS NOT NULL) AND (b.parents_norm = a.parents_norm)) OR ((a.seminary_norm IS NOT NULL) AND (b.seminary_norm = a.seminary_norm)) OR ((a.shul_norm IS NOT NULL) AND (b.shul_norm = a.shul_norm)) OR ((a.location_norm IS NOT NULL) AND (b.location_norm = a.location_norm))))))
     JOIN public.shidduchim ash ON ((ash.id = a.target_id)))
     JOIN public.shidduchim bsh ON ((bsh.id = b.target_id)))
  WHERE ((a.target_type = 'shidduch'::text) AND (ash.archived_at IS NULL) AND (bsh.archived_at IS NULL) AND (NOT COALESCE(public.shidduch_has_known_halachic_conflict(ash.single_id, ash.person_gender, ash.kohen_status, ash.marital_status), false)) AND (NOT COALESCE(public.shidduch_has_known_halachic_conflict(bsh.single_id, bsh.person_gender, bsh.kohen_status, bsh.marital_status), false)))
  GROUP BY a.target_id, a.account_id;


create or replace view "public"."shidduchim_summary" as  SELECT s.id,
    s.account_id,
    s.created_at,
    s.single_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.father_en,
    s.father_he,
    s.mother_en,
    s.mother_he,
    s.seminary_en,
    s.seminary_he,
    s.shul_en,
    s.shul_he,
    s.location_en,
    s.location_he,
    s.age,
    s.height,
    s.dob,
    s.background,
    s.marital_status,
    s.existing_children_note,
    s.pipeline_state,
    s.first_suggested_by,
    s.first_suggested_at,
    s.redt_date,
    public.shidduch_close_reason(s.id) AS close_reason,
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    sh.name AS shadchan_name,
    sh.name_he AS shadchan_name_he,
    c.first_name_en AS single_first_name_en,
    c.first_name_he AS single_first_name_he,
    c.last_name_en AS single_last_name_en,
    c.last_name_he AS single_last_name_he,
    count(DISTINCT rl.id) AS nb_references,
    count(DISTINCT r.id) AS nb_redts,
    COALESCE(max(cat.catch_count), (0)::bigint) AS catch_count,
    s.person_gender,
    s.kohen_status,
    s.archived_at
   FROM (((((public.shidduchim s
     LEFT JOIN public.shadchanim sh ON ((sh.id = s.shadchan_id)))
     LEFT JOIN public.singles c ON ((c.id = s.single_id)))
     LEFT JOIN public.reference_links rl ON ((rl.shidduchim_id = s.id)))
     LEFT JOIN public.redts r ON ((r.shidduchim_id = s.id)))
     LEFT JOIN public.shidduchim_catch_summary cat ON ((cat.shidduchim_id = s.id)))
  WHERE (NOT COALESCE(public.shidduch_has_known_halachic_conflict(s.single_id, s.person_gender, s.kohen_status, s.marital_status), false))
  GROUP BY s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;


create or replace view "public"."singles_summary" as  SELECT c.id,
    c.account_id,
    c.created_at,
    c.first_name_en,
    c.first_name_he,
    c.last_name_en,
    c.last_name_he,
    c.gender,
    c.dob,
    c.community,
    c.status,
    c.member_id,
    (EXISTS ( SELECT 1
           FROM public.child_grants g
          WHERE ((g.target_single_id = c.id) AND (g.grantee_account_id = public.current_context_id()) AND (g.status = 'accepted'::text) AND (g.proposer_account_id <> public.current_context_id())))) AS is_shared_with_me,
    count(s.id) FILTER (WHERE (s.archived_at IS NULL)) AS total_shidduchim,
    count(s.id) FILTER (WHERE ((s.archived_at IS NULL) AND (s.pipeline_state = ANY (ARRAY['new'::public.pipeline_state, 'look_into'::public.pipeline_state, 'not_sure'::public.pipeline_state])) AND (NOT COALESCE(public.shidduch_has_known_halachic_conflict(s.single_id, s.person_gender, s.kohen_status, s.marital_status), false)))) AS open_shidduchim,
    c.kohen_status,
    c.marital_status
   FROM (public.singles c
     LEFT JOIN public.shidduchim s ON ((s.single_id = c.id)))
  GROUP BY c.id;


grant delete on table "public"."deleted_shidduch_tombstones" to "service_role";

grant insert on table "public"."deleted_shidduch_tombstones" to "service_role";

grant references on table "public"."deleted_shidduch_tombstones" to "service_role";

grant select on table "public"."deleted_shidduch_tombstones" to "service_role";

grant trigger on table "public"."deleted_shidduch_tombstones" to "service_role";

grant truncate on table "public"."deleted_shidduch_tombstones" to "service_role";

grant update on table "public"."deleted_shidduch_tombstones" to "service_role";

grant select on table "public"."storage_purge_queue" to "authenticated";

grant delete on table "public"."storage_purge_queue" to "service_role";

grant insert on table "public"."storage_purge_queue" to "service_role";

grant references on table "public"."storage_purge_queue" to "service_role";

grant select on table "public"."storage_purge_queue" to "service_role";

grant trigger on table "public"."storage_purge_queue" to "service_role";

grant truncate on table "public"."storage_purge_queue" to "service_role";

grant update on table "public"."storage_purge_queue" to "service_role";

drop policy if exists "Storage purge queue readable by owning managers" on "public"."storage_purge_queue";


  create policy "Storage purge queue readable by owning managers"
  on "public"."storage_purge_queue"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = ANY (ARRAY['parent_admin'::text, 'self_manager'::text]))));


drop trigger if exists validate_entity_files_shidduch_target on public.entity_files;
CREATE TRIGGER validate_entity_files_shidduch_target BEFORE INSERT OR UPDATE OF account_id, target_type, target_id, storage_path ON public.entity_files FOR EACH ROW EXECUTE FUNCTION public.entity_files_target_guard();

drop trigger if exists tombstone_shidduch_before_delete on public.shidduchim;
CREATE TRIGGER tombstone_shidduch_before_delete BEFORE DELETE ON public.shidduchim FOR EACH ROW EXECUTE FUNCTION public.shidduch_delete_tombstone();

drop policy if exists "Attachments writable within account" on "storage"."objects";

drop policy if exists "Documents photos writable within account" on "storage"."objects";

drop policy if exists "Documents resumes writable within account" on "storage"."objects";

drop policy if exists "Entity files writable within account" on "storage"."objects";


  create policy "Attachments writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'attachments'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND public.storage_account_write_allowed(((storage.foldername(name))[1])::bigint)));



  create policy "Documents photos writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'photos'::text) AND ((storage.foldername(name))[3] = ANY (ARRAY['shared'::text, 'private_parent'::text])) AND public.storage_account_write_allowed(((storage.foldername(name))[1])::bigint) AND public.shidduch_storage_path_allowed(bucket_id, name)));



  create policy "Documents resumes writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'resumes'::text) AND (public.current_member_role() <> 'single'::text) AND public.storage_account_write_allowed(((storage.foldername(name))[1])::bigint) AND public.shidduch_storage_path_allowed(bucket_id, name)));



  create policy "Entity files writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'entity-files'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND (public.current_member_role() <> 'single'::text) AND public.storage_account_write_allowed(((storage.foldername(name))[1])::bigint) AND public.shidduch_storage_path_allowed(bucket_id, name)));
