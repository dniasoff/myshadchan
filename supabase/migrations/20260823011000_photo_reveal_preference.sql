-- Photo privacy preference. Existing and new accounts default to ordinary
-- photo previews; households can opt into explicit reveal-on-click friction.
alter table public.accounts
  add column photo_reveal_on_click boolean not null default false;

comment on column public.accounts.photo_reveal_on_click is
  'When true, photos require an explicit click before the client requests a signed URL.';
