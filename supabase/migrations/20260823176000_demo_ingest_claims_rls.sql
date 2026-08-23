-- Claims are service-owned lifecycle state. Keep the table behind both RLS
-- flags even though service_role bypasses them; this prevents an accidental
-- future grant from turning token-bound lifecycle receipts into a client API.
alter table public.demo_run_ingest_claims enable row level security;
alter table public.demo_run_ingest_claims force row level security;
