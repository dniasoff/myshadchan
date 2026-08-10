# Database Restore Runbook

**Status:** Active
**Last Updated:** 2026-08-10
**Story:** 15.5 (NFR-8 Operational Runbooks)
**Related:** S19 (Epic 15 unowned-work ledger)

---

## ⚠️ THERE IS NO BACKUP AND NO RECOVERY PATH TODAY

**This project runs on the Supabase FREE tier. Point-in-Time Recovery is NOT enabled. There are NO automatic daily backups. There is NO custom pg_dump. A bad migration, a wrong DELETE, or a dropped table is permanent.**

This is a **deliberate pre-launch decision**, not an oversight. The product has no users yet, so the data has little value and the owner has chosen not to pay for backups. When the first real user arrives, this changes.

---

## 🚨 LAUNCH BLOCKER: BACKUPS MUST BE ENABLED BEFORE FIRST USER

**Before the first real user signs up, one of the following MUST be enabled:**

- **Supabase PITR (Point-in-Time Recovery)** — requires upgrading to a paid Supabase plan (Pro or higher). Provides continuous WAL archiving with a configurable retention window (default 7 days, up to 30+). Restores create a new project; you then switch DNS/connection strings.
- **Scheduled logical backups (pg_dump via cron/edge function)** — can be implemented on the free tier. Must include `public` schema and `auth` schema. Must be stored off-platform (e.g., S3, R2, Supabase Storage in a different project). Must be tested with a full restore drill.

**This is the single item that has to change.** Until it does, data loss is irreversible.

---

## If Data Is Lost Today — What You CAN Do

There is no restore command. The options are limited and manual:

### 1. Stop Further Writes Immediately
| Action | How |
|--------|-----|
| **Stop all deploys** | GitHub Actions → `deploy` workflow → "Disable workflow" or remove `VERCEL_DEPLOY_HOOK_URL` secret |
| **Stop the cron Worker** | Cloudflare Dashboard → Workers → `cron` → "Pause" or delete its `CRON_TRIGGER` binding |
| **Pause other Workers that write** | `billing` (Stripe webhooks), `ingest` (email), `ai`/`parse` (if they have write paths) |

Do not run `supabase db reset`, `supabase migration up`, or any DDL against production.

### 2. Bound the Damage
| Source | Check |
|--------|-------|
| **Last applied migration** | `SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;` in Supabase SQL Editor |
| **Row count gaps** | `SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup;` — compare to expected |
| **Stripe webhook ledger** | `SELECT * FROM public.stripe_events ORDER BY received_at DESC LIMIT 20;` |
| **Deploy log** | GitHub Actions → `deploy-supabase` job log shows exact migration timestamps |

### 3. Check Whether Data Can Be Reconstructed
| Lost Data | Reconstruction Source |
|-----------|----------------------|
| `shidduchim`, `singles`, `references` | Base tables intact? Query them. Views (`shidduchim_summary`, `references_summary`) are derived. |
| `stripe_events` | Stripe Dashboard → Webhooks → "Resend" for missing events, or API `GET /v1/events` |
| `inbox_items` | Resend API `GET /emails`, email provider logs, Inbucket (local dev only) |
| `cron_heartbeat` | Re-insert: `INSERT INTO cron_heartbeat (worker, last_run_at, last_ok_at) VALUES ('cron', now(), now());` |
| `ai_parse_attempts` | Re-process from `inbox_items.attachments` via workers/parse |
| `auth.users` | **Cannot reconstruct** — requires PITR or backup |

### 4. Accept the Loss
If the data is not in the sources above, **it is gone**. Document what was lost, why it could not be recovered, and what the launch-blocker decision was at the time.

---

## Prevention — The Only Real Protection

With no backups, **prevention is not a best practice — it is the only thing standing between a bad migration and permanent loss.**

### The Empty-Table Trap (AGENTS.md)

Migrations in this project are **only ever tested against an EMPTY database** (`supabase db reset` applies to empty, seeds after). This project has **already destroyed production data twice** this way:
- `20260729095558_backfill_member_state.sql` — shipped; blanked production
- `20260730011428_shidduch_overview_fields.sql` — caught at pre-flight

No other gate runs migrations against a non-empty table. `db diff` compares shapes only. Typecheck, lint, unit tests — none of them catch data destruction.

### The Gate That Catches It: `make check-migration-safety`

This command (driver: `scripts/check-migration-data-safety.mjs`, fixtures: `supabase/tests/migration-data-safety/`) is the **only gate that tests migrations against production-shaped data**.

| Phase | Action | What It Catches |
|-------|--------|-----------------|
| **1. reset** | `supabase db reset --version <baseline> --no-seed` | Brings stack to **last deployed migration** (production schema), empty |
| **2. seed** | Runs `fixture.sql` | Seeds **production-shaped rows** into every table, snapshots them |
| **3. apply** | `supabase migration up --local` | Applies **only the pending migrations** (not yet deployed) |
| **4. assert** | Runs `declared-moves.sql` then `assert.sql` | **Fails if**: any seeded row deleted, any surviving column value changed, any dropped column held data without a verified destination |

**Run it before every push:**
```bash
make check-migration-safety
```

If it passes, the pending migrations are safe to deploy. If it fails, read the banner — `assert` phase means **data destruction**, other phases mean **setup/test harness problems**.

### The Fix Shape Is Always the Same

`db diff` will **never** generate the correct fix. The pattern that survives `check-migration-safety`:

```sql
-- 1. ADD the new column FIRST (nullable, or with a safe default)
ALTER TABLE public.shidduchim ADD COLUMN new_overview text;

-- 2. BACKFILL it from surviving data (fail-closed: if source is NULL, do not guess)
UPDATE public.shidduchim
SET new_overview = father_en || ' & ' || mother_en
WHERE father_en IS NOT NULL AND mother_en IS NOT NULL;

-- 3. ASSERT the backfill covered everything that matters
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

### Declare Intentional Losses

If a column **genuinely** held no production data and you intend to drop it:

```sql
-- In supabase/tests/migration-data-safety/declared-moves.sql
INSERT INTO migration_guard.discarded_columns (table_name, column_name, reason)
VALUES ('shidduchim', 'obsolete_column', 'Never written by any code path; added in migration X, never used');
```

> **Do not use `discarded_columns` for columns that might have data.** Back the belief with a fail-closed assertion inside the migration so a wrong belief halts the deploy instead of erasing production.

---

## The Reframing

**With no backups, `make check-migration-safety` is not merely a gate — it is the ONLY thing standing between a bad migration and permanent loss.**

Every migration that touches existing columns or drops anything must pass this guard. There is no safety net below it.

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