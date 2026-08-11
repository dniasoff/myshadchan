# Database Restore Runbook

**Status:** Active
**Last Updated:** 2026-08-11
**Story:** 15.5 (NFR-8 Operational Runbooks)
**Related:** S19 (Epic 15 unowned-work ledger)

---

## ✅ THERE IS A BACKUP — nightly, off-platform, never yet restored

`.github/workflows/backup.yml` dumps the production database every night at
03:00 UTC and uploads it to Cloudflare R2, bucket `myshadchan-db-backups`,
under a timestamped prefix. Thirty days are retained; older prefixes are
pruned by the same job.

Three gzipped files per run, which is Supabase's documented restore shape:

| file | what it is |
| --- | --- |
| `roles.sql.gz` | role definitions — restore FIRST |
| `schema.sql.gz` | DDL — restore SECOND |
| `data.sql.gz` | rows — restore LAST |

A data-only dump cannot be restored without the roles and schema that precede
it. Take all three from the same prefix; never mix prefixes.

First successful run: 2026-08-11T01:48Z (schema 57,523 bytes, data 19,588
bytes, roles 187 bytes, gzipped).

### What is still NOT true

- **No restore has ever been performed.** The recovery *path* exists; the
  recovery *time* is unmeasured. Story 15.5 wanted an RTO figure and could not
  have one while there was nothing to restore from. There is now — so the
  drill is worth doing before it is needed rather than during.
- **The nightly schedule is not yet confirmed.** Every successful run so far
  was triggered by hand. To check, look for a run whose event is `schedule`:
  `gh run list --workflow=backup.yml`. If only `workflow_dispatch` runs ever
  appear, the cron is not firing and this is a manual tool wearing a schedule.
- **Point-in-Time Recovery is still off.** This is the Supabase free tier, so
  recovery granularity is one day, not one moment. Anything written since the
  last nightly run is still lost.

### To restore

1. Pick a prefix from R2 and download all three files.
2. `gunzip` them.
3. Apply in order: `roles.sql`, then `schema.sql`, then `data.sql`.
4. Verify before declaring success — count rows in `singles`, `shidduchim` and
   `accounts` and compare against what the dump claimed.

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