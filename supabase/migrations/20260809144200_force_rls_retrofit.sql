-- Story 15.3(b): FORCE ROW LEVEL SECURITY retrofit for pre-existing tables
-- The check-force-rls.mjs script (Story 15.3(a)) identified 30 tables with RLS
-- enabled but missing FORCE ROW LEVEL SECURITY. This migration adds FORCE RLS
-- to all of them in a single atomic DDL batch. No column data changes — pure
-- DDL addition. Declared in declared-moves.sql with no-op recover_query.

alter table public.account_members force row level security;
alter table public.accounts force row level security;
alter table public.ai_parse_attempts force row level security;
alter table public.ai_usage force row level security;
alter table public.configuration force row level security;
alter table public.cron_heartbeat force row level security;
alter table public.date_records force row level security;
alter table public.entity_files force row level security;
alter table public.identity_signals force row level security;
alter table public.inbox_items force row level security;
alter table public.interactions force row level security;
alter table public.invites force row level security;
alter table public.medical_notes force row level security;
alter table public.member_state force row level security;
alter table public.members force row level security;
alter table public.pipeline_transitions force row level security;
alter table public.redts force row level security;
alter table public.reference_links force row level security;
alter table public.references force row level security;
alter table public.resume_photos force row level security;
alter table public.resumes force row level security;
alter table public.shadchanim force row level security;
alter table public.shidduch_schools force row level security;
alter table public.shidduchim force row level security;
alter table public.shidduchim_external_links force row level security;
alter table public.singles force row level security;
alter table public.stripe_events force row level security;
alter table public.subscription force row level security;
alter table public.tasks force row level security;
alter table public.trusted_senders force row level security;