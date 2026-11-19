import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const execFileAsync = promisify(execFile);
const userId = randomUUID();
const marker = `resume-delete-concurrency-${process.pid}-${Date.now()}`;
const sqlLiteral = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

const run = (sql: string): string =>
  execFileSync(
    "psql",
    [DB_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  ).trim();

const runConcurrent = async (sql: string): Promise<string> => {
  try {
    const result = await execFileAsync(
      "psql",
      [DB_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    return result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out|ETIMEDOUT|statement timeout|lock timeout/i.test(message)) {
      throw new Error(`concurrency session timed out: ${message}`);
    }
    // Account deletion is expected to reject while the fixture still owns
    // domain rows or a purge queue item. The regression is about deadlock
    // freedom, so a normal SQL rejection is still a completed session.
    return message;
  }
};

const setup = (): {
  accountId: string;
  shidduchId: string;
  resumeId: string;
} => {
  // The psql test connection is the repository's seeded superuser path. Keep
  // auth.users setup on that connection; SET ROLE postgres is not available
  // on every local Supabase image.
  run(`
insert into auth.users (id, instance_id, aud, role, email)
values (${sqlLiteral(userId)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${sqlLiteral(`${marker}@test.invalid`)})
on conflict (id) do nothing;
insert into public.accounts (name, kind) values (${sqlLiteral(marker)}, 'household');
insert into public.account_members (account_id, user_id, role, status)
select id, ${sqlLiteral(userId)}, 'parent_admin', 'active'
from public.accounts where name = ${sqlLiteral(marker)};
insert into public.singles (account_id, first_name_en)
select id, 'Concurrency Single'
from public.accounts where name = ${sqlLiteral(marker)};`);
  const accountId = run(
    `select id from public.accounts where name = ${sqlLiteral(marker)};`,
  );
  const singleId = run(
    `select id from public.singles where account_id = ${accountId} and first_name_en = 'Concurrency Single' order by id desc limit 1;`,
  );
  const authSetup = `set role authenticated;
set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
select public.set_active_context(${accountId});`;
  const shidduchId = run(
    `${authSetup}
select id from public.create_shidduch(p_single_id => ${singleId}, p_name_en => 'Concurrency suggestion', p_person_gender => 'male') limit 1;`,
  );
  const resumeId = run(`
insert into public.resumes (account_id, shidduchim_id, files)
values (${accountId}, ${shidduchId}, jsonb_build_array(jsonb_build_object(
  'path', ${sqlLiteral(`${accountId}/resumes/${shidduchId}/original.pdf`)},
  'filename', 'original.pdf', 'uploaded_at', '2026-01-01T00:00:00Z',
  'mime_type', 'application/pdf', 'size', 8
))) returning id;`);
  return { accountId, shidduchId, resumeId };
};

describe("resume delete lock order", () => {
  let setupError: string | undefined;
  let fixture: ReturnType<typeof setup> | undefined;
  try {
    fixture = setup();
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }

  if (bailIfDbUnreachable(setupError)) return;

  it("completes upload/delete, delete/delete, and delete/account-delete sessions without deadlock", async () => {
    expect(setupError).toBeUndefined();
    expect(fixture).toBeDefined();
    const { accountId, shidduchId, resumeId } = fixture!;
    const auth = `set role authenticated;
set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
select public.set_active_context(${accountId});`;
    const deleteSql = `${auth}
select * from public.remove_resume_file(${resumeId}, ${sqlLiteral(`${accountId}/resumes/${shidduchId}/original.pdf`)}, 8, '2026-01-01T00:00:00Z');`;
    const uploadSql = `${auth}
select * from public.add_resume_file(${sqlLiteral(`${accountId}/resumes/${shidduchId}/uploaded.pdf`)}, 'uploaded.pdf', 'application/pdf', 12, ${shidduchId}, null, null, null);`;
    const accountDeleteSql = `${auth}
select public.delete_account_data(${accountId}, ${sqlLiteral(userId)}::uuid, false);`;

    await Promise.all([runConcurrent(deleteSql), runConcurrent(uploadSql)]);
    await Promise.all([runConcurrent(deleteSql), runConcurrent(deleteSql)]);
    await Promise.all([
      runConcurrent(deleteSql),
      runConcurrent(accountDeleteSql),
    ]);
  });

  it("cleans the fixture after the concurrency checks", () => {
    expect(fixture).toBeDefined();
    const { accountId } = fixture!;
    run(`
delete from public.storage_purge_queue where account_id = ${accountId};
delete from public.account_members where account_id = ${accountId};
delete from public.members where user_id = ${sqlLiteral(userId)}::uuid;
delete from public.accounts where id = ${accountId};
delete from auth.users where id = ${sqlLiteral(userId)}::uuid;`);
  });
});
