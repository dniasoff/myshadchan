-- Story 14.6: Per-recipient shares and the watermark (FR48, PRV-8)
-- Add watermark flag to share_links table
alter table "public"."share_links" add column "watermark" boolean not null default false;