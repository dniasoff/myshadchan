-- Resume reference reconciliation (myshadchan-6f2,myshadchan-n14).
--
-- This migration installs the filing-time RPC and runs the existing-data
-- backfill in the same guarded migration. The DML is insert-only: existing
-- references, links, statuses, notes, logs, relationship overrides and
-- interactions are never updated. New links carry resume_id and a
-- link_created interaction metadata.source marker so a rollback review can
-- identify exactly what this migration created without adding a new column.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION "public"."reconcile_resume_references_for_account"("p_resume_id" bigint, "p_account_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_resume public.resumes;
  v_candidate jsonb;
  v_references jsonb;
  v_name_raw text;
  v_relationship text;
  v_phone_raw text;
  v_name_norm text;
  v_phone_norm text;
  v_candidate_key text;
  v_seen_keys text[] := array[]::text[];
  v_name_matches bigint[];
  v_phone_matches bigint[];
  v_combined_matches bigint[];
  v_reference_id bigint;
  v_link_id bigint;
  v_shidduchim_id bigint;
  v_created_references integer := 0;
  v_created_links integer := 0;
  v_reused_links integer := 0;
  v_skipped_ambiguous integer := 0;
  v_skipped_invalid integer := 0;
  v_candidate_limit constant integer := 50;
  v_candidate_count integer;
begin
  if p_resume_id is null or p_account_id is null then
    raise exception 'resume reference sync needs a resume and account'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_resume
  from public.resumes r
  where r.id = p_resume_id and r.account_id = p_account_id;

  if not found then
    raise exception 'resume % is not in account %', p_resume_id, p_account_id
      using errcode = 'foreign_key_violation';
  end if;

  v_shidduchim_id := v_resume.shidduchim_id;
  if v_shidduchim_id is null then
    return jsonb_build_object(
      'resume_id', p_resume_id,
      'created_references', 0,
      'created_links', 0,
      'reused_links', 0,
      'skipped_ambiguous', 0,
      'skipped_invalid', 0
    );
  end if;

  if not exists (
    select 1
    from public.shidduchim s
    where s.id = v_shidduchim_id and s.account_id = p_account_id
  ) then
    raise exception 'shidduch % is not in account %', v_shidduchim_id, p_account_id
      using errcode = 'foreign_key_violation';
  end if;

  if jsonb_typeof(v_resume.sections -> 'references') = 'array' then
    v_references := v_resume.sections -> 'references';
  else
    v_references := '[]'::jsonb;
  end if;

  -- Bound JSON work before validating any candidate. Overflow is counted as
  -- invalid without expanding or inspecting the discarded tail.
  v_candidate_count := jsonb_array_length(v_references);
  v_skipped_invalid := greatest(v_candidate_count - v_candidate_limit, 0);

  for v_candidate in
    select candidate.value
    from jsonb_array_elements(v_references) with ordinality as candidate(value, ordinal)
    order by candidate.ordinal
    limit v_candidate_limit
  loop
    if jsonb_typeof(v_candidate) <> 'object' then
      v_skipped_invalid := v_skipped_invalid + 1;
      continue;
    end if;

    v_name_raw := nullif(btrim(v_candidate ->> 'name'), '');
    v_relationship := nullif(btrim(v_candidate ->> 'relationship'), '');
    v_phone_raw := nullif(btrim(v_candidate ->> 'phone'), '');

    -- The parser already enforces these limits, but the server reconciliation
    -- must stay safe when old rows or hand-authored JSON bypass that parser.
    if v_name_raw is null
       or length(v_name_raw) > 1000
       or length(coalesce(v_relationship, '')) > 1000
       or length(coalesce(v_phone_raw, '')) > 200 then
      v_skipped_invalid := v_skipped_invalid + 1;
      continue;
    end if;

    v_name_norm := public.normalize_identity_text(v_name_raw);
    v_phone_norm := public.normalize_phone(v_phone_raw);

    if v_phone_raw is not null and v_phone_norm is null then
      v_skipped_invalid := v_skipped_invalid + 1;
      continue;
    end if;

    -- A normalized one-character token is not a safe identity signal. A
    -- non-empty invalid/short phone was rejected above; only a genuinely
    -- blank phone is allowed to fall through to a name-only match.
    if v_name_norm is null or length(v_name_norm) < 2 then
      v_skipped_invalid := v_skipped_invalid + 1;
      continue;
    end if;

    v_candidate_key := v_name_norm || '|' || coalesce(v_phone_norm, '');
    if v_candidate_key = any(v_seen_keys) then
      continue;
    end if;
    v_seen_keys := array_append(v_seen_keys, v_candidate_key);

    v_reference_id := null;
    v_name_matches := null;
    v_phone_matches := null;
    v_combined_matches := null;

    select array_agg(r.id order by r.id)
      into v_name_matches
      from public."references" r
     where r.account_id = p_account_id
       and (r.name_norm_en = v_name_norm or r.name_norm_he = v_name_norm);

    if v_phone_norm is not null then
      select array_agg(r.id order by r.id)
        into v_phone_matches
        from public."references" r
       where r.account_id = p_account_id
         and r.phone_norm = v_phone_norm;

      select array_agg(r.id order by r.id)
        into v_combined_matches
        from public."references" r
       where r.account_id = p_account_id
         and r.phone_norm = v_phone_norm
         and (r.name_norm_en = v_name_norm or r.name_norm_he = v_name_norm);

      if coalesce(cardinality(v_combined_matches), 0) = 1 then
        v_reference_id := v_combined_matches[1];
      elsif coalesce(cardinality(v_combined_matches), 0) > 1 then
        v_skipped_ambiguous := v_skipped_ambiguous + 1;
        continue;
      elsif coalesce(cardinality(v_phone_matches), 0) = 1 then
        -- A unique phone is safe only when its stored name is blank or agrees
        -- with the supplied name. A conflicting phone/name pair is visibly
        -- unlinked rather than silently creating or choosing a person.
        if exists (
          select 1
          from public."references" r
          where r.id = v_phone_matches[1]
            and r.account_id = p_account_id
            and (
              (r.name_norm_en is null and r.name_norm_he is null)
              or r.name_norm_en = v_name_norm
              or r.name_norm_he = v_name_norm
            )
        ) then
          v_reference_id := v_phone_matches[1];
        else
          v_skipped_ambiguous := v_skipped_ambiguous + 1;
          continue;
        end if;
      elsif coalesce(cardinality(v_phone_matches), 0) > 1 then
        v_skipped_ambiguous := v_skipped_ambiguous + 1;
        continue;
      elsif coalesce(cardinality(v_name_matches), 0) > 0 then
        -- Name-only fallback is not safe when the candidate supplied a phone:
        -- it would turn a phone change or typo into an automatic merge.
        v_skipped_ambiguous := v_skipped_ambiguous + 1;
        continue;
      end if;
    else
      if coalesce(cardinality(v_name_matches), 0) = 1 then
        v_reference_id := v_name_matches[1];
      elsif coalesce(cardinality(v_name_matches), 0) > 1 then
        v_skipped_ambiguous := v_skipped_ambiguous + 1;
        continue;
      end if;
    end if;

    if v_reference_id is null then
      insert into public."references" (
        account_id, name_en, name_he, relationship, phone
      ) values (
        p_account_id,
        case when v_name_raw ~ '[א-ת]' then null else v_name_raw end,
        case when v_name_raw ~ '[א-ת]' then v_name_raw else null end,
        v_relationship,
        case when v_phone_norm is null then null else v_phone_raw end
      ) returning id into v_reference_id;
      v_created_references := v_created_references + 1;
    end if;

    -- Reuse an existing link exactly. In particular, do not repair its
    -- resume_id or relationship override: those are existing Diligence data.
    select rl.id into v_link_id
    from public.reference_links rl
    where rl.account_id = p_account_id
      and rl.reference_id = v_reference_id
      and rl.shidduchim_id = v_shidduchim_id
    limit 1;

    if v_link_id is not null then
      v_reused_links := v_reused_links + 1;
      continue;
    end if;

    insert into public.reference_links (
      account_id, reference_id, shidduchim_id, resume_id,
      call_status, relationship_override
    ) values (
      p_account_id, v_reference_id, v_shidduchim_id, p_resume_id,
      'not_started', v_relationship
    ) returning id into v_link_id;

    insert into public.interactions (
      account_id, target_type, target_id, scope, reference_link_id,
      kind, body, metadata
    ) values (
      p_account_id, 'reference', v_reference_id, 'shidduch', v_link_id,
      'link_created', null,
      jsonb_build_object(
        'shidduchim_id', v_shidduchim_id,
        'resume_id', p_resume_id,
        'source', 'resume_reference_sync'
      )
    );
    v_created_links := v_created_links + 1;
  end loop;

  return jsonb_build_object(
    'resume_id', p_resume_id,
    'created_references', v_created_references,
    'created_links', v_created_links,
    'reused_links', v_reused_links,
    'skipped_ambiguous', v_skipped_ambiguous,
    'skipped_invalid', v_skipped_invalid
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."sync_resume_references_for_account"("p_resume_id" bigint, "p_account_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_account_id is null then
    raise exception 'resume reference sync needs an account'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Every online caller serializes the whole account. This is intentionally
  -- the same lock key the trigger and migration use: identity creation can
  -- then never race across two suggestions, and the migration can release
  -- the session lock before moving to its next account.
  perform pg_advisory_xact_lock(
    hashtextextended(format('resume-reference-account:%s', p_account_id), 0)
  );

  return public.reconcile_resume_references_for_account(p_resume_id, p_account_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."sync_resume_references"("p_resume_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_resume_account_id bigint;
begin
  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no active account context for resume reference sync'
      using errcode = 'insufficient_privilege';
  end if;

  if public.current_member_role() = 'single' then
    raise exception 'a single cannot reconcile resume references'
      using errcode = 'insufficient_privilege';
  end if;

  select r.account_id into v_resume_account_id
  from public.resumes r
  where r.id = p_resume_id;

  if v_resume_account_id is distinct from v_account_id then
    raise exception 'resume % not found in current account', p_resume_id
      using errcode = 'insufficient_privilege';
  end if;

  return public.sync_resume_references_for_account(p_resume_id, v_account_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."sync_resume_references_after_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and new.sections is not distinct from old.sections then
    return new;
  end if;

  begin
    perform public.sync_resume_references_for_account(new.id, new.account_id);
  exception when others then
    -- A filing must never fail because reconciliation is unavailable. Keep
    -- the notice aggregate-safe: no resume id, name, phone, or note content.
    raise notice 'resume reference sync trigger skipped one resume, SQLSTATE %', sqlstate;
  end;

  return new;
end;
$$;

revoke all on function public.sync_resume_references(bigint) from public, anon;
grant execute on function public.sync_resume_references(bigint) to authenticated, service_role;
revoke all on function public.sync_resume_references_for_account(bigint, bigint) from public, anon, authenticated;
grant execute on function public.sync_resume_references_for_account(bigint, bigint) to service_role;
revoke all on function public.reconcile_resume_references_for_account(bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function public.sync_resume_references_after_change() from public, anon, authenticated, service_role;

create or replace trigger sync_resume_references_after_insert
    after insert on public.resumes
    for each row execute function public.sync_resume_references_after_change();

create or replace trigger sync_resume_references_after_sections_update
    after update of sections on public.resumes
    for each row
    when (old.sections is distinct from new.sections)
    execute function public.sync_resume_references_after_change();

do $$
declare
  v_account record;
  v_resume record;
  v_result jsonb;
  v_resume_count bigint;
  v_candidate_count bigint;
  v_created_references bigint := 0;
  v_created_links bigint := 0;
  v_reused_links bigint := 0;
  v_skipped_ambiguous bigint := 0;
  v_skipped_invalid bigint := 0;
  v_skipped_resumes bigint := 0;
  v_account_lock bigint;
  v_last_resume_id bigint;
  v_batch_count integer;
  v_batch_size constant integer := 250;
  v_started_at timestamptz := clock_timestamp();
begin
  -- Dry-run report: counts only, deliberately no names, phones, or note text.
  select count(*), coalesce(sum(
    case
      when jsonb_typeof(r.sections -> 'references') = 'array'
        then jsonb_array_length(r.sections -> 'references')
      else 0
    end
  ), 0)
  into v_resume_count, v_candidate_count
  from public.resumes r
  where r.shidduchim_id is not null;
  raise notice 'resume reference sync dry-run: resumes %, parsed candidates %',
    v_resume_count, v_candidate_count;

  for v_account in
    select distinct r.account_id
    from public.resumes r
    where r.shidduchim_id is not null
    order by r.account_id
  loop
    v_account_lock := hashtextextended(
      format('resume-reference-account:%s', v_account.account_id), 0
    );
    -- Session-level, not transaction-level: the migration visits many
    -- accounts in one transaction, so an xact lock per account would retain
    -- thousands of lock entries until commit. This lock is released in the
    -- account block before the next account begins.
    perform pg_advisory_lock(v_account_lock);
    begin
      v_last_resume_id := 0;
      loop
        v_batch_count := 0;
        for v_resume in
          select r.id
          from public.resumes r
          where r.account_id = v_account.account_id
            and r.shidduchim_id is not null
            and r.id > v_last_resume_id
          order by r.id
          limit v_batch_size
        loop
          v_batch_count := v_batch_count + 1;
          v_last_resume_id := v_resume.id;
          begin
            select public.reconcile_resume_references_for_account(
              v_resume.id, v_account.account_id
            ) into v_result;

            v_created_references := v_created_references
              + coalesce((v_result ->> 'created_references')::bigint, 0);
            v_created_links := v_created_links
              + coalesce((v_result ->> 'created_links')::bigint, 0);
            v_reused_links := v_reused_links
              + coalesce((v_result ->> 'reused_links')::bigint, 0);
            v_skipped_ambiguous := v_skipped_ambiguous
              + coalesce((v_result ->> 'skipped_ambiguous')::bigint, 0);
            v_skipped_invalid := v_skipped_invalid
              + coalesce((v_result ->> 'skipped_invalid')::bigint, 0);
          exception when others then
            -- Candidate data problems must not strand the rest of the account.
            -- Catalog, transaction, and internal errors fail closed so a broken
            -- migration cannot report a green partial backfill.
            if sqlstate like '42%'
               or sqlstate like '0A%'
               or sqlstate like '25%'
               or sqlstate like '53%'
               or sqlstate like '57%'
               or sqlstate like '58%'
               or sqlstate like 'XX%' then
              raise;
            end if;
            v_skipped_resumes := v_skipped_resumes + 1;
          end;
        end loop;
        exit when v_batch_count = 0;
      end loop;
    exception when others then
      perform pg_advisory_unlock(v_account_lock);
      raise;
    end;
    perform pg_advisory_unlock(v_account_lock);
  end loop;

  raise notice 'resume reference sync complete: accounts %, resumes read %, links created %, references created %, links reused %, ambiguous skipped %, invalid skipped %, resumes skipped %, elapsed_ms %',
    (select count(distinct r.account_id) from public.resumes r where r.shidduchim_id is not null),
    v_resume_count, v_created_links, v_created_references, v_reused_links,
    v_skipped_ambiguous, v_skipped_invalid, v_skipped_resumes,
    floor(extract(epoch from clock_timestamp() - v_started_at) * 1000)::bigint;
end;
$$;

