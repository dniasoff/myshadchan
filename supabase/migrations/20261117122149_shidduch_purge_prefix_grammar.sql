do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.storage_purge_queue'::regclass
      and conname = 'storage_purge_queue_prefix_grammar_check'
  ) then
    alter table "public"."storage_purge_queue"
      add constraint "storage_purge_queue_prefix_grammar_check" CHECK (((kind <> 'prefix'::text) OR ((split_part(storage_path, '/'::text, 1) = (account_id)::text) AND ("right"(storage_path, 1) = '/'::text) AND (POSITION(('..'::text) IN (storage_path)) = 0) AND (POSITION(('*'::text) IN (storage_path)) = 0) AND (POSITION(('?'::text) IN (storage_path)) = 0) AND (((bucket = 'documents'::text) AND (storage_path ~ '^[0-9]+/resumes/[0-9]+/$'::text)) OR ((bucket = 'documents'::text) AND (storage_path ~ '^[0-9]+/photos/(shared|private_parent)/[0-9]+/$'::text)) OR ((bucket = 'entity-files'::text) AND (storage_path ~ '^[0-9]+/shidduch/[0-9]+/$'::text)))))) not valid;
  end if;
end;
$$;

alter table "public"."storage_purge_queue" validate constraint "storage_purge_queue_prefix_grammar_check";

-- Migration-time fail-closed audit. Report only the count so a migration log
-- cannot disclose private object names; delete_shidduch quarantines any later
-- unsupported path in the durable queue for operator recovery.
do $$
declare
  v_unsupported bigint;
begin
  select count(*) into v_unsupported
  from (
    select 1
    from public.resumes r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.files) = 'array' then r.files else '[]'::jsonb end
    ) f
    where r.shidduchim_id is not null
      and nullif(f->>'path', '') is not null
      and (f->>'path') is distinct from (f->>'source_inbox_attachment_path')
      and not (
        (f->>'path') ~ ('^' || r.account_id::text || '/resumes/' || r.shidduchim_id::text || '/[^/]+$')
        and (f->>'path') !~ '(^|/)(\.\.?)(/|$)'
        and (f->>'path') !~ '[*?]'
      )
    union all
    select 1
    from public.resume_photos rp
    join public.resumes r on r.id = rp.resume_id
    where r.shidduchim_id is not null
      and not (
        rp.path ~ ('^' || r.account_id::text || '/photos/(shared|private_parent)/' || r.shidduchim_id::text || '/[^/]+$')
        and rp.path !~ '(^|/)(\.\.?)(/|$)'
        and rp.path !~ '[*?]'
      )
    union all
    select 1
    from public.entity_files ef
    where ef.target_type = 'shidduch'
      and not (
        ef.storage_path ~ ('^' || ef.account_id::text || '/shidduch/' || ef.target_id::text || '/[^/]+$')
        and ef.storage_path !~ '(^|/)(\.\.?)(/|$)'
        and ef.storage_path !~ '[*?]'
      )
  ) unsupported;

  raise notice 'shidduch storage path audit: unsupported catalog row count=%', v_unsupported;
  if v_unsupported > 0 then
    raise exception 'shidduch storage path audit failed: unsupported catalog row count=%', v_unsupported
      using errcode = 'check_violation';
  end if;
end;
$$;

-- Keep internal queue/path helpers out of the RPC surface. The invoker resume
-- writers need only the advisory lock primitive; all other helpers are called
-- from SECURITY DEFINER entry points or triggers.
revoke all on function public.account_storage_lock(bigint) from public, anon;
grant execute on function public.account_storage_lock(bigint) to authenticated, service_role;
revoke all on function public.storage_purge_path_referenced(text, text) from public, anon, authenticated;
revoke all on function public.storage_purge_queue_object(bigint, text, text) from public, anon, authenticated;
revoke all on function public.storage_purge_queue_quarantine(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.account_storage_cleanup_fence(bigint) from public, anon, authenticated;
