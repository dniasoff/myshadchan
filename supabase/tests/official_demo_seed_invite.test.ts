import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.join(testDirectory, "../schemas/02_functions.sql");
const migrationFile = path.join(
  testDirectory,
  "../migrations/20260823182000_official_demo_seed_invite_service_path.sql",
);
const source = readFileSync(schemaFile, "utf8");
const migration = readFileSync(migrationFile, "utf8");
const expectedGuard =
  "demo invite acceptance requires the exact seed service lease";
const expectedInviteError =
  "This invite is invalid, expired, or has already been used.";
const expectedPersonaFence =
  "persona changes are unavailable while the official demo is active";

function functionBody(definition: string): string {
  const start = Math.max(
    definition.indexOf(
      'CREATE OR REPLACE FUNCTION "public"."accept_demo_invite"',
    ),
    definition.indexOf("CREATE OR REPLACE FUNCTION public.accept_demo_invite"),
  );
  if (start < 0) throw new Error("accept_demo_invite is missing");
  const asMatch = definition.slice(start).match(/\n\s*AS\s+(\$\w*\$|\$\$)\n/);
  if (!asMatch || asMatch.index === undefined) {
    throw new Error("accept_demo_invite has no SQL body");
  }
  const bodyStart = start + asMatch.index + asMatch[0].length;
  const bodyEnd = definition.indexOf(`\n${asMatch[1]}`, bodyStart);
  if (bodyEnd < 0) throw new Error("accept_demo_invite body is unterminated");
  return definition.slice(bodyStart, bodyEnd).trimEnd();
}

let executionError: string | undefined;
try {
  execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", DB_URL], {
    env: { ...process.env, PGPASSWORD: "postgres" },
    input: `begin;
\\i '${migrationFile}'
do $$
begin
begin
  perform public.accept_demo_invite(
    -1,
    'x',
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000'
  );
  raise exception 'accept_demo_invite unexpectedly succeeded';
exception when others then
  if sqlerrm <> '${expectedGuard}' then raise; end if;
end;
end;
$$;

do $$
declare
v_actor uuid := 'a8200000-0000-0000-0000-000000000001';
v_success_token uuid := 'a8200000-0000-0000-0000-000000000002';
v_fenced_token uuid := 'a8200000-0000-0000-0000-000000000003';
v_archived_token uuid := 'a8200000-0000-0000-0000-000000000004';
v_expired_token uuid := 'a8200000-0000-0000-0000-000000000005';
v_lease text := 'stack2-official-demo-seed-lease';
v_run_id bigint;
v_source_account bigint;
v_target_account bigint;
v_archived_account bigint;
v_expired_account bigint;
v_archived_membership_id bigint;
v_archived_accepted_at timestamptz := now() - interval '1 minute';
v_membership_count integer;
begin
insert into auth.users (id, instance_id, aud, role, email)
values (
  v_actor,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'seed-invite-actor@test.local'
);

insert into public.accounts (name, kind)
values ('Stack 2 Seed Invite Root', 'household')
returning id into v_source_account;
insert into public.accounts (name, kind)
values ('Stack 2 Seed Invite Gross', 'household')
returning id into v_target_account;

insert into public.demo_runs (
  root_account_id,
  status,
  seed_version,
  lease_epoch,
  lease_expires_at,
  lease_token,
  operation
) values (
  v_source_account,
  'seeding',
  'official-demo-transactional-invite-test',
  1,
  now() + interval '5 minutes',
  v_lease,
  'seed'
) returning id into v_run_id;

insert into public.demo_run_accounts (
  run_id, account_id, context_key, context_kind, is_root
) values
  (v_run_id, v_source_account, 'primary-household', 'household', true),
  (v_run_id, v_target_account, 'gross-household', 'household', false);

insert into public.demo_run_users (run_id, user_id, actor_key, email_domain)
values (v_run_id, v_actor, 'miriam-gross', 'invalid');

-- The actor already belongs to one demo context. The service path must be
-- able to add the exact second membership without weakening the global
-- authenticated persona-mutation fence.
insert into public.account_members (account_id, user_id, role, status)
values (v_source_account, v_actor, 'helper', 'active');

insert into public.invites (
  token, email, account_id, role, invited_by, status
) values (
  v_success_token,
  'seed-invite-actor@test.local',
  v_target_account,
  'helper',
  null,
  'pending'
);

-- A service call without headers is still rejected, even with the service
-- role and all of the otherwise valid run/actor/invite records present.
perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
perform set_config('request.headers', '{}', true);
begin
  perform public.accept_demo_invite(
    v_run_id, v_lease, v_success_token, v_actor
  );
  raise exception 'missing lease unexpectedly succeeded';
exception when others then
  if sqlerrm <> '${expectedGuard}' then raise; end if;
end;

-- A marked request with the wrong lease is rejected before the invite is
-- read or mutated.
perform set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', v_run_id::text,
    'x-demo-lease-token', 'wrong-lease'
  )::text,
  true
);
begin
  perform public.accept_demo_invite(
    v_run_id, v_lease, v_success_token, v_actor
  );
  raise exception 'wrong lease unexpectedly succeeded';
exception when others then
  if sqlerrm <> '${expectedGuard}' then raise; end if;
end;

-- The exact live seeding lease authorizes only this service route. The
-- trigger on account_members remains installed and still sees the actor's
-- existing active demo membership, so this is the hosted failure boundary.
perform set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', v_run_id::text,
    'x-demo-lease-token', v_lease
  )::text,
  true
);
perform public.accept_demo_invite(
  v_run_id, v_lease, v_success_token, v_actor
);

if not exists (
  select 1 from public.invites
  where token = v_success_token and status = 'accepted'
) then
  raise exception 'service invite was not accepted';
end if;
select count(*) into v_membership_count
from public.account_members
where account_id = v_target_account and user_id = v_actor;
if v_membership_count <> 1 then
  raise exception 'service invite created % target memberships', v_membership_count;
end if;

insert into public.accounts (name, kind)
values ('Stack 2 Archived Membership Household', 'household')
returning id into v_archived_account;
insert into public.accounts (name, kind)
values ('Stack 2 Expired Invite Household', 'household')
returning id into v_expired_account;
insert into public.demo_run_accounts (
  run_id, account_id, context_key, context_kind, is_root
) values
  (v_run_id, v_archived_account, 'archived-household', 'household', false),
  (v_run_id, v_expired_account, 'expired-household', 'household', false);

-- An accepted invite with only an archived membership is not a successful
-- idempotent replay. The service path must fail closed and leave both rows
-- unchanged rather than treating the archived persona as active.
insert into public.account_members (account_id, user_id, role, status)
values (v_archived_account, v_actor, 'helper', 'archived')
returning id into v_archived_membership_id;
insert into public.invites (
  token, email, account_id, role, invited_by, status, accepted_at
) values (
  v_archived_token,
  'seed-invite-actor@test.local',
  v_archived_account,
  'helper',
  null,
  'accepted',
  v_archived_accepted_at
);
begin
  perform public.accept_demo_invite(
    v_run_id, v_lease, v_archived_token, v_actor
  );
  raise exception 'archived membership unexpectedly succeeded';
exception when others then
  if sqlerrm <> '${expectedInviteError}' then raise; end if;
end;
if not exists (
  select 1
  from public.invites
  where token = v_archived_token
    and status = 'accepted'
    and accepted_at = v_archived_accepted_at
) then
  raise exception 'archived membership replay changed the invite';
end if;
if not exists (
  select 1
  from public.account_members
  where id = v_archived_membership_id
    and status = 'archived'
) then
  raise exception 'archived membership replay changed the membership';
end if;
select count(*) into v_membership_count
from public.account_members
where account_id = v_archived_account
  and user_id = v_actor
  and status = 'active';
if v_membership_count <> 0 then
  raise exception 'archived membership replay created % active memberships', v_membership_count;
end if;

-- A pending invite that is expired by the time the transition runs must
-- not be accepted or create a membership.
insert into public.invites (
  token, email, account_id, role, invited_by, status, expires_at
) values (
  v_expired_token,
  'seed-invite-actor@test.local',
  v_expired_account,
  'helper',
  null,
  'pending',
  now() - interval '1 second'
);
begin
  perform public.accept_demo_invite(
    v_run_id, v_lease, v_expired_token, v_actor
  );
  raise exception 'expired invite unexpectedly succeeded';
exception when others then
  if sqlerrm <> '${expectedInviteError}' then raise; end if;
end;
if not exists (
  select 1
  from public.invites
  where token = v_expired_token
    and status = 'pending'
    and expires_at <= now()
) then
  raise exception 'expired invite was mutated';
end if;
select count(*) into v_membership_count
from public.account_members
where account_id = v_expired_account and user_id = v_actor;
if v_membership_count <> 0 then
  raise exception 'expired invite created % memberships', v_membership_count;
end if;

-- The ordinary browser route still fences this actor. Its failed statement
-- must leave the second invite pending and must not create another target
-- membership.
insert into public.invites (
  token, email, account_id, role, invited_by, status
) values (
  v_fenced_token,
  'seed-invite-actor@test.local',
  v_target_account,
  'helper',
  null,
  'pending'
);
perform set_config(
  'request.jwt.claims',
  json_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
  true
);
perform set_config('request.headers', '{}', true);
begin
  perform public.accept_invite(v_fenced_token);
  raise exception 'ordinary accept_invite unexpectedly succeeded';
exception when others then
  if sqlerrm <> '${expectedPersonaFence}' then raise; end if;
end;

if not exists (
  select 1 from public.invites
  where token = v_fenced_token and status = 'pending'
) then
  raise exception 'ordinary fenced invite was mutated';
end if;
select count(*) into v_membership_count
from public.account_members
where account_id = v_target_account and user_id = v_actor;
if v_membership_count <> 1 then
  raise exception 'ordinary fenced call changed target membership count to %', v_membership_count;
end if;
end;
$$;
rollback;
`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
} catch (error) {
  executionError = error instanceof Error ? error.message : String(error);
}

describe("official demo seed invite service path", () => {
  it("keeps the forward migration body identical to declarative SQL", () => {
    expect(functionBody(migration)).toBe(functionBody(source));
  });

  it("requires the exact service lease before touching an invite", () => {
    expect(source).toContain(expectedGuard);
    expect(source).toContain("demo_run_accounts");
    expect(source).toContain("demo_run_users");
    expect(source).toContain("demo_seed_service_authorized()");
  });

  it("requires an active idempotent membership and rechecks invite expiry atomically", () => {
    const body = functionBody(source);

    expect(body).toContain(
      "and user_id = p_actor_user_id\n      and status = 'active'",
    );
    expect(body).toContain("if v_invite.expires_at <= clock_timestamp()");
    expect(body).toContain(
      "and status = 'pending'\n    and expires_at > clock_timestamp()",
    );
  });

  if (bailIfDbUnreachable(executionError)) return;

  it("forces PostgreSQL to compile the service path and reject an unmarked call", () => {
    expect(executionError).toBeUndefined();
  });
});
