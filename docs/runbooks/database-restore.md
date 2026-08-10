# Database Restore Runbook

**Status:** Active  
**Last Updated:** 2026-08-10  
**Story:** 15.5 (NFR-8 Operational Runbooks)  
**Related:** S19 (Epic 15 unowned-work ledger)

---

## ⚠️ UNVERIFIED — RECOVERY OBJECTIVES ARE UNMEASURED

**The recovery point objective (RPO) and recovery time objective (RTO) for this database are currently UNMEASURED.** This runbook cannot state a retention window, a point-in-time recovery (PITR) availability, or an expected restore duration because none of those are determinable from this repository. They are properties of the **hosted Supabase project configuration**, not of the code.

| Question | Answer |
|----------|--------|
| Is PITR enabled on the production Supabase project? | **UNVERIFIED — confirm with the owner** |
| What is the PITR retention window (days)? | **UNVERIFIED — confirm with the owner** |
| How long does a full restore take (RTO)? | **UNVERIFIED — confirm with the owner** |
| Is there a daily logical backup (pg_dump) in addition to PITR? | **UNVERIFIED — confirm with the owner** |

> The entire point of the story this runbook belongs to is that these numbers do not exist. Do not guess them. Ask the project owner and record the answers here when known.

---

## Overview

This runbook covers **production data loss, corruption, or wrongful deletion** requiring a database restore. The scenarios it addresses:

| Scenario | Typical Cause |
|----------|---------------|
| Migration destroyed data (empty-table trap) | `DROP COLUMN` without backfill, resync from NULL sources — the two incidents documented in AGENTS.md (`20260729095558_backfill_member_state.sql`, `20260730011428_shidduch_overview_fields.sql`) |
| Accidental `DELETE` / `TRUNCATE` | Manual SQL run against production, bad script |
| Application bug corrupting rows | Bad backfill, wrong `UPDATE` where clause |
| Supabase platform incident | Regional outage, storage corruption (rare) |

The database schema is defined declaratively in `supabase/schemas/` (source of truth). Migrations in `supabase/migrations/` are auto-generated. The **only gate that tests migrations against production-shaped data** is `make check-migration-safety` (`scripts/check-migration-data-safety.mjs` + `supabase/tests/migration-data-safety/`).

---

## 1. STOP FIRST — Do Not Make It Worse

Before touching anything, halt everything that can write to the database or advance the schema.

| Action | How | Why |
|--------|-----|-----|
| **Stop all deploys** | GitHub Actions → `deploy` workflow → "Disable workflow" or delete `VERCEL_DEPLOY_HOOK_URL` secret temporarily | A running deploy may push more migrations, overwrite WAL, or race the restore |
| **Stop the cron Worker** | Cloudflare Dashboard → Workers → `cron` → "Pause" or delete its `CRON_TRIGGER` binding | The cron worker runs `record_cron_heartbeat()` and `grace_sweep()`; it will write to `cron_heartbeat` and may mutate `tasks`/`reminders` during restore |
| **Pause other Workers that write** | `billing` (Stripe webhooks), `ingest` (email), `ai`/`parse` (if they have write paths) | Same reason — any write during restore creates split-brain |
| **If a migration is mid-flight** | Check `supabase migration list --project-ref <PROJECT_ID>` for "pending" | Do not `db push` or `migration up` until you choose a recovery path |

> **Do not run `supabase db reset`**, `supabase migration up`, or any DDL against production until you have a verified recovery point and a plan to verify the result.

---

## 2. Establish What Was Lost and When

Bound the damage window before choosing a recovery point.

### 2.1 Identify the Incident Time

| Source | Query / Check |
|--------|---------------|
| **Migration that may have caused it** | `SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;` (in Supabase SQL Editor) — note the timestamp of the last applied migration |
| **Application-level audit** | `public.interactions`, `public.tasks`, `public.cron_heartbeat` — look for gaps in `created_at` / `last_run_at` |
| **Stripe webhook ledger** | `SELECT * FROM public.stripe_events ORDER BY received_at DESC LIMIT 20;` — last successful `status = 'done'` row |
| **GitHub Actions deploy log** | The `deploy-supabase` job log shows exact migration timestamps applied |

### 2.2 Determine Scope

| Question | How to Answer |
|----------|---------------|
| Which tables? | `SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup;` — compare row counts to expected |
| Which columns? | If a migration dropped columns, `supabase db diff --workdir <scratch> --local` (see AGENTS.md "The `--db-url` trap") against the last-known-good baseline will show them |
| Was it a `DROP COLUMN` or a bad backfill? | Check `supabase/migrations/` for the last applied migration — look for `DROP COLUMN`, `ALTER COLUMN ... SET DEFAULT`, or `UPDATE ... SET derived = ...` without `WHERE` guard |

### 2.3 Pick a Recovery Target

| Option | When Usable |
|--------|-------------|
| **PITR to timestamp T** | PITR enabled, retention covers T, T is before the destructive event |
| **Daily backup (pg_dump) from date D** | Logical backup exists, D is before the event |
| **Reconstruct from application state** | Only specific rows lost, can be re-derived from `interactions`, `inbox_items`, email logs, Stripe events, or user re-entry |

> **Record your chosen recovery point and the evidence for it here:**
>
> - Recovery target: ___________________
> - Evidence it is before the loss: ___________________
> - Tables/columns affected: ___________________

---

## 3. Recovery Options — Honestly Ranked

| Rank | Method | Trade-offs |
|------|--------|------------|
| **1** | **Supabase PITR (Point-in-Time Recovery)** | ✅ Recovers **entire cluster** to exact second (if enabled)<br>✅ No schema drift — WAL replay is faithful<br>❌ **UNVERIFIED — confirm with the owner**: may not be enabled, retention unknown, RTO unknown<br>❌ Restores **everything** — including the bad migration if you pick wrong timestamp |
| **2** | **Daily logical backup (pg_dump) + manual replay** | ✅ Portable, inspectable, can restore subset of tables<br>✅ Can `pg_restore --data-only --table=...` single tables<br>❌ **UNVERIFIED — confirm with the owner**: backup may not exist, may be stale, may not include `auth` schema<br>❌ Schema must match backup — if migrations applied after backup, `pg_restore` fails or produces drift |
| **3** | **Reconstruct from immutable sources** | ✅ Surgical — only fixes what broke<br>✅ No full-cluster downtime<br>❌ Only works for **specific, re-derivable data** (e.g., `shidduchim_summary` view from base tables, `stripe_events` from Stripe dashboard replay, `inbox_items` from email archives)<br>❌ Cannot recover `auth.users`, passwords, or opaque blobs |
| **4** | **Manual SQL repair (last resort)** | ✅ No restore needed<br>❌ High risk of further corruption<br>❌ Requires perfect knowledge of pre-loss state |

### 3.1 If Using PITR (Supabase Dashboard)

1. Supabase Dashboard → Project → **Database** → **Backups** → **Point-in-Time Recovery**
2. Choose timestamp **before** the destructive event (use evidence from §2.1)
3. Initiate restore — this creates a **new project** (not in-place)
4. Verify the restored project (see §4), then switch DNS / connection strings

> **UNVERIFIED — confirm with the owner:** Whether PITR creates a new project or restores in-place, and whether the original project remains accessible during/after.

### 3.2 If Using Daily Backup (pg_dump)

```bash
# 1. Download the backup (UNVERIFIED — location unknown)
# 2. Inspect without restoring:
pg_restore -l backup.dump | head -50

# 3. Restore data-only for specific tables (schema must already exist and match):
pg_restore --data-only --table=public.shidduchim --table=public.references \
  -d "postgresql://..." backup.dump

# 4. If schema drifted, restore to a fresh DB, then `supabase db diff` against supabase/schemas/
```

### 3.3 If Reconstructing from Source

| Lost Data | Reconstruction Source |
|-----------|----------------------|
| `shidduchim`, `singles`, `references` | Base tables intact? Query them. View `shidduchim_summary` is derived. |
| `stripe_events` | Stripe Dashboard → Webhooks → "Resend" for missing events, or API `GET /v1/events` |
| `inbox_items` | Inbucket (local) / email provider logs / Resend API `GET /emails` |
| `cron_heartbeat` | Re-insert one row: `INSERT INTO cron_heartbeat (worker, last_run_at, last_ok_at) VALUES ('cron', now(), now());` |
| `ai_parse_attempts` | Re-process from `inbox_items.attachments` via workers/parse |
| `auth.users` | **Cannot reconstruct** — requires PITR or backup |

---

## 4. Verification After Restore

After any restore, **do not declare success until these pass**.

### 4.1 Row Counts and Referential Integrity

```sql
-- In Supabase SQL Editor on the RESTORED database

-- 1. Core entity counts (adjust expected numbers to your knowledge)
SELECT 'accounts' AS t, count(*) FROM public.accounts
UNION ALL SELECT 'singles', count(*) FROM public.singles
UNION ALL SELECT 'shidduchim', count(*) FROM public.shidduchim
UNION ALL SELECT 'references', count(*) FROM public.references
UNION ALL SELECT 'redts', count(*) FROM public.redts
UNION ALL SELECT 'interactions', count(*) FROM public.interactions
UNION ALL SELECT 'tasks', count(*) FROM public.tasks
UNION ALL SELECT 'invites', count(*) FROM public.invites
UNION ALL SELECT 'connections', count(*) FROM public.connections
UNION ALL SELECT 'threads', count(*) FROM public.threads
UNION ALL SELECT 'messages', count(*) FROM public.messages
UNION ALL SELECT 'members', count(*) FROM public.members
UNION ALL SELECT 'account_members', count(*) FROM public.account_members
UNION ALL SELECT 'shadchanim', count(*) FROM public.shamchanim;

-- 2. FK integrity (should return zero rows)
SELECT 'shidduchim.single_id' AS fk, count(*)
FROM public.shidduchim s LEFT JOIN public.singles si ON si.id = s.single_id
WHERE si.id IS NULL
UNION ALL
SELECT 'references.account_id', count(*)
FROM public.references r LEFT JOIN public.accounts a ON a.id = r.account_id
WHERE a.id IS NULL
-- ... add for each FK you care about
;

-- 3. Critical derived views still compute
SELECT * FROM public.shidduchim_summary LIMIT 5;
SELECT * FROM public.references_summary LIMIT 5;
```

### 4.2 Schema Convergence with `supabase/schemas/`

The declarative schema in `supabase/schemas/` is the source of truth. After restore, confirm the live database matches it.

```bash
# Create a scratch workdir pointing at the RESTORED database (see AGENTS.md "The --db-url trap")
SCRATCH=$(mktemp -d); cp -r supabase "$SCRATCH/supabase"
# Edit $SCRATCH/supabase/config.toml to point at the restored DB's host/port
perl -0pi -e 's/(\[db\]\n(?:#[^\n]*\n|\n)*port = )\d+/${1}5432/' "$SCRATCH/supabase/config.toml"
# (or set host=... if remote)

# Diff declaratively — this READS supabase/schemas/**
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir "$SCRATCH" --local

# Expected: "No schema changes found" (or only expected post-restore drift like PITR timestamp tables)
rm -rf "$SCRATCH"
```

> **Before trusting an empty diff, confirm the check can fail** — inject a throwaway column into the scratch copy of `01_tables.sql` and watch it appear. An empty diff from a command that cannot see your schema looks exactly like a converged one.

### 4.3 Application Smoke Test

1. Point a **staging** frontend at the restored database (update `SUPABASE_URL` / `SUPABASE_ANON_KEY` in Vercel preview env)
2. Verify:
   - Login works (Google OAuth + magic link)
   - Kanban board loads (`shidduchim` pipeline)
   - References list loads
   - Inbox shows items
   - Reminders hub shows tasks
   - Settings page loads without 500s

---

## 5. Post-Incident: If a Migration Caused This

If the root cause was a migration that passed local gates but destroyed production data, **`make check-migration-safety` is the gate that should have caught it**.

### 5.1 What the Guard Does (Four Phases)

From `scripts/check-migration-data-safety.mjs`:

| Phase | Action | What It Catches |
|-------|--------|-----------------|
| **1. reset** | `supabase db reset --version <baseline> --no-seed` | Brings stack to **last deployed migration** (production schema), empty |
| **2. seed** | Runs `supabase/tests/migration-data-safety/fixture.sql` | Seeds **production-shaped rows** into every table, snapshots them in `migration_guard.snapshot` |
| **3. apply** | `supabase migration up --local` | Applies **only the pending migrations** (the ones not yet deployed) |
| **4. assert** | Runs `declared-moves.sql` then `assert.sql` | **Fails if**: any seeded row deleted, any surviving column value changed, any dropped column held data without a verified destination |

The two real incidents (`20260729095558_backfill_member_state.sql`, `20260730011428_shidduch_overview_fields.sql`) passed every other gate — `db reset`, `db diff`, typecheck, lint — because **no other gate runs migrations against a non-empty table**.

### 5.2 The Fix Shape Is Always the Same

`db diff` will **never** generate the correct fix. The fix pattern:

```sql
-- 1. ADD the new column FIRST (nullable, or with a safe default)
ALTER TABLE public.shidduchim ADD COLUMN new_overview text;

-- 2. BACKFILL it from surviving data (fail-closed: if source is NULL, do not guess)
UPDATE public.shidduchim
SET new_overview = father_en || ' & ' || mother_en
WHERE father_en IS NOT NULL AND mother_en IS NOT NULL;

-- 3. ASSERT the backfill covered everything that matters
-- (inside the same migration, before the drop)
DO $$
DECLARE v_missing int;
BEGIN
    SELECT count(*) INTO v_missing
    FROM public.shidduchim
    WHERE new_overview IS NULL
      AND (father_en IS NOT NULL OR mother_en IS NOT NULL);
    IF v_missing > 0 THEN
        RAISE EXCEPTION 'Backfill incomplete: % rows would lose data', v_missing;
    END IF;
END $$;

-- 4. DROP the old column ONLY after backfill + assertion
ALTER TABLE public.shidduchim DROP COLUMN parents_en;
```

### 5.3 Declare Intentional Losses

If a column **genuinely** held no production data and you intend to drop it:

```sql
-- In supabase/tests/migration-data-safety/declared-moves.sql
INSERT INTO migration_guard.discarded_columns (table_name, column_name, reason)
VALUES ('shidduchim', 'obsolete_column', 'Never written by any code path; added in migration X, never used');
```

> **Do not use `discarded_columns` for columns that might have data.** Back the belief with a fail-closed assertion inside the migration so a wrong belief halts the deploy instead of erasing production.

### 5.4 Run the Guard Before Pushing

```bash
# Against origin/main (what production has)
make check-migration-safety

# Or with explicit baseline
node scripts/check-migration-data-safety.mjs --baseline 20260809144200
```

If it passes, the pending migrations are safe to deploy. If it fails, read the banner — `assert` phase means **data destruction**, other phases mean **setup/test harness problems**.

---

## Related Documents

| Document | Location |
|----------|----------|
| Migration data-safety guard (driver) | `scripts/check-migration-data-safety.mjs` |
| Guard fixture (seeds + snapshot) | `supabase/tests/migration-data-safety/fixture.sql` |
| Guard declarations (column moves) | `supabase/tests/migration-data-safety/declared-moves.sql` |
| Guard assertions | `supabase/tests/migration-data-safety/assert.sql` |
| Declarative schema (source of truth) | `supabase/schemas/01_tables.sql`, `03_views.sql`, etc. |
| Migrations (auto-generated) | `supabase/migrations/` |
| AGENTS.md — "The empty-table trap" | `AGENTS.md:43` |
| AGENTS.md — "The --db-url trap" | `AGENTS.md:67` |
| Failed deploy runbook | `docs/runbooks/failed-deploy.md` |
| Epic 15 ledger (S19) | `_bmad-output/planning-artifacts/epics.md` |

---

## Sign-Off

| Incident | Date | Recovery Method | Recovery Point | Verified By |
|----------|------|-----------------|----------------|-------------|
| | | | | |

---

## UNVERIFIED Items Summary

The following **must be confirmed with the project owner** before this runbook is executable:

1. **PITR enabled on production Supabase project?** — UNVERIFIED — confirm with the owner
2. **PITR retention window (days)?** — UNVERIFIED — confirm with the owner
3. **PITR restore duration (RTO)?** — UNVERIFIED — confirm with the owner
4. **Daily logical backup (pg_dump) exists? Location? Schedule?** — UNVERIFIED — confirm with the owner
5. **Backup includes `auth` schema?** — UNVERIFIED — confirm with the owner
6. **PITR creates new project or restores in-place?** — UNVERIFIED — confirm with the owner

> Record answers above when known. Until then, **this runbook is a plan, not a procedure**.

(End of file)