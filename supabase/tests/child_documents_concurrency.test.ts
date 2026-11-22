import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const execFileAsync = promisify(execFile);
const enabled =
  process.env.RUN_DB_RACE_TESTS === "1" || Boolean(process.env.CI);
const userId = randomUUID();
const marker = `child-documents-race-${process.pid}-${Date.now()}`;
const sqlLiteral = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

const run = (sql: string): string =>
  execFileSync(
    "psql",
    [DB_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8", timeout: 10_000 },
  ).trim();

async function runConcurrent(
  sql: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await execFileAsync(
      "psql",
      [DB_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    return { ok: true, output: result.stdout };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /timed out|ETIMEDOUT|statement timeout|lock timeout|deadlock/i.test(
        message,
      )
    ) {
      throw new Error(
        `child document race session did not complete: ${message}`,
      );
    }
    return { ok: false, output: message };
  }
}

describe("child document slot race (opt-in)", () => {
  if (!enabled) {
    if (process.env.CI) {
      throw new Error("child documents race test must run in CI");
    }
    it.skip("set RUN_DB_RACE_TESTS=1 to run the two-session database race", () => {});
    return;
  }

  let accountId: string;
  let singleId: string;
  let setupError: string | undefined;
  try {
    run(`
insert into auth.users (id, instance_id, aud, role, email)
values (${sqlLiteral(userId)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${sqlLiteral(`${marker}@test.invalid`)})
on conflict (id) do nothing;
insert into public.accounts (name, kind) values (${sqlLiteral(marker)}, 'household');
insert into public.account_members (account_id, user_id, role, status)
select id, ${sqlLiteral(userId)}, 'parent_admin', 'active'
from public.accounts where name = ${sqlLiteral(marker)};
insert into public.singles (account_id, first_name_en, gender)
select id, 'Race Single', 'female'
from public.accounts where name = ${sqlLiteral(marker)};`);
    accountId = run(
      `select id from public.accounts where name = ${sqlLiteral(marker)};`,
    );
    singleId = run(
      `select id from public.singles where account_id = ${accountId} and first_name_en = 'Race Single';`,
    );
    run(`
insert into public.entity_files (account_id, target_type, target_id, storage_path, file_name, mime_type, size_bytes, visibility, slot)
values (${accountId}, 'single', ${singleId}, ${sqlLiteral(`${accountId}/single/${singleId}/paper-1.pdf`)}, 'paper-1.pdf', 'application/pdf', 10, 'private_parent', 'paper_1');`);
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }

  if (bailIfDbUnreachable(setupError)) return;

  it("never commits more than the two paper slots without using a sleep", async () => {
    expect(setupError).toBeUndefined();
    const auth = `set role authenticated;
set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
select public.set_active_context(${accountId});`;
    const insert = `${auth}
insert into public.entity_files (account_id, target_type, target_id, storage_path, file_name, mime_type, size_bytes, visibility, slot)
values (${accountId}, 'single', ${singleId}, ${sqlLiteral(`${accountId}/single/${singleId}/paper-2-${randomUUID()}.pdf`)}, 'paper-2.pdf', 'application/pdf', 10, 'private_parent', 'paper_2');`;
    const results = await Promise.all([
      runConcurrent(insert),
      runConcurrent(insert),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      Number(
        run(
          `select count(*) from public.entity_files where account_id = ${accountId} and target_type = 'single' and target_id = ${singleId} and slot is not null and deleted_at is null;`,
        ),
      ),
    ).toBe(2);
  });

  it("cleans the race fixture", () => {
    run(`
delete from public.entity_files where account_id = ${accountId};
delete from public.account_members where account_id = ${accountId};
delete from public.members where user_id = ${sqlLiteral(userId)}::uuid;
delete from public.accounts where id = ${accountId};
delete from auth.users where id = ${sqlLiteral(userId)}::uuid;`);
  });
});
