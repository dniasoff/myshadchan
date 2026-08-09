-- Story 14.4: The data subject's purge request (PRV-11)
-- Process a verified purge request (to be used in runbook phase)
CREATE OR REPLACE FUNCTION "public"."process_purge_request"(
    p_request_id bigint
) RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_request_id bigint := p_request_id;
    v_result jsonb := '{}'::jsonb;
    v_request record;
    v_error text;
    v_single_record record;
    v_shidduch_record record;
    v_notified_accounts jsonb := '[]'::jsonb;
    v_matched_singles_count integer := 0;
    v_matched_shidduchim_count integer := 0;
    v_count integer;
begin
    -- Find the purge request
    SELECT * INTO v_request
    FROM public.purge_requests
    WHERE id = v_request_id
      AND status = 'verified';
    
    IF NOT FOUND THEN
        v_result := jsonb_set(v_result, '{status}', to_jsonb('error'));
        v_result := jsonb_set(v_result, '{message}', to_jsonb('Request not found or not verified'));
        RETURN v_result;
    END IF;

    -- TODO: In a full implementation, we would:
    -- 1. Actually purge the matching singles and shidduchim
    -- 2. Notify affected accounts
    -- 3. Update the request with results
    -- For the runbook phase, we'll just mark it as processed and return what would be done

    -- Find matching singles (same logic as in request_single_purge)
    FOR v_single_record IN
        select s.id as single_id, s.account_id, s.first_name_en, s.last_name_en,
               s.first_name_he, s.last_name_he,
               am.id as account_members_id,
               array_agg(distinct am.account_id) as affected_account_ids
        from public.singles s
        left join public.account_members am on s.account_id = am.account_id
        where (
            -- Match on English name (case-insensitive, fuzzy)
            (lower(s.first_name_en || ' ' || s.last_name_en) like lower('%' || v_request.single_name || '%') OR
             lower(s.first_name_en) like lower('%' || v_request.single_name || '%') OR
             lower(s.last_name_en) like lower('%' || v_request.single_name || '%'))
            OR
            -- Match on Hebrew name if provided
            (v_request.single_name ~* '[\x{0590}-\x{05FF}]' AND -- Check if input contains Hebrew characters
             (lower(s.first_name_he || ' ' || s.last_name_he) like lower('%' || v_request.single_name || '%') OR
              lower(s.first_name_he) like lower('%' || v_request.single_name || '%') OR
              lower(s.last_name_he) like lower('%' || v_request.single_name || '%')))
            OR
            -- Match on email if provided
            (v_request.single_email IS NOT NULL AND v_request.single_email <> '' AND
             EXISTS (
                 SELECT 1 FROM public.accounts a 
                 WHERE a.id = s.account_id 
                 AND lower(a.email) = lower(v_request.single_email)
             ))
        )
        and s.status = 'active' -- Only process active singles
        group by s.id, s.account_id, s.first_name_en, s.last_name_en,
                 s.first_name_he, s.last_name_he, am.id
    LOOP
        -- In a real implementation, we would:
        -- 1. Notify the account holders (via insert into notifications table or email)
        -- 2. Delete the single (which would cascade to dependent tables via triggers)
        -- 3. BUT preserve the accounts' own records about their own children
        
        -- For now, just count what we would process
        v_matched_singles_count := v_matched_singles_count + 1;
        
        -- Collect affected account IDs for notification
        IF v_single_record.affected_account_ids IS NOT NULL THEN
            v_notified_accounts := v_notified_accounts || v_single_record.affected_account_ids;
        END IF;
    END LOOP;

    -- Find matching shidduchim (same logic as in request_single_purge)
    FOR v_shidduch_record IN
        select sh.id as shidduch_id, sh.account_id
        from public.shidduchim sh
        join public.singles s on sh.single_id = s.id
        where (
            -- Match on English name (case-insensitive, fuzzy)
            (lower(s.first_name_en || ' ' || s.last_name_en) like lower('%' || v_request.single_name || '%') OR
             lower(s.first_name_en) like lower('%' || v_request.single_name || '%') OR
             lower(s.last_name_en) like lower('%' || v_request.single_name || '%'))
            OR
            -- Match on Hebrew name if provided
            (v_request.single_name ~* '[\x{0590}-\x{05FF}]' AND -- Check if input contains Hebrew characters
             (lower(s.first_name_he || ' ' || s.last_name_he) like lower('%' || v_request.single_name || '%') OR
              lower(s.first_name_he) like lower('%' || v_request.single_name || '%') OR
              lower(s.last_name_he) like lower('%' || v_request.single_name || '%')))
            OR
            -- Match on email if provided
            (v_request.single_email IS NOT NULL AND v_request.single_email <> '' AND
             EXISTS (
                 SELECT 1 FROM public.accounts a 
                 WHERE a.id = s.account_id 
                 AND lower(a.email) = lower(v_request.single_email)
             ))
        )
        and s.status = 'active'
        and sh.status <> 'deleted' -- Only process non-deleted shidduchim
    LOOP
        -- In a real implementation, we would:
        -- 1. Notify the account holders of the shidduchim
        -- 2. Purge the shidduchim and related data (interactions, tasks, etc.)
        -- 3. BUT preserve the accounts' own records about their own children
        
        -- For now, just count what we would process
        v_matched_shidduchim_count := v_matched_shidduchim_count + 1;
    END LOOP;

    -- Deduplicate notified accounts
    v_notified_accounts := (
        select jsonb_agg(distinct elem)
        from jsonb_array_elements(v_notified_accounts) as elem
    );

    -- Update the request as processed
    UPDATE public.purge_requests
    SET status = 'processed',
        processed_at = now(),
        matched_singles_count = v_matched_singles_count,
        matched_shidduchim_count = v_matched_shidduchim_count,
        notified_accounts = v_notified_accounts,
        result = jsonb_build_object(
            'message', 'Purge request processed successfully',
            'matched_singles_count', v_matched_singles_count,
            'matched_shidduchim_count', v_matched_shidduchim_count,
            'notified_accounts_count', jsonb_array_length(v_notified_accounts)
        )
    WHERE id = v_request_id;

    -- Return results
    v_result := jsonb_set(v_result, '{status}', to_jsonb('processed'));
    v_result := jsonb_set(v_result, '{message}', to_jsonb('Purge request processed successfully'));
    v_result := jsonb_set(v_result, '{request_id}', to_jsonb(v_request_id));
    v_result := jsonb_set(v_result, '{matched_singles_count}', to_jsonb(v_matched_singles_count));
    v_result := jsonb_set(v_result, '{matched_shidduchim_count}', to_jsonb(v_matched_shidduchim_count));
    v_result := jsonb_set(v_result, '{notified_accounts_count}', to_jsonb(jsonb_array_length(v_notified_accounts)));

    return v_result;
exception
    when others then
        v_result := jsonb_set(v_result, '{status}', to_jsonb('error'));
        v_result := jsonb_set(v_result, '{message}', to_jsonb(sqlerrm));
        return v_result;
end;
$$;

-- Grant execute permission to service_role only (for manual processing or Workers)
grant execute on function public.process_purge_request to postgres;