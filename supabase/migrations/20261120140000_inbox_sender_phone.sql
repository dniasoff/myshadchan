-- Optional phone captured manually alongside an Inbox sender name.
-- Additive and idempotent. There is no legacy backfill: existing capture
-- paths do not have a reliable phone source, and service-role ingest leaves
-- this field NULL.

do $$
declare
  before_count bigint;
  after_count bigint;
begin
  -- Keep a row-count receipt so a non-empty Inbox cannot be changed silently
  -- by this migration. The repository's migration-data-safety fixture performs
  -- the broader value-preservation check against production-shaped rows.
  select count(*) into before_count from public.inbox_items;

  alter table public.inbox_items
    add column if not exists sender_phone text;

  select count(*) into after_count from public.inbox_items;

  if before_count > 0 and after_count <> before_count then
    raise exception
      'inbox_items row-count changed while adding sender_phone (% vs %)',
      before_count,
      after_count;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inbox_items_sender_phone_check'
      and conrelid = 'public.inbox_items'::regclass
  ) then
    alter table public.inbox_items
      add constraint inbox_items_sender_phone_check check (
        sender_phone is null
        or (
          sender_phone = btrim(sender_phone)
          and sender_phone <> ''
          and char_length(sender_phone) <= 40
          and sender_phone !~ '[[:cntrl:]]'
        )
      );
  end if;
end;
$$;

-- Existing inbox_items table grants and account-scoped RLS already govern this
-- nullable column: authenticated has the same CRUD access as sender, while
-- service_role retains the existing operational access. No view, RPC body, or
-- backfill is needed for this additive field.
