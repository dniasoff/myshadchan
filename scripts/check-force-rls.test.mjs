import { describe, expect, test } from "vitest";
import { runForceRlsCheck } from "./check-force-rls.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

describe("check-force-rls", () => {
  test("passes when every RLS-enabled table has FORCE RLS", () => {
    const testDir = path.join(tmpdir(), `force-rls-pass-${Date.now()}`);
    mkdirSync(path.join(testDir, "supabase/schemas"), { recursive: true });

    writeFileSync(
      path.join(testDir, "supabase/schemas/01_tables.sql"),
      `create table public.accounts (id bigint primary key);
create table public.members (id bigint primary key);
create table public.configuration (id int primary key);`,
    );

    writeFileSync(
      path.join(testDir, "supabase/schemas/05_policies.sql"),
      `alter table public.accounts enable row level security;
alter table public.accounts force row level security;
alter table public.members enable row level security;
alter table public.members force row level security;
alter table public.configuration enable row level security;
alter table public.configuration force row level security;`,
    );

    const result = runForceRlsCheck(testDir);
    expect(result.failures).toEqual([]);
    expect(result.missingForceRls).toEqual([]);

    rmSync(testDir, { recursive: true, force: true });
  });

  test("fails when a table has RLS enabled but NOT force row level security", () => {
    const testDir = path.join(tmpdir(), `force-rls-fail-${Date.now()}`);
    mkdirSync(path.join(testDir, "supabase/schemas"), { recursive: true });

    writeFileSync(
      path.join(testDir, "supabase/schemas/01_tables.sql"),
      `create table public.accounts (id bigint primary key);
create table public.members (id bigint primary key);
create table public.configuration (id int primary key);`,
    );

    // Deliberately missing FORCE RLS on 'members' and 'configuration'
    writeFileSync(
      path.join(testDir, "supabase/schemas/05_policies.sql"),
      `alter table public.accounts enable row level security;
alter table public.accounts force row level security;
alter table public.members enable row level security;
alter table public.configuration enable row level security;`,
    );

    const result = runForceRlsCheck(testDir);
    expect(result.failures.length).toBe(1);
    expect(result.missingForceRls).toContain("members");
    expect(result.missingForceRls).toContain("configuration");
    expect(result.missingForceRls).not.toContain("accounts");

    rmSync(testDir, { recursive: true, force: true });
  });

  test('handles quoted table names (e.g., public."references")', () => {
    const testDir = path.join(tmpdir(), `force-rls-quoted-${Date.now()}`);
    mkdirSync(path.join(testDir, "supabase/schemas"), { recursive: true });

    writeFileSync(
      path.join(testDir, "supabase/schemas/01_tables.sql"),
      `create table public."references" (id bigint primary key);
create table public.accounts (id bigint primary key);`,
    );

    writeFileSync(
      path.join(testDir, "supabase/schemas/05_policies.sql"),
      `alter table public."references" enable row level security;
alter table public."references" force row level security;
alter table public.accounts enable row level security;
alter table public.accounts force row level security;`,
    );

    const result = runForceRlsCheck(testDir);
    expect(result.failures).toEqual([]);
    expect(result.tablesWithRls).toContain("references");
    expect(result.tablesWithForceRls).toContain("references");

    rmSync(testDir, { recursive: true, force: true });
  });

  test("ignores tables without RLS (they are not required to have FORCE RLS)", () => {
    const testDir = path.join(tmpdir(), `force-rls-no-rls-${Date.now()}`);
    mkdirSync(path.join(testDir, "supabase/schemas"), { recursive: true });

    writeFileSync(
      path.join(testDir, "supabase/schemas/01_tables.sql"),
      `create table public.accounts (id bigint primary key);
create table public.logs (id bigint primary key);`,
    );

    // Only 'accounts' has RLS; 'logs' has none
    writeFileSync(
      path.join(testDir, "supabase/schemas/05_policies.sql"),
      `alter table public.accounts enable row level security;
alter table public.accounts force row level security;`,
    );

    const result = runForceRlsCheck(testDir);
    expect(result.failures).toEqual([]);
    expect(result.missingForceRls).toEqual([]);
    expect(result.tablesWithRls).toEqual(["accounts"]);
    expect(result.tablesWithForceRls).toEqual(["accounts"]);

    rmSync(testDir, { recursive: true, force: true });
  });
});
