-- Story 14.6: Per-recipient shares and the watermark (FR48, PRV-8)
-- Add recipient information to share_links to enable per-recipient sharing,
-- independent revocation, recipient-specific access logging, and watermarking

-- Add recipient fields to share_links table
alter table "public"."share_links" add column "recipient_name" text;
alter table "public"."share_links" add column "recipient_shadchan_id" bigint references public.shadchanim(id) on delete set null;
alter table "public"."share_links" add column "recipient_contact_info" text;

-- Update existing rows to have placeholder recipient name (since we can't know
-- the original intended recipient, we'll use a generic placeholder)
-- In a real migration with existing data, we might want to set this to something
-- like "Unknown Recipient" or leave it NULL and make the application handle it
update public.share_links set recipient_name = 'Unknown Recipient' where recipient_name is null;

-- Make recipient_name NOT NULL since it's essential for the feature
alter table "public"."share_links" alter column recipient_name set not null;

-- Create indexes for efficient querying by recipient
create index share_links_recipient_name_idx on public.share_links(recipient_name);
create index share_links_recipient_shadchan_id_idx on public.share_links(recipient_shadchan_id);

-- Update share_access_log to include recipient information for easier querying
-- (This is denormalized but makes recipient-specific access queries much faster)
alter table "public"."share_access_log" add column "recipient_name" text;
alter table "public"."share_access_log" add column "recipient_shadchan_id" bigint references public.shadchanim(id) on delete set null;

-- Create index for recipient-specific access log queries
create index share_access_log_recipient_name_idx on public.share_access_log(recipient_name);
create index share_access_log_recipient_shadchan_id_idx on public.share_access_log(recipient_shadchan_id);

-- Note: The application layer will need to populate these fields when creating
-- share links and when logging access to share links