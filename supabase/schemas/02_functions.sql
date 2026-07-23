--
-- Functions
-- This file declares all PL/pgSQL functions in the public schema.
--

CREATE OR REPLACE FUNCTION "public"."cleanup_note_attachments"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    DECLARE
      payload jsonb;
      request_headers jsonb;
      auth_header text;
    BEGIN
      request_headers := coalesce(
        nullif(current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      );
      auth_header := request_headers ->> 'authorization';

      IF auth_header IS NULL OR auth_header = '' THEN
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;

        RETURN NEW;
      END IF;

      payload := jsonb_build_object(
        'old_record', OLD,
        'record', NEW,
        'type', TG_OP
      );

      PERFORM net.http_post(
        url := public.get_note_attachments_function_url(),
        body := payload,
        params := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type',
          'application/json',
          'Authorization',
          auth_header
        ),
        timeout_milliseconds := 10000
      );

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;

      RETURN NEW;
    END;
    $$;

CREATE OR REPLACE FUNCTION "public"."get_avatar_for_email"("email" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare email_hash text;
declare gravatar_url text;
declare gravatar_status int8;
declare email_domain text;
declare favicon_url text;
declare domain_status int8;

begin
    -- Try to fetch a gravatar image
    email_hash = encode(extensions.digest(email, 'sha256'), 'hex');
    gravatar_url = concat('https://www.gravatar.com/avatar/', email_hash, '?d=404');

    select status from extensions.http_get(gravatar_url) into gravatar_status;

    if gravatar_status = 200 then
        return gravatar_url;
    end if;

    -- Fallback to email's domain favicon if not excluded
    email_domain = split_part(email, '@', 2);
    return get_domain_favicon(email_domain);
exception
    when others then
        return 'ERROR';
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_domain_favicon"("domain_name" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare domain_status int8;

begin
    if exists (select from favicons_excluded_domains as fav where fav.domain = domain_name) then
        return null;
    end if;

    return concat(
        'https://favicon.show/',
        (regexp_matches(domain_name, '^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/?\n]+)', 'i'))[1]
    );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_note_attachments_function_url"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
    DECLARE
      issuer text;
      function_url text;
    BEGIN
      issuer := coalesce(
        nullif(current_setting('request.jwt.claim.iss', true), ''),
        (
          coalesce(
            nullif(current_setting('request.jwt.claims', true), ''),
            '{}'
          )::jsonb ->> 'iss'
        )
      );
      issuer := nullif(issuer, '');
      IF issuer IS NOT NULL THEN
        issuer := rtrim(issuer, '/');
        IF right(issuer, 8) = '/auth/v1' THEN
          function_url :=
            left(issuer, length(issuer) - 8) || '/functions/v1/delete_note_attachments';

          IF function_url LIKE 'http://127.0.0.1:%' THEN
            RETURN replace(
              function_url,
              'http://127.0.0.1:',
              'http://host.docker.internal:'
            );
          END IF;

          IF function_url LIKE 'http://localhost:%' THEN
            RETURN replace(
              function_url,
              'http://localhost:',
              'http://host.docker.internal:'
            );
          END IF;

          RETURN function_url;
        END IF;
      END IF;

      RETURN 'http://host.docker.internal:54321/functions/v1/delete_note_attachments';
    END;
    $$;

CREATE OR REPLACE FUNCTION "public"."get_user_id_by_email"("email" "text") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  RETURN QUERY SELECT au.id FROM auth.users au WHERE au.email = $1;
END;
$_$;

CREATE OR REPLACE FUNCTION "public"."handle_company_saved"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare company_logo text;

begin
    if new.logo is not null then
        return new;
    end if;

    company_logo = get_domain_favicon(new.website);
    if company_logo is null then
        return new;
    end if;

    new.logo = concat('{"src":"', company_logo, '","title":"Company favicon"}');
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_contact_note_created_or_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.contacts set last_seen = new.date where contacts.id = new.contact_id and contacts.last_seen < new.date;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_contact_saved"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$declare contact_avatar text;
declare emails_length int8;
declare item jsonb;

begin
    if new.avatar is not null then
        return new;
    end if;

    select coalesce(jsonb_array_length(new.email_jsonb), 0) into emails_length;

    if emails_length = 0 then
        return new;
    end if;

    for item in select jsonb_array_elements(new.email_jsonb)
    loop
        select public.get_avatar_for_email(item->>'email') into contact_avatar;
        if (contact_avatar is not null) then
            exit;
        end if;
    end loop;

    if contact_avatar is null then
        return new;
    end if;

    new.avatar = concat('{"src":"', contact_avatar, '"}');
    return new;
end;$$;

-- Provisions a new auth user: the legacy `sales` row, plus — since
-- current_account_id() now fails closed — the account_members row without which
-- the user would see nothing at all.
--
-- Membership model here is deliberately minimal and invite-free (AD-11's full
-- invite binding is Epic-1): the FIRST user bootstraps the tenant and becomes
-- its parent_admin. Every subsequent user gets NO membership, so they resolve to
-- a null account and see nothing until the invite flow grants them one. That is
-- the correct fail-closed default — a stranger signing up must not land inside
-- somebody else's family's diligence notes.
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  sales_count int;
  v_account_id bigint;
begin
  select count(id) into sales_count
  from public.sales;

  insert into public.sales (first_name, last_name, email, user_id, administrator)
  values (
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
      'Pending'),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', ''),
      case when position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')) > 0
           then substr(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')) + 1)
      end,
      'Pending'),
    new.email,
    new.id,
    case when sales_count > 0 then FALSE else TRUE end
  );

  if not exists (select 1 from public.account_members) then
    select a.id into v_account_id
    from public.accounts a
    order by a.id
    limit 1;

    if v_account_id is null then
      insert into public.accounts (name) values ('My Account')
      returning id into v_account_id;
    end if;

    insert into public.account_members (account_id, user_id, role, status)
    values (v_account_id, new.id, 'parent_admin', 'active');
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_update_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.sales
  set
    first_name = coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
      'Pending'),
    last_name = coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', ''),
      case when position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')) > 0
           then substr(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')) + 1)
      end,
      'Pending'),
    email = new.email
  where user_id = new.id;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return exists (
    select 1 from public.sales where user_id = auth.uid() and administrator = true
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."merge_contacts"("loser_id" bigint, "winner_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  winner_contact contacts%ROWTYPE;
  loser_contact contacts%ROWTYPE;
  deal_record RECORD;
  merged_emails jsonb;
  merged_phones jsonb;
  merged_tags bigint[];
  winner_emails jsonb;
  loser_emails jsonb;
  winner_phones jsonb;
  loser_phones jsonb;
  email_map jsonb;
  phone_map jsonb;
BEGIN
  -- Fetch both contacts
  SELECT * INTO winner_contact FROM contacts WHERE id = winner_id;
  SELECT * INTO loser_contact FROM contacts WHERE id = loser_id;

  IF winner_contact IS NULL OR loser_contact IS NULL THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  -- 1. Reassign tasks from loser to winner
  UPDATE tasks SET contact_id = winner_id WHERE contact_id = loser_id;

  -- 2. Reassign contact notes from loser to winner
  UPDATE contact_notes SET contact_id = winner_id WHERE contact_id = loser_id;

  -- 3. Update deals - replace loser with winner in contact_ids array
  FOR deal_record IN
    SELECT id, contact_ids
    FROM deals
    WHERE contact_ids @> ARRAY[loser_id]
  LOOP
    UPDATE deals
    SET contact_ids = (
      SELECT ARRAY(
        SELECT DISTINCT unnest(
          array_remove(deal_record.contact_ids, loser_id) || ARRAY[winner_id]
        )
      )
    )
    WHERE id = deal_record.id;
  END LOOP;

  -- 4. Merge contact data

  -- Get email arrays
  winner_emails := COALESCE(winner_contact.email_jsonb, '[]'::jsonb);
  loser_emails := COALESCE(loser_contact.email_jsonb, '[]'::jsonb);

  -- Merge emails with deduplication by email address
  -- Build a map of email -> email object, then convert back to array
  email_map := '{}'::jsonb;

  -- Add winner emails to map
  IF jsonb_array_length(winner_emails) > 0 THEN
    FOR i IN 0..jsonb_array_length(winner_emails)-1 LOOP
      email_map := email_map || jsonb_build_object(
        winner_emails->i->>'email',
        winner_emails->i
      );
    END LOOP;
  END IF;

  -- Add loser emails to map (won't overwrite existing keys)
  IF jsonb_array_length(loser_emails) > 0 THEN
    FOR i IN 0..jsonb_array_length(loser_emails)-1 LOOP
      IF NOT email_map ? (loser_emails->i->>'email') THEN
        email_map := email_map || jsonb_build_object(
          loser_emails->i->>'email',
          loser_emails->i
        );
      END IF;
    END LOOP;
  END IF;

  -- Convert map back to array
  merged_emails := (SELECT jsonb_agg(value) FROM jsonb_each(email_map));
  merged_emails := COALESCE(merged_emails, '[]'::jsonb);

  -- Get phone arrays
  winner_phones := COALESCE(winner_contact.phone_jsonb, '[]'::jsonb);
  loser_phones := COALESCE(loser_contact.phone_jsonb, '[]'::jsonb);

  -- Merge phones with deduplication by number
  phone_map := '{}'::jsonb;

  -- Add winner phones to map
  IF jsonb_array_length(winner_phones) > 0 THEN
    FOR i IN 0..jsonb_array_length(winner_phones)-1 LOOP
      phone_map := phone_map || jsonb_build_object(
        winner_phones->i->>'number',
        winner_phones->i
      );
    END LOOP;
  END IF;

  -- Add loser phones to map (won't overwrite existing keys)
  IF jsonb_array_length(loser_phones) > 0 THEN
    FOR i IN 0..jsonb_array_length(loser_phones)-1 LOOP
      IF NOT phone_map ? (loser_phones->i->>'number') THEN
        phone_map := phone_map || jsonb_build_object(
          loser_phones->i->>'number',
          loser_phones->i
        );
      END IF;
    END LOOP;
  END IF;

  -- Convert map back to array
  merged_phones := (SELECT jsonb_agg(value) FROM jsonb_each(phone_map));
  merged_phones := COALESCE(merged_phones, '[]'::jsonb);

  -- Merge tags (remove duplicates)
  merged_tags := ARRAY(
    SELECT DISTINCT unnest(
      COALESCE(winner_contact.tags, ARRAY[]::bigint[]) ||
      COALESCE(loser_contact.tags, ARRAY[]::bigint[])
    )
  );

  -- 5. Update winner with merged data
  UPDATE contacts SET
    avatar = COALESCE(winner_contact.avatar, loser_contact.avatar),
    gender = COALESCE(winner_contact.gender, loser_contact.gender),
    first_name = COALESCE(winner_contact.first_name, loser_contact.first_name),
    last_name = COALESCE(winner_contact.last_name, loser_contact.last_name),
    title = COALESCE(winner_contact.title, loser_contact.title),
    company_id = COALESCE(winner_contact.company_id, loser_contact.company_id),
    email_jsonb = merged_emails,
    phone_jsonb = merged_phones,
    linkedin_url = COALESCE(winner_contact.linkedin_url, loser_contact.linkedin_url),
    background = COALESCE(winner_contact.background, loser_contact.background),
    has_newsletter = COALESCE(winner_contact.has_newsletter, loser_contact.has_newsletter),
    first_seen = LEAST(COALESCE(winner_contact.first_seen, loser_contact.first_seen), COALESCE(loser_contact.first_seen, winner_contact.first_seen)),
    last_seen = GREATEST(COALESCE(winner_contact.last_seen, loser_contact.last_seen), COALESCE(loser_contact.last_seen, winner_contact.last_seen)),
    sales_id = COALESCE(winner_contact.sales_id, loser_contact.sales_id),
    tags = merged_tags
  WHERE id = winner_id;

  -- 6. Delete loser contact
  DELETE FROM contacts WHERE id = loser_id;

  RETURN winner_id;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."lowercase_email_jsonb"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.email_jsonb IS NOT NULL THEN
    NEW.email_jsonb = COALESCE((
      SELECT jsonb_agg(
        jsonb_set(elem, '{email}', to_jsonb(LOWER(elem->>'email')))
      )
      FROM jsonb_array_elements(NEW.email_jsonb) AS elem
    ), '[]'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."set_sales_id_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.sales_id IS NULL THEN
    SELECT id INTO NEW.sales_id FROM sales WHERE user_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- =====================================================================
-- MyShadchan — Shidduchim pipeline functions (AD-2, AD-3, AD-4)
-- =====================================================================

-- Resolves the caller's account (AD-1) from their active account_members row.
--
-- FAILS CLOSED. An earlier version fell back to the first account when the
-- caller had no membership, which meant any authenticated user with no
-- membership silently became a member of account #1 — and since nothing ever
-- created membership rows, that was every user. Returning NULL is what makes
-- the tenant boundary real: every policy reads
-- `account_id = public.current_account_id()`, which is NULL-false, so a caller
-- with no membership sees and writes nothing.
--
-- The other half of this lives in handle_new_user(), which must actually grant
-- a membership or nobody can use the app at all.
--
-- SECURITY DEFINER so it can be called from RLS policies without recursing into
-- the very policies it feeds.
CREATE OR REPLACE FUNCTION "public"."current_account_id"() RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
begin
  select am.account_id into v_account_id
  from public.account_members am
  where am.user_id = auth.uid()
    and am.status = 'active'
  order by am.id
  limit 1;

  return v_account_id;
end;
$$;

-- Auto-populate account_id from the caller's account on insert (AD-1), so the
-- normal dataProvider.create() path for children/shadchanim/references/etc.
-- never has to trust a client-sent account_id. Mirrors set_sales_id_default.
CREATE OR REPLACE FUNCTION "public"."set_account_id_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.account_id is null then
    new.account_id := public.current_account_id();
  end if;
  return new;
end;
$$;

-- The ONE authority for which pipeline states a child may see (AD-3, D5).
-- Closed enumeration over ALL 7 states: visible = look_into/yes/unsure;
-- hidden = new/not_sure/for_sure_not/no. No include/exclude gap — an
-- unclassified value raises rather than silently leaking. Both RLS and the
-- (deferred, Epic-9) portal view will call this, never re-implement it.
CREATE OR REPLACE FUNCTION "public"."is_child_visible_state"("s" public.pipeline_state) RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
begin
  case s
    when 'look_into' then return true;
    when 'yes' then return true;
    when 'unsure' then return true;
    when 'new' then return false;
    when 'not_sure' then return false;
    when 'for_sure_not' then return false;
    when 'no' then return false;
    else
      raise exception 'unclassified pipeline_state in child-visibility policy: %', s;
  end case;
end;
$$;

-- Defense-in-depth for AD-4 invariant 2: any UPDATE that changes
-- pipeline_state must follow a legal edge in pipeline_transitions, so a raw
-- dataProvider.update() cannot bypass the transition graph. INSERTs set the
-- initial state freely (validated inside create_shidduch).
CREATE OR REPLACE FUNCTION "public"."enforce_pipeline_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.pipeline_state is distinct from old.pipeline_state then
    if not exists (
      select 1 from public.pipeline_transitions t
      where t.from_state = old.pipeline_state
        and t.to_state = new.pipeline_state
    ) then
      raise exception 'illegal pipeline transition: % -> %', old.pipeline_state, new.pipeline_state
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Defense-in-depth for AD-4 invariant 1: even a raw INSERT (bypassing
-- create_shidduch) cannot land a shidduch straight into a decision state.
-- A decision (yes/unsure/no) is reachable ONLY from look_into via
-- transition_shidduch. Mirrors the initial-state guard inside create_shidduch.
CREATE OR REPLACE FUNCTION "public"."enforce_shidduch_initial_state"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.pipeline_state not in ('new', 'look_into', 'not_sure', 'for_sure_not') then
    raise exception 'a shidduch cannot be created in decision state % (reachable only from look_into)', new.pipeline_state
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- The SOLE INSERT path into shidduchim (AD-4 invariant 1). Written as a
-- low-level reusable primitive: a future fileInboxItem() (Epic-6) must call
-- this rather than duplicate the INSERT. Sets account_id, provenance,
-- visibility, owner_member_id and the initial state. Decision states
-- (yes/unsure/no) can NEVER be created directly — they are reachable only
-- from look_into via transition_shidduch. SECURITY INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."create_shidduch"(
    "p_child_id" bigint,
    "p_shadchan_id" bigint DEFAULT NULL,
    "p_name_en" text DEFAULT NULL,
    "p_name_he" text DEFAULT NULL,
    "p_parents_en" text DEFAULT NULL,
    "p_parents_he" text DEFAULT NULL,
    "p_seminary_en" text DEFAULT NULL,
    "p_seminary_he" text DEFAULT NULL,
    "p_shul_en" text DEFAULT NULL,
    "p_shul_he" text DEFAULT NULL,
    "p_location_en" text DEFAULT NULL,
    "p_location_he" text DEFAULT NULL,
    "p_age" integer DEFAULT NULL,
    "p_height" text DEFAULT NULL,
    "p_origin" text DEFAULT 'manual',
    "p_initial_state" public.pipeline_state DEFAULT 'new',
    "p_visibility" text DEFAULT 'shared',
    "p_redt_date" date DEFAULT NULL
) RETURNS SETOF public.shidduchim
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_owner_member_id bigint;
  v_id bigint;
  v_redt_date date;
  v_gender text;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'no account context for create_shidduch (no account exists)';
  end if;

  if p_initial_state not in ('new', 'look_into', 'not_sure', 'for_sure_not') then
    raise exception 'invalid initial pipeline_state: % (decision states are reachable only from look_into)', p_initial_state
      using errcode = 'check_violation';
  end if;

  -- Never cross the account boundary (AD-1): the child/shadchan must
  -- belong to the caller's account.
  if not exists (
    select 1 from public.children c
    where c.id = p_child_id and c.account_id = v_account_id
  ) then
    raise exception 'child % not found in current account', p_child_id;
  end if;

  if p_shadchan_id is not null and not exists (
    select 1 from public.shadchanim s
    where s.id = p_shadchan_id and s.account_id = v_account_id
  ) then
    raise exception 'shadchan % not found in current account', p_shadchan_id;
  end if;

  select am.id into v_owner_member_id
  from public.account_members am
  where am.user_id = auth.uid() and am.account_id = v_account_id
  order by am.id
  limit 1;

  v_redt_date := coalesce(p_redt_date, current_date);

  insert into public.shidduchim (
    account_id, child_id, shadchan_id,
    name_en, name_he,
    parents_en, parents_he, seminary_en, seminary_he,
    shul_en, shul_he, location_en, location_he,
    age, height,
    pipeline_state, first_suggested_by, first_suggested_at, redt_date,
    origin, owner_member_id, visibility
  ) values (
    v_account_id, p_child_id, p_shadchan_id,
    p_name_en, p_name_he,
    p_parents_en, p_parents_he, p_seminary_en, p_seminary_he,
    p_shul_en, p_shul_he, p_location_en, p_location_he,
    p_age, p_height,
    p_initial_state, p_shadchan_id, v_redt_date, v_redt_date,
    p_origin, v_owner_member_id, p_visibility
  )
  returning id into v_id;

  -- The first redt event. The refresh trigger keeps shidduchim.redt_date etc.
  -- in sync as more redts are added.
  insert into public.redts (account_id, shidduchim_id, shadchan_id, redt_date)
  values (v_account_id, v_id, p_shadchan_id, v_redt_date);

  -- Record the headline seminary/yeshiva as the first school entry. The prospect
  -- is the opposite gender of the child (a match for a girl is a boy -> yeshiva;
  -- a match for a boy is a girl -> seminary). Additional schools via add_school().
  if p_seminary_en is not null or p_seminary_he is not null then
    select gender into v_gender from public.children where id = p_child_id;
    insert into public.shidduch_schools (account_id, shidduchim_id, kind, name_en, name_he)
    values (
      v_account_id, v_id,
      case when v_gender = 'male' then 'seminary' else 'yeshiva' end,
      p_seminary_en, p_seminary_he
    );
  end if;

  return query select * from public.shidduchim where id = v_id;
end;
$$;

-- The SOLE writer of pipeline_state (AD-4 invariant 2). Enforces the
-- transitions-as-data graph (pipeline_transitions) with optimistic
-- concurrency on `p_from`. close_reason is set on entry to a terminal state
-- and cleared otherwise. SECURITY INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."transition_shidduch"(
    "p_id" bigint,
    "p_from" public.pipeline_state,
    "p_to" public.pipeline_state,
    "p_close_reason" text DEFAULT NULL
) RETURNS SETOF public.shidduchim
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_current public.pipeline_state;
begin
  select pipeline_state into v_current
  from public.shidduchim
  where id = p_id
  for update;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  if v_current is distinct from p_from then
    raise exception 'stale transition: shidduch % is in state %, not %', p_id, v_current, p_from
      using errcode = 'serialization_failure';
  end if;

  if p_from is not distinct from p_to then
    return query select * from public.shidduchim where id = p_id;
    return;
  end if;

  if not exists (
    select 1 from public.pipeline_transitions t
    where t.from_state = p_from and t.to_state = p_to
  ) then
    raise exception 'illegal pipeline transition: % -> %', p_from, p_to
      using errcode = 'check_violation';
  end if;

  return query
  update public.shidduchim
  set pipeline_state = p_to,
      close_reason = case
        when p_to in ('for_sure_not', 'yes', 'unsure', 'no') then coalesce(p_close_reason, close_reason)
        else null
      end
  where id = p_id
  returning *;
end;
$$;

-- Keeps the denormalized redt summary on shidduchim in sync with the redts
-- history: redt_date = the LAST (most recent) redt, shadchan_id = that latest
-- redt's shadchan (the card "via"), first_suggested_by/at = the earliest redt.
-- Fires on any redts insert/update/delete. RLS on shidduchim confines the
-- UPDATE to the caller's own account, so a redt cannot mutate a foreign shidduch.
CREATE OR REPLACE FUNCTION "public"."refresh_shidduch_redt_summary"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_shidduch_id bigint;
  v_last_shadchan bigint;
  v_last_date date;
  v_first_shadchan bigint;
  v_first_date date;
begin
  v_shidduch_id := coalesce(new.shidduchim_id, old.shidduchim_id);

  select r.shadchan_id, r.redt_date into v_last_shadchan, v_last_date
  from public.redts r
  where r.shidduchim_id = v_shidduch_id
  order by r.redt_date desc, r.id desc
  limit 1;

  if not found then
    -- No redts remain (e.g. the last one was deleted); leave the summary as-is.
    return null;
  end if;

  select r.shadchan_id, r.redt_date into v_first_shadchan, v_first_date
  from public.redts r
  where r.shidduchim_id = v_shidduch_id
  order by r.redt_date asc, r.id asc
  limit 1;

  update public.shidduchim s
  set redt_date = v_last_date,
      shadchan_id = v_last_shadchan,
      first_suggested_by = v_first_shadchan,
      first_suggested_at = v_first_date
  where s.id = v_shidduch_id;

  return null;
end;
$$;

-- Append a redt to a shidduch (the same or a different shadchan can redt it
-- again, on a new date). Account-scoped so a redt can never be added to a
-- foreign account's shidduch. Returns the refreshed shidduch row. SECURITY
-- INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."add_redt"(
    "p_shidduchim_id" bigint,
    "p_shadchan_id" bigint DEFAULT NULL,
    "p_redt_date" date DEFAULT NULL,
    "p_note" text DEFAULT NULL
) RETURNS SETOF public.shidduchim
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
begin
  v_account_id := public.current_account_id();

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  if p_shadchan_id is not null and not exists (
    select 1 from public.shadchanim s
    where s.id = p_shadchan_id and s.account_id = v_account_id
  ) then
    raise exception 'shadchan % not found in current account', p_shadchan_id;
  end if;

  insert into public.redts (account_id, shidduchim_id, shadchan_id, redt_date, note)
  values (v_account_id, p_shidduchim_id, p_shadchan_id, coalesce(p_redt_date, current_date), p_note);

  return query select * from public.shidduchim where id = p_shidduchim_id;
end;
$$;

-- Link a school/seminary/yeshiva (with optional years) to a shidduch. A single
-- can have several. Account-scoped so it can't attach to a foreign shidduch.
-- SECURITY INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."add_school"(
    "p_shidduchim_id" bigint,
    "p_kind" text DEFAULT 'seminary',
    "p_name_en" text DEFAULT NULL,
    "p_name_he" text DEFAULT NULL,
    "p_start_year" integer DEFAULT NULL,
    "p_end_year" integer DEFAULT NULL
) RETURNS SETOF public.shidduch_schools
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
begin
  v_account_id := public.current_account_id();

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  if coalesce(p_kind, 'seminary') not in ('seminary', 'yeshiva', 'school', 'college', 'other') then
    raise exception 'invalid school kind: %', p_kind using errcode = 'check_violation';
  end if;

  return query
  insert into public.shidduch_schools (
    account_id, shidduchim_id, kind, name_en, name_he, start_year, end_year
  ) values (
    v_account_id, p_shidduchim_id, coalesce(p_kind, 'seminary'),
    p_name_en, p_name_he, p_start_year, p_end_year
  )
  returning *;
end;
$$;

-- =====================================================================
-- MyShadchan — Identity matching + References (AD-5, AD-12, AD-13)
-- =====================================================================
-- AD-5: there is exactly ONE account-scoped identity service. Reference
-- dedupe (FR20/FR42), shidduch-suggestion dedupe and date-record dedupe all
-- call match_identity() against identity_signals; nobody writes a bespoke
-- matcher. AD-12: normalization is bilingual and happens ONLY here, in the
-- database — the SPA never normalizes.

-- Canonical text normalizer: strips Hebrew nikud (U+0591-U+05C7), folds Latin
-- diacritics, lowercases, drops punctuation and collapses whitespace. Keeps
-- Hebrew letters (U+05D0-U+05EA) intact. IMMUTABLE so it is safe in indexes
-- and generated values, and so the same input always produces the same key.
CREATE OR REPLACE FUNCTION "public"."normalize_identity_text"("p_input" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          translate(
            lower(regexp_replace(coalesce(p_input, ''), '[֑-ׇ]', '', 'g')),
            'áàâäãåéèêëíìîïóòôöõúùûüñçýÿœæ',
            'aaaaaaeeeeiiiiooooouuuuncyyoa'
          ),
          '[^a-z0-9א-ת ]', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

-- Canonical phone normalizer: digits only, international/trunk prefixes
-- stripped (IL +972, NANP +1, UK +44), so 054-123-4567, +972-54-123-4567 and
-- 0541234567 all compare equal. Returns null for anything too short to be a
-- trustworthy match signal — a half-typed phone must never produce a match.
CREATE OR REPLACE FUNCTION "public"."normalize_phone"("p_input" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_input, ''), '[^0-9]', '', 'g');
  if v_digits = '' then
    return null;
  end if;

  if left(v_digits, 2) = '00' then
    v_digits := substr(v_digits, 3);
  end if;

  if left(v_digits, 3) = '972' then
    v_digits := substr(v_digits, 4);
  elsif length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := substr(v_digits, 2);
  elsif left(v_digits, 2) = '44' and length(v_digits) > 10 then
    v_digits := substr(v_digits, 3);
  end if;

  v_digits := regexp_replace(v_digits, '^0+', '');

  if length(v_digits) < 7 then
    return null;
  end if;

  return v_digits;
end;
$$;

-- Variant-folding name key (NFR-6). Two people spelled "Yitzchak" and "Itzhak",
-- or "Chaim" and "Haim", are the same person; literal string equality would miss
-- them. This produces a comparison skeleton by (1) canonicalizing well-known
-- Hebrew/English given-name variants and nicknames, (2) folding transliteration
-- digraphs (tz/ts -> z, ch/kh -> h, ph -> f, c/q -> k, w -> v), (3) unifying
-- Hebrew final letter forms, and (4) dropping non-initial vowels and doubled
-- letters. The nickname list is deliberately data-shaped and extensible — it
-- covers the common cases, not every case, which is exactly why match_identity()
-- never treats a name key match alone as sufficient evidence.
CREATE OR REPLACE FUNCTION "public"."identity_name_key"("p_input" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  v_norm text;
  v_token text;
  v_out text[] := array[]::text[];
begin
  v_norm := public.normalize_identity_text(p_input);
  if v_norm is null then
    return null;
  end if;

  -- Hebrew final forms fold to their medial forms.
  v_norm := translate(v_norm, 'ךםןףץ', 'כמנפצ');

  foreach v_token in array string_to_array(v_norm, ' ') loop
    if v_token = '' then
      continue;
    end if;

    -- Honorifics are dropped from the KEY only. "Rabbi Chaim Cohen" and
    -- "Haim Cohen" are the same person, but their exact normalized names still
    -- differ — which is right, because the key is the fuzzy signal and
    -- name_*_norm stays the strict one.
    if v_token in (
      'rabbi', 'rav', 'harav', 'reb', 'rebbetzin', 'rebbitzen', 'rebetzin',
      'rabanit', 'harabanit', 'morah', 'mr', 'mrs', 'ms', 'miss', 'dr', 'prof',
      'הרב', 'רב', 'רבי', 'מרת', 'הרבנית'
    ) then
      continue;
    end if;

    v_token := case v_token
      when 'moishe' then 'moshe' when 'moses' then 'moshe' when 'moshy' then 'moshe'
      when 'yakov' then 'yaakov' when 'yankel' then 'yaakov' when 'jacob' then 'yaakov'
      when 'kobi' then 'yaakov'
      when 'haim' then 'chaim' when 'hyman' then 'chaim'
      when 'yitzchok' then 'yitzchak' when 'itzhak' then 'yitzchak' when 'itzik' then 'yitzchak'
      when 'isaac' then 'yitzchak' when 'yitz' then 'yitzchak'
      when 'abraham' then 'avraham' when 'avrohom' then 'avraham' when 'avi' then 'avraham'
      when 'abe' then 'avraham'
      when 'yossi' then 'yosef' when 'joseph' then 'yosef' when 'yoseph' then 'yosef'
      when 'shloime' then 'shlomo' when 'solomon' then 'shlomo' when 'shloimy' then 'shlomo'
      when 'dovid' then 'david' when 'dovi' then 'david' when 'duvid' then 'david'
      when 'shmuly' then 'shmuel' when 'samuel' then 'shmuel'
      when 'mendy' then 'menachem' when 'mendel' then 'menachem'
      when 'motty' then 'mordechai' when 'mordche' then 'mordechai' when 'motti' then 'mordechai'
      when 'benjamin' then 'binyamin' when 'binyomin' then 'binyamin' when 'benny' then 'binyamin'
      when 'ephraim' then 'efraim' when 'efrayim' then 'efraim'
      when 'zvi' then 'tzvi' when 'hershel' then 'tzvi' when 'hirsch' then 'tzvi'
      when 'rivky' then 'rivka' when 'rebecca' then 'rivka' when 'rifka' then 'rivka'
      when 'sara' then 'sarah' when 'suri' then 'sarah' when 'sori' then 'sarah'
      when 'estee' then 'esther' when 'esti' then 'esther' when 'ester' then 'esther'
      when 'hana' then 'chana' when 'hannah' then 'chana' when 'chani' then 'chana'
      when 'lea' then 'leah' when 'leiah' then 'leah'
      when 'miri' then 'miriam' when 'mimi' then 'miriam'
      when 'rochel' then 'rachel' when 'ruchi' then 'rachel' when 'ruchy' then 'rachel'
      when 'debbie' then 'devorah' when 'dvora' then 'devorah' when 'devora' then 'devorah'
      when 'malky' then 'malka' when 'malkie' then 'malka'
      when 'shaindy' then 'shaindel' when 'shaindi' then 'shaindel'
      else v_token
    end;

    -- Transliteration digraph folding (order matters: digraphs before letters).
    v_token := replace(v_token, 'tz', 'z');
    v_token := replace(v_token, 'ts', 'z');
    v_token := replace(v_token, 'ch', 'h');
    v_token := replace(v_token, 'kh', 'h');
    v_token := replace(v_token, 'ph', 'f');
    v_token := replace(v_token, 'ck', 'k');
    v_token := replace(v_token, 'q', 'k');
    v_token := replace(v_token, 'c', 'k');
    v_token := replace(v_token, 'w', 'v');
    v_token := replace(v_token, 'x', 'ks');

    -- Drop non-initial vowels, then collapse repeated letters.
    v_token := left(v_token, 1) || regexp_replace(substr(v_token, 2), '[aeiouy]', '', 'g');
    v_token := regexp_replace(v_token, '(.)\1+', '\1', 'g');

    if v_token <> '' then
      v_out := v_out || v_token;
    end if;
  end loop;

  if array_length(v_out, 1) is null then
    return null;
  end if;

  return array_to_string(v_out, ' ');
end;
$$;

-- Server-set match keys on references (AD-5: the SPA never normalizes).
CREATE OR REPLACE FUNCTION "public"."set_reference_norms"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.name_norm_en := public.normalize_identity_text(new.name_en);
  new.name_norm_he := public.normalize_identity_text(new.name_he);
  new.phone_norm := public.normalize_phone(new.phone);
  return new;
end;
$$;

-- Keeps identity_signals in step with references. A reference's school is its
-- corroborating institution signal, so it lands in the shared seminary_norm
-- slot rather than a reference-only column — that is what lets ONE matcher
-- serve references, shidduchim and date records.
-- SECURITY DEFINER: identity_signals is read-only to clients (05_policies.sql)
-- so nobody can poison the matcher by writing their own match keys. The row's
-- own account_id is what is written, so tenant isolation is preserved.
CREATE OR REPLACE FUNCTION "public"."sync_reference_identity_signals"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.identity_signals (
    account_id, target_type, target_id,
    name_en_norm, name_he_norm, name_en_key, name_he_key,
    phone_norm, seminary_norm
  ) values (
    new.account_id, 'reference', new.id,
    public.normalize_identity_text(new.name_en),
    public.normalize_identity_text(new.name_he),
    public.identity_name_key(new.name_en),
    public.identity_name_key(new.name_he),
    public.normalize_phone(new.phone),
    public.normalize_identity_text(new.school)
  )
  on conflict (account_id, target_type, target_id) do update
  set name_en_norm = excluded.name_en_norm,
      name_he_norm = excluded.name_he_norm,
      name_en_key = excluded.name_en_key,
      name_he_key = excluded.name_he_key,
      phone_norm = excluded.phone_norm,
      seminary_norm = excluded.seminary_norm;

  return null;
end;
$$;

-- The second caller of the shared identity service: shidduchim carry the full
-- signal set (name + parents + seminary + shul + location). Age/height are
-- deliberately absent — they are informational, never matching signals (FR11).
CREATE OR REPLACE FUNCTION "public"."sync_shidduch_identity_signals"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.identity_signals (
    account_id, target_type, target_id,
    name_en_norm, name_he_norm, name_en_key, name_he_key,
    parents_norm, seminary_norm, shul_norm, location_norm
  ) values (
    new.account_id, 'shidduch', new.id,
    public.normalize_identity_text(new.name_en),
    public.normalize_identity_text(new.name_he),
    public.identity_name_key(new.name_en),
    public.identity_name_key(new.name_he),
    public.normalize_identity_text(coalesce(new.parents_en, new.parents_he)),
    public.normalize_identity_text(coalesce(new.seminary_en, new.seminary_he)),
    public.normalize_identity_text(coalesce(new.shul_en, new.shul_he)),
    public.normalize_identity_text(coalesce(new.location_en, new.location_he))
  )
  on conflict (account_id, target_type, target_id) do update
  set name_en_norm = excluded.name_en_norm,
      name_he_norm = excluded.name_he_norm,
      name_en_key = excluded.name_en_key,
      name_he_key = excluded.name_he_key,
      parents_norm = excluded.parents_norm,
      seminary_norm = excluded.seminary_norm,
      shul_norm = excluded.shul_norm,
      location_norm = excluded.location_norm;

  return null;
end;
$$;

-- interactions/tasks/identity_signals are polymorphic, so no FK cascades them.
-- This trigger IS the cascade: deleting the target removes everything pointing
-- at it, leaving no orphaned candid content and no stale match signal. The
-- target_type is passed as a trigger argument so one function serves every
-- polymorphic parent. SECURITY DEFINER because identity_signals is not
-- client-writable (see 05_policies.sql) — it still filters on the row's own
-- account_id, so it can never reach across a tenant boundary.
CREATE OR REPLACE FUNCTION "public"."purge_polymorphic_dependents"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_target_type text := TG_ARGV[0];
begin
  delete from public.identity_signals
  where account_id = old.account_id and target_type = v_target_type and target_id = old.id;

  delete from public.interactions
  where account_id = old.account_id and target_type = v_target_type and target_id = old.id;

  delete from public.tasks
  where account_id = old.account_id and target_type = v_target_type and target_id = old.id;

  return old;
end;
$$;

-- Keeps the polymorphic task target and the legacy contact_id in lockstep, so
-- the existing contacts UI (which filters on contact_id) keeps working while
-- new callers use target_type/target_id only.
CREATE OR REPLACE FUNCTION "public"."sync_task_target"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(new.target_type, 'contact') = 'contact' then
    new.target_type := 'contact';
    new.target_id := coalesce(new.target_id, new.contact_id);
    new.contact_id := coalesce(new.contact_id, new.target_id);
  else
    new.contact_id := null;
  end if;

  if new.target_id is null then
    raise exception 'a task needs a target: set contact_id, or target_type + target_id'
      using errcode = 'not_null_violation';
  end if;

  return new;
end;
$$;

-- THE account-scoped identity matcher (AD-5). Returns candidates with a
-- confidence and the deciding facts that produced it — never a bare boolean,
-- and never a decision: the caller's user always confirms or dismisses.
--
-- HARD RULE (AD-5, FR20): a name match is NEVER sufficient on its own. A
-- candidate is returned only when the evidence includes a normalized phone
-- match, or a name match corroborated by at least one non-name signal
-- (parents / seminary-school / shul / location). Name-only similarity returns
-- nothing, because acting on it is exactly the false-merge this design forbids.
--
-- PRV-2: every read is filtered by current_account_id(). Identity is never
-- pooled or matched across accounts, no matter how identical the details look.
CREATE OR REPLACE FUNCTION "public"."match_identity"(
    "p_target_type" "text",
    "p_name_en" "text" DEFAULT NULL,
    "p_name_he" "text" DEFAULT NULL,
    "p_phone" "text" DEFAULT NULL,
    "p_parents" "text" DEFAULT NULL,
    "p_seminary" "text" DEFAULT NULL,
    "p_shul" "text" DEFAULT NULL,
    "p_location" "text" DEFAULT NULL,
    "p_exclude_target_id" bigint DEFAULT NULL
) RETURNS TABLE("target_id" bigint, "confidence" numeric, "deciding_facts" "jsonb")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_name_en_norm text;
  v_name_he_norm text;
  v_name_en_key text;
  v_name_he_key text;
  v_phone_norm text;
  v_parents_norm text;
  v_seminary_norm text;
  v_shul_norm text;
  v_location_norm text;
begin
  if p_target_type not in ('reference', 'shidduch', 'date_record') then
    raise exception 'unknown identity target_type: %', p_target_type
      using errcode = 'check_violation';
  end if;

  v_account_id := public.current_account_id();
  if v_account_id is null then
    return;
  end if;

  v_name_en_norm := public.normalize_identity_text(p_name_en);
  v_name_he_norm := public.normalize_identity_text(p_name_he);
  v_name_en_key := public.identity_name_key(p_name_en);
  v_name_he_key := public.identity_name_key(p_name_he);
  v_phone_norm := public.normalize_phone(p_phone);
  v_parents_norm := public.normalize_identity_text(p_parents);
  v_seminary_norm := public.normalize_identity_text(p_seminary);
  v_shul_norm := public.normalize_identity_text(p_shul);
  v_location_norm := public.normalize_identity_text(p_location);

  -- Nothing identifying was supplied: no candidates, no guessing.
  if v_phone_norm is null and v_name_en_norm is null and v_name_he_norm is null then
    return;
  end if;

  return query
  with scored as (
    select
      s.target_id as sig_target_id,
      (v_phone_norm is not null and s.phone_norm = v_phone_norm) as phone_hit,
      (
        (v_name_en_norm is not null and s.name_en_norm = v_name_en_norm)
        or (v_name_he_norm is not null and s.name_he_norm = v_name_he_norm)
      ) as name_exact,
      (
        (v_name_en_key is not null and s.name_en_key = v_name_en_key)
        or (v_name_he_key is not null and s.name_he_key = v_name_he_key)
      ) as name_variant,
      (v_parents_norm is not null and s.parents_norm = v_parents_norm) as parents_hit,
      (v_seminary_norm is not null and s.seminary_norm = v_seminary_norm) as seminary_hit,
      (v_shul_norm is not null and s.shul_norm = v_shul_norm) as shul_hit,
      (v_location_norm is not null and s.location_norm = v_location_norm) as location_hit
    from public.identity_signals s
    where s.account_id = v_account_id
      and s.target_type = p_target_type
      and (p_exclude_target_id is null or s.target_id <> p_exclude_target_id)
  ),
  weighted as (
    select
      sc.*,
      (sc.parents_hit::int + sc.seminary_hit::int + sc.shul_hit::int + sc.location_hit::int) as corroborators
    from scored sc
  )
  select
    w.sig_target_id,
    case
      when w.phone_hit and (w.name_exact or w.name_variant) then 0.98
      when w.phone_hit then 0.90
      when w.name_exact and w.corroborators >= 2 then 0.85
      when w.name_exact and w.corroborators = 1 then 0.75
      when w.name_variant and w.corroborators >= 2 then 0.70
      when w.name_variant and w.corroborators = 1 then 0.60
    end::numeric,
    (
      select coalesce(jsonb_agg(f.fact), '[]'::jsonb)
      from (
        select jsonb_build_object('signal', 'phone', 'detail', 'phone number matches exactly') as fact
          where w.phone_hit
        union all
        select jsonb_build_object('signal', 'name', 'detail', 'name matches exactly')
          where w.name_exact
        union all
        select jsonb_build_object('signal', 'name', 'detail', 'name matches as a Hebrew/English spelling variant')
          where w.name_variant and not w.name_exact
        union all
        select jsonb_build_object('signal', 'parents', 'detail', 'same parents')
          where w.parents_hit
        union all
        select jsonb_build_object('signal', 'school', 'detail', 'same school or seminary')
          where w.seminary_hit
        union all
        select jsonb_build_object('signal', 'shul', 'detail', 'same shul')
          where w.shul_hit
        union all
        select jsonb_build_object('signal', 'location', 'detail', 'same location')
          where w.location_hit
      ) f
    )
  from weighted w
  where w.phone_hit
     or ((w.name_exact or w.name_variant) and w.corroborators >= 1)
  order by 2 desc, 1 asc
  limit 10;
end;
$$;

-- Match-on-entry for references (FR20/FR42). A thin, typed caller of the shared
-- match_identity() service: it maps a reference's fields onto the shared signal
-- slots (school -> seminary) and returns candidate cards complete enough to
-- render without a second round-trip. NEVER gated by subscription state — this
-- recognition is free, always (FR42).
CREATE OR REPLACE FUNCTION "public"."match_reference_on_entry"(
    "p_name_en" "text" DEFAULT NULL,
    "p_name_he" "text" DEFAULT NULL,
    "p_phone" "text" DEFAULT NULL,
    "p_school" "text" DEFAULT NULL,
    "p_exclude_id" bigint DEFAULT NULL
) RETURNS TABLE(
    "reference_id" bigint,
    "confidence" numeric,
    "deciding_facts" "jsonb",
    "name_en" "text",
    "name_he" "text",
    "phone" "text",
    "relationship" "text",
    "school" "text",
    "grad_year" integer,
    "linked_shidduchim_count" bigint
)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select
    m.target_id,
    m.confidence,
    m.deciding_facts,
    r.name_en,
    r.name_he,
    r.phone,
    r.relationship,
    r.school,
    r.grad_year,
    (
      select count(distinct rl.shidduchim_id)
      from public.reference_links rl
      where rl.reference_id = r.id and rl.shidduchim_id is not null
    )
  from public.match_identity(
    'reference', p_name_en, p_name_he, p_phone, null, p_school, null, null, p_exclude_id
  ) m
  join public."references" r on r.id = m.target_id
  order by m.confidence desc, r.id asc;
$$;

-- The confirm-link half of match-on-entry: the user said "yes, this is the same
-- person", so the new mention becomes another link on the EXISTING reference
-- rather than a duplicate row. Account-scoped on both sides. Idempotent — a
-- second confirm returns the link that already exists instead of duplicating it.
CREATE OR REPLACE FUNCTION "public"."link_reference_to_shidduch"(
    "p_reference_id" bigint,
    "p_shidduchim_id" bigint,
    "p_relationship_override" "text" DEFAULT NULL
) RETURNS SETOF public.reference_links
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_existing_id bigint;
  v_new_id bigint;
begin
  v_account_id := public.current_account_id();

  if not exists (
    select 1 from public."references" r
    where r.id = p_reference_id and r.account_id = v_account_id
  ) then
    raise exception 'reference % not found in current account', p_reference_id;
  end if;

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  select rl.id into v_existing_id
  from public.reference_links rl
  where rl.reference_id = p_reference_id
    and rl.shidduchim_id = p_shidduchim_id
    and rl.account_id = v_account_id
  limit 1;

  if v_existing_id is not null then
    return query select * from public.reference_links where id = v_existing_id;
    return;
  end if;

  insert into public.reference_links (
    account_id, reference_id, shidduchim_id, call_status, relationship_override
  ) values (
    v_account_id, p_reference_id, p_shidduchim_id, 'not_started', p_relationship_override
  )
  returning id into v_new_id;

  insert into public.interactions (
    account_id, target_type, target_id, scope, reference_link_id, kind, body, metadata
  ) values (
    v_account_id, 'reference', p_reference_id, 'shidduch', v_new_id, 'link_created',
    null, jsonb_build_object('shidduchim_id', p_shidduchim_id)
  );

  return query select * from public.reference_links where id = v_new_id;
end;
$$;

-- The ONE write path for call capture. Both the mid-call capture screen and the
-- AI guided call script call this, so the assistant can never become a second,
-- disconnected data path: they write the same call_status, the same
-- what_they_said, and append to the same conversation_log.
CREATE OR REPLACE FUNCTION "public"."log_reference_call"(
    "p_reference_link_id" bigint,
    "p_call_status" "text" DEFAULT NULL,
    "p_what_they_said" "text" DEFAULT NULL,
    "p_source" "text" DEFAULT 'manual'
) RETURNS SETOF public.reference_links
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_link public.reference_links;
  v_member_id bigint;
  v_entry jsonb;
begin
  v_account_id := public.current_account_id();

  select * into v_link
  from public.reference_links rl
  where rl.id = p_reference_link_id and rl.account_id = v_account_id;

  if not found then
    raise exception 'reference link % not found in current account', p_reference_link_id;
  end if;

  if p_call_status is not null and p_call_status not in
    ('not_started', 'answered', 'no_answer', 'call_back', 'they_will_call_back') then
    raise exception 'invalid call status: %', p_call_status using errcode = 'check_violation';
  end if;

  if p_source not in ('manual', 'assistant') then
    raise exception 'invalid call log source: %', p_source using errcode = 'check_violation';
  end if;

  -- The log is append-only and lives in a jsonb column, so an unbounded note
  -- grows the row without limit on every call. 20k characters is far more than
  -- anyone types mid-call and keeps a single link's log bounded.
  if length(coalesce(p_what_they_said, '')) > 20000 then
    raise exception 'call note is too long (% characters, limit 20000)', length(p_what_they_said)
      using errcode = 'check_violation';
  end if;

  select am.id into v_member_id
  from public.account_members am
  where am.user_id = auth.uid() and am.account_id = v_account_id
  order by am.id
  limit 1;

  v_entry := jsonb_build_object(
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'call_status', coalesce(p_call_status, v_link.call_status),
    'text', p_what_they_said,
    'source', p_source,
    'member_id', v_member_id
  );

  update public.reference_links rl
  set call_status = coalesce(p_call_status, rl.call_status),
      what_they_said = coalesce(nullif(p_what_they_said, ''), rl.what_they_said),
      conversation_log = coalesce(rl.conversation_log, '[]'::jsonb) || jsonb_build_array(v_entry)
  where rl.id = p_reference_link_id;

  insert into public.interactions (
    account_id, target_type, target_id, scope, reference_link_id, actor_member_id, kind, body, metadata
  ) values (
    v_account_id, 'reference', v_link.reference_id, 'shidduch', p_reference_link_id, v_member_id,
    'call_logged', nullif(p_what_they_said, ''),
    jsonb_build_object(
      'call_status', coalesce(p_call_status, v_link.call_status),
      'shidduchim_id', v_link.shidduchim_id,
      'source', p_source
    )
  );

  return query select * from public.reference_links where id = p_reference_link_id;
end;
$$;

-- Re-points every interaction on one reference_link onto another. This exists
-- because the structural columns of `interactions` (scope, reference_link_id,
-- target_*) are NOT client-writable — otherwise a client could move a candid
-- note onto a different parent and change what it inherits. SECURITY DEFINER so
-- the merge can still do it, but it derives the account from the caller and
-- verifies BOTH links belong to them, so it can only ever shuffle rows inside
-- one account.
CREATE OR REPLACE FUNCTION "public"."rehome_reference_link_interactions"(
    "p_from_link_id" bigint,
    "p_to_link_id" bigint
) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_moved integer;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'no account context';
  end if;

  -- Both links must belong to the caller AND concern the SAME shidduch. The
  -- second half matters: without it this function would hand back exactly the
  -- capability the column-level UPDATE revoke removed — moving a candid note
  -- onto a different shidduch, and so changing whose visibility it inherits.
  -- The only caller, merge_references, only ever re-homes between two links for
  -- the same shidduch, so nothing legitimate needs more than this.
  if not exists (
    select 1
    from public.reference_links l
      join public.reference_links w
        on w.id = p_to_link_id
       and w.account_id = v_account_id
       and w.shidduchim_id is not distinct from l.shidduchim_id
    where l.id = p_from_link_id
      and l.account_id = v_account_id
  ) then
    raise exception 'reference links not found in current account, or not for the same shidduch';
  end if;

  update public.interactions i
  set reference_link_id = p_to_link_id
  where i.reference_link_id = p_from_link_id
    and i.account_id = v_account_id;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

-- Moves a reference's whole timeline onto another reference during a merge.
-- Same reasoning as rehome_reference_link_interactions: target_id is a
-- structural column and therefore not client-writable, so the merge needs a
-- definer path. Both references are verified against the CALLER's account, so
-- this can only ever move rows within one account.
CREATE OR REPLACE FUNCTION "public"."rehome_reference_interactions"(
    "p_from_reference_id" bigint,
    "p_to_reference_id" bigint
) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_moved integer;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'no account context';
  end if;

  if not exists (
    select 1 from public."references" r
    where r.id = p_from_reference_id and r.account_id = v_account_id
  ) or not exists (
    select 1 from public."references" r
    where r.id = p_to_reference_id and r.account_id = v_account_id
  ) then
    raise exception 'reference not found in current account';
  end if;

  update public.interactions i
  set target_id = p_to_reference_id
  where i.target_type = 'reference'
    and i.target_id = p_from_reference_id
    and i.account_id = v_account_id;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

-- What a merge would do, computed before anything is destroyed. The `collisions`
-- array is the case that does NOT exist for contacts: both duplicates hold a
-- link to the SAME shidduch, each with its own call log. The UI must make the
-- user resolve every collision — merge_references() refuses to run otherwise.
CREATE OR REPLACE FUNCTION "public"."preview_reference_merge"(
    "p_loser_id" bigint,
    "p_winner_id" bigint
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_loser public."references";
  v_winner public."references";
begin
  v_account_id := public.current_account_id();

  select * into v_loser from public."references" r
  where r.id = p_loser_id and r.account_id = v_account_id;
  if not found then
    raise exception 'reference % not found in current account', p_loser_id;
  end if;

  select * into v_winner from public."references" r
  where r.id = p_winner_id and r.account_id = v_account_id;
  if not found then
    raise exception 'reference % not found in current account', p_winner_id;
  end if;

  return jsonb_build_object(
    'loser', to_jsonb(v_loser),
    'winner', to_jsonb(v_winner),
    'reference_links_count', (
      select count(*) from public.reference_links rl where rl.reference_id = p_loser_id
    ),
    'interactions_count', (
      select count(*) from public.interactions i
      where i.target_type = 'reference' and i.target_id = p_loser_id
    ),
    'open_tasks_count', (
      select count(*) from public.tasks t
      where t.target_type = 'reference' and t.target_id = p_loser_id and t.done_date is null
    ),
    'collisions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'shidduchim_id', l.shidduchim_id,
          'shidduch_name_en', s.name_en,
          'shidduch_name_he', s.name_he,
          'loser_link', jsonb_build_object(
            'id', l.id,
            'call_status', l.call_status,
            'what_they_said', l.what_they_said,
            'conversation_log_count', coalesce(jsonb_array_length(l.conversation_log), 0)
          ),
          'winner_link', jsonb_build_object(
            'id', w.id,
            'call_status', w.call_status,
            'what_they_said', w.what_they_said,
            'conversation_log_count', coalesce(jsonb_array_length(w.conversation_log), 0)
          )
        )
      ), '[]'::jsonb)
      from public.reference_links l
        join public.reference_links w
          on w.reference_id = p_winner_id
         and w.shidduchim_id = l.shidduchim_id
         and w.account_id = v_account_id
        left join public.shidduchim s on s.id = l.shidduchim_id
      where l.reference_id = p_loser_id
        and l.account_id = v_account_id
        and l.shidduchim_id is not null
    )
  );
end;
$$;

-- Merge two duplicate references. Everything the loser owns moves to the winner
-- BEFORE the loser row is deleted: links, interactions, tasks. conversation_log
-- lives on the link, so reassigning reference_id carries it forward untouched.
--
-- The collision case (both references linked to the same shidduch) is resolved
-- explicitly by the user via p_resolutions — a jsonb object keyed by
-- shidduchim_id with values 'winner' | 'loser' | 'both'. An unresolved collision
-- RAISES rather than picking a side, because silently discarding one side's
-- what_they_said is exactly the data loss this design refuses to risk. In every
-- resolution the losing side's candid content is preserved as an interaction, so
-- no call log is ever destroyed, only re-filed.
CREATE OR REPLACE FUNCTION "public"."merge_references"(
    "p_loser_id" bigint,
    "p_winner_id" bigint,
    "p_resolutions" "jsonb" DEFAULT '{}'::jsonb
) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_collision record;
  v_resolution text;
  v_member_id bigint;
begin
  if p_loser_id = p_winner_id then
    raise exception 'cannot merge a reference into itself' using errcode = 'check_violation';
  end if;

  v_account_id := public.current_account_id();

  if not exists (
    select 1 from public."references" r
    where r.id = p_loser_id and r.account_id = v_account_id
  ) then
    raise exception 'reference % not found in current account', p_loser_id;
  end if;

  if not exists (
    select 1 from public."references" r
    where r.id = p_winner_id and r.account_id = v_account_id
  ) then
    raise exception 'reference % not found in current account', p_winner_id;
  end if;

  select am.id into v_member_id
  from public.account_members am
  where am.user_id = auth.uid() and am.account_id = v_account_id
  order by am.id
  limit 1;

  for v_collision in
    select
      l.id as loser_link_id,
      w.id as winner_link_id,
      l.shidduchim_id,
      l.call_status as loser_call_status,
      l.what_they_said as loser_what_they_said,
      l.conversation_log as loser_conversation_log,
      w.call_status as winner_call_status,
      w.what_they_said as winner_what_they_said
    from public.reference_links l
      join public.reference_links w
        on w.reference_id = p_winner_id
       and w.shidduchim_id = l.shidduchim_id
       and w.account_id = v_account_id
    where l.reference_id = p_loser_id
      and l.account_id = v_account_id
      and l.shidduchim_id is not null
  loop
    v_resolution := p_resolutions ->> v_collision.shidduchim_id::text;

    if v_resolution is null then
      raise exception
        'unresolved merge conflict: both references are linked to shidduch %. Choose which call log to keep before merging.',
        v_collision.shidduchim_id
        using errcode = 'check_violation';
    end if;

    if v_resolution not in ('winner', 'loser', 'both') then
      raise exception 'invalid merge resolution % for shidduch %', v_resolution, v_collision.shidduchim_id
        using errcode = 'check_violation';
    end if;

    -- Whatever is not kept as the live call log is preserved as an interaction.
    if v_resolution = 'winner' then
      insert into public.interactions (
        account_id, target_type, target_id, scope, reference_link_id, actor_member_id, kind, body, metadata
      ) values (
        v_account_id, 'reference', p_winner_id, 'shidduch', v_collision.winner_link_id, v_member_id, 'merge',
        v_collision.loser_what_they_said,
        jsonb_build_object(
          'reason', 'duplicate reference merged; superseded call log preserved',
          'shidduchim_id', v_collision.shidduchim_id,
          'call_status', v_collision.loser_call_status,
          'conversation_log', coalesce(v_collision.loser_conversation_log, '[]'::jsonb)
        )
      );

    elsif v_resolution = 'loser' then
      insert into public.interactions (
        account_id, target_type, target_id, scope, reference_link_id, actor_member_id, kind, body, metadata
      ) values (
        v_account_id, 'reference', p_winner_id, 'shidduch', v_collision.winner_link_id, v_member_id, 'merge',
        v_collision.winner_what_they_said,
        jsonb_build_object(
          'reason', 'duplicate reference merged; superseded call log preserved',
          'shidduchim_id', v_collision.shidduchim_id,
          'call_status', v_collision.winner_call_status
        )
      );

      update public.reference_links w
      set call_status = v_collision.loser_call_status,
          what_they_said = v_collision.loser_what_they_said,
          conversation_log = coalesce(w.conversation_log, '[]'::jsonb)
            || coalesce(v_collision.loser_conversation_log, '[]'::jsonb)
      where w.id = v_collision.winner_link_id;

    else
      update public.reference_links w
      set conversation_log = coalesce(w.conversation_log, '[]'::jsonb)
            || coalesce(v_collision.loser_conversation_log, '[]'::jsonb),
          what_they_said = concat_ws(
            E'\n\n', nullif(w.what_they_said, ''), nullif(v_collision.loser_what_they_said, '')
          )
      where w.id = v_collision.winner_link_id;

      insert into public.interactions (
        account_id, target_type, target_id, scope, reference_link_id, actor_member_id, kind, body, metadata
      ) values (
        v_account_id, 'reference', p_winner_id, 'shidduch', v_collision.winner_link_id, v_member_id, 'merge',
        v_collision.loser_what_they_said,
        jsonb_build_object(
          'reason', 'duplicate reference merged; both call logs kept',
          'shidduchim_id', v_collision.shidduchim_id,
          'call_status', v_collision.loser_call_status
        )
      );
    end if;

    -- Re-home the losing link's interactions, then drop the duplicate link.
    perform public.rehome_reference_link_interactions(
      v_collision.loser_link_id, v_collision.winner_link_id
    );

    delete from public.reference_links where id = v_collision.loser_link_id;
  end loop;

  -- Non-colliding links, the whole timeline, and every reminder move across.
  update public.reference_links rl
  set reference_id = p_winner_id
  where rl.reference_id = p_loser_id and rl.account_id = v_account_id;

  perform public.rehome_reference_interactions(p_loser_id, p_winner_id);

  update public.tasks t
  set target_id = p_winner_id
  where t.target_type = 'reference' and t.target_id = p_loser_id and t.account_id = v_account_id;

  -- The loser's identity_signals row is removed by purge_polymorphic_dependents
  -- when the row below is deleted, so the matcher never points at a dead id.
  -- Account-scoped: it names no shidduch and carries no candid content, only the
  -- fact that two records became one.
  insert into public.interactions (
    account_id, target_type, target_id, scope, actor_member_id, kind, body, metadata
  ) values (
    v_account_id, 'reference', p_winner_id, 'account', v_member_id, 'merge', null,
    jsonb_build_object('merged_from_reference_id', p_loser_id)
  );

  delete from public."references" where id = p_loser_id and account_id = v_account_id;

  return p_winner_id;
end;
$$;
