-- myshadchan-92m: allow the existing append-only outbound ledger to record
-- email-provider outcomes. This is constraint-only: it neither rewrites nor
-- removes rows, so populated-table migration safety is preserved.
alter table public.outbound_share_history
    drop constraint outbound_share_history_outcome_check;

alter table public.outbound_share_history
    add constraint outbound_share_history_outcome_check check (
        outcome in (
            'share_sheet_opened',
            'download_prepared',
            'cancelled',
            'unsupported',
            'failed',
            'email_provider_accepted',
            'email_rate_limited',
            'email_rejected',
            'email_fetch_failed',
            'email_delivery_unknown'
        )
    );
