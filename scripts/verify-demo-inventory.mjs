// Non-destructive check that the deployed seed still builds the demo the
// activation gate is written against.
//
// The full acceptance harness (hosted-demo-smoke.mjs) finishes by proving the
// whole project is empty, so it can only run against a project nobody is
// using. Once the product has a single real account — which is the normal
// case — that check can never pass, and the lifecycle stops being verifiable
// at exactly the point it starts to matter.
//
// This is the other half: it creates its own disposable user, seeds, reads the
// manifest back, clears, and removes only the rows it made. It asserts nothing
// about the rest of the project, so it is safe to run against a live one, and
// it fails loudly if it would touch an account that predates it.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/verify-demo-inventory.mjs
//
// It found two real production defects the unit suites could not: a duplicate
// active membership when the second parent was both provisioned and invited,
// and a reference to a variable deleted with the two-party discussion.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, svc, { auth: { persistSession: false } });

const EXPECTED = {
  invite: 3,
  listing: 1,
  listing_withdrawal: 1,
  share_link: 1,
  task: 1,
  share_access_log: 1,
  inbox_item: 1,
  analytics_event: 3,
  task_notification: 1,
  trusted_sender: 2,
  single_preference: 2,
  single_note: 2,
};
const FORBIDDEN = [
  "connection",
  "connection_invite",
  "child_grant",
  "thread",
  "message",
  "message_notification",
];

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " " + detail : ""}`);
  if (ok) pass += 1;
  else fail += 1;
};

const preAccounts = (await admin.from("accounts").select("id")).data.map(
  (r) => r.id,
);
const email = `verify-st-${randomUUID().replaceAll("-", "")}@example.invalid`;
const password = `Verify-${randomUUID()}-9!aA`;
const { data: created, error: ce } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (ce) throw ce;
const userId = created.user.id;
let runId = null,
  rootAccountId = null;

try {
  const cli = createClient(url, anon, { auth: { persistSession: false } });
  const { error: se } = await cli.auth.signInWithPassword({ email, password });
  if (se) throw se;
  await cli.rpc("prepare_demo_onboarding");
  await cli.rpc("add_persona", { p_persona: "parent" });
  const ctx = (await cli.rpc("my_contexts")).data ?? [];
  rootAccountId = ctx.find((c) => c.is_active)?.account_id;
  check(
    "onboarding creates exactly one context",
    ctx.length === 1,
    `contexts=${ctx.length}`,
  );

  const seed = await cli.functions.invoke("seed_demo", { method: "POST" });
  if (seed.error) {
    const body = await seed.error.context?.text?.().catch(() => null);
    throw new Error(
      `seed failed: ${seed.error.context?.status} ${(body || "").slice(0, 300)}`,
    );
  }
  check(
    "seed reports a one-context bundle",
    seed.data?.bundle?.contexts === 1,
    `contexts=${seed.data?.bundle?.contexts}`,
  );
  runId = Number(seed.data.bundle.runId);

  const accounts =
    (
      await admin
        .from("demo_run_accounts")
        .select("context_key,context_kind,is_root")
        .eq("run_id", runId)
    ).data ?? [];
  check(
    "manifest holds one root household",
    accounts.length === 1 &&
      accounts[0].context_key === "primary-household" &&
      accounts[0].is_root === true,
    `accounts=${accounts.length}`,
  );

  const res =
    (
      await admin
        .from("demo_run_resources")
        .select("resource_type")
        .eq("run_id", runId)
    ).data ?? [];
  const byType = res.reduce(
    (a, r) => ((a[r.resource_type] = (a[r.resource_type] ?? 0) + 1), a),
    {},
  );
  check(
    "manifest total is 19",
    res.length === 19,
    `total=${res.length} ${JSON.stringify(byType)}`,
  );
  for (const [t, n] of Object.entries(EXPECTED))
    check(`  ${t} = ${n}`, (byType[t] ?? 0) === n, `got=${byType[t] ?? 0}`);
  for (const t of FORBIDDEN)
    check(`  ${t} absent`, !(t in byType), `got=${byType[t] ?? 0}`);

  const storage =
    (await admin.from("demo_run_storage").select("bucket").eq("run_id", runId))
      .data ?? [];
  check(
    "storage is 50 objects",
    storage.length === 50,
    `got=${storage.length}`,
  );

  const actors =
    (await admin.from("demo_run_users").select("actor_key").eq("run_id", runId))
      .data ?? [];
  check(
    "two synthetic actors, both Kleins",
    actors.length === 2 &&
      actors.every((a) => ["dovid-klein", "sarah-klein"].includes(a.actor_key)),
    JSON.stringify(actors.map((a) => a.actor_key)),
  );

  const clear = await cli.functions.invoke("clear_demo", {
    method: "POST",
    body: { releaseDemoFlag: true },
  });
  check(
    "clear succeeds",
    !clear.error && clear.data?.cleared === true,
    JSON.stringify(clear.data ?? clear.error?.message),
  );
  const rootGone =
    (
      (await admin.from("accounts").select("id").eq("id", rootAccountId))
        .data ?? []
    ).length === 0;
  check("the demo root is deleted, not stranded", rootGone);
} finally {
  // Remove only what this run made; never anything that predates it.
  const mine = ((await admin.from("accounts").select("id")).data ?? [])
    .map((r) => r.id)
    .filter((id) => !preAccounts.includes(id));
  for (const id of mine) {
    await admin.from("account_members").delete().eq("account_id", id);
    await admin.from("accounts").delete().eq("id", id);
  }
  await admin.from("demo_clear_receipts").delete().eq("user_id", userId);
  await admin.from("member_state").delete().eq("user_id", userId);
  await admin.from("members").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
  const post = ((await admin.from("accounts").select("id")).data ?? []).map(
    (r) => r.id,
  );
  check(
    "pre-existing accounts untouched",
    JSON.stringify(post.sort()) === JSON.stringify([...preAccounts].sort()),
    `before=${preAccounts.length} after=${post.length}`,
  );
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
