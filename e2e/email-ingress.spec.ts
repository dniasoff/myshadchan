import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";
import { test, expect, APP_URL } from "./fixtures";

/**
 * Story 10.3 (AC 1, AC 4) — the phone-less capture path, driven end to end
 * against the real local stack: the real `postmark` Edge Function, the real
 * database, the real Storage bucket, and the real Inbox UI.
 *
 * Why this exists at all: before this story the inbound-email webhook had
 * never once been exercised by an automated test that crossed a process
 * boundary. `postmark/index.test.ts` (Task 3) mocks `supabaseAdmin` and is
 * precise about branches, but by construction it cannot catch a broken
 * bucket policy, a signed URL pointing at an unreachable host (review
 * finding F8 — exactly that, and it was real), or an attachment that is
 * captured but reachable from no Inbox surface (Task 5 — also real: neither
 * surface rendered `attachments` at all). Those are the failures this spec
 * exists for, and each of them is invisible to a mocked test.
 *
 * The byte comparison at the end is AC 1's literal wording — "the file
 * byte-identical to what was sent ... in the e2e by fetching the stored
 * attachment's `src` and comparing bytes". Asserting only that a link is
 * present would pass against an empty or truncated object.
 */

const SUPABASE_URL = supabaseUrlFromEnv(process.env);
const POSTMARK_URL = `${SUPABASE_URL}/functions/v1/postmark`;

// `supabase/functions/.env`'s local values (the Edge Runtime reads that file
// for every stack). Overridable so this spec keeps working if those local
// credentials are ever rotated, without editing the spec.
const WEBHOOK_USER = process.env.POSTMARK_WEBHOOK_USER ?? "testuser";
const WEBHOOK_PASSWORD = process.env.POSTMARK_WEBHOOK_PASSWORD ?? "testpwd";
// One of POSTMARK_WEBHOOK_AUTHORIZED_IPS — Postmark's own published webhook
// source list; `checkRequestTypeAndHeaders` refuses anything else with a 401.
const AUTHORIZED_IP = "3.134.147.250";
// If this matches the function's own VITE_INBOUND_EMAIL the forwarding-strip
// branch runs; if it does not, it is skipped. The assertions below hold
// either way — `stripForwardingHeaderBlock` returns the original text when it
// finds no forwarding pattern, and the subject carries no "Fwd:" prefix to
// strip — so this spec does not depend on that one env var being in sync.
const INBOUND_EMAIL =
  process.env.VITE_INBOUND_EMAIL ??
  "2aff30e603e54dc3eb556bd9e03ee099@inbound.postmarkapp.com";

const ATTACHMENT_NAME = "redt.txt";
const ATTACHMENT_BODY = "Chaim Gold, 24, Lakewood. Ask the Rosh Yeshiva.";
const ATTACHMENT_BASE64 = Buffer.from(ATTACHMENT_BODY, "utf8").toString(
  "base64",
);
const SUBJECT = "Redt for Shaindy";

test("a forwarded email with an attachment reaches the Inbox with the file intact", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  // Arrange — a known member with a household account. `createSingle`
  // provisions the account (kind defaults to 'household', 01_tables.sql:202)
  // and the parent_admin membership, which is what
  // `resolveHouseholdAccountIdForMemberEmail` resolves the capture into.
  const email = `ingress-${Date.now()}@test.local`;
  const member = await createMember({
    first_name: "Rivka",
    last_name: "Klein",
    email,
  });
  await createSingle({ member, first_name_en: "Shaindy" });

  // Act — exactly the payload shape postmark/index.ts's own docstring
  // documents, posted as Postmark itself would post it.
  const webhookResponse = await fetch(POSTMARK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": AUTHORIZED_IP,
      Authorization: `Basic ${Buffer.from(
        `${WEBHOOK_USER}:${WEBHOOK_PASSWORD}`,
      ).toString("base64")}`,
    },
    body: JSON.stringify({
      FromFull: { Email: email, Name: "Rivka Klein" },
      ToFull: [{ Email: INBOUND_EMAIL }],
      Subject: SUBJECT,
      TextBody: "Sending this one over — looks like a good fit.",
      Attachments: [
        {
          Name: ATTACHMENT_NAME,
          Content: ATTACHMENT_BASE64,
          ContentType: "text/plain",
          ContentLength: ATTACHMENT_BODY.length,
        },
      ],
    }),
  });

  expect(
    webhookResponse.status,
    `postmark webhook rejected the forward: ${await webhookResponse
      .clone()
      .text()}`,
  ).toBe(200);

  // Assert — through the app the member actually uses, not the database.
  await signIn(page, email);
  await page.goto(`${APP_URL}/#/inbox_items`);

  // The card itself (InboxList.tsx), carrying Task 5's paperclip chip: the
  // attachment is visible as a preview before the item is ever opened.
  const card = page.getByRole("button", { name: new RegExp(SUBJECT) });
  await expect(card).toBeVisible();
  await expect(card).toContainText(ATTACHMENT_NAME);

  // Opening the item makes the attachment genuinely reachable
  // (InboxResolveDialog.tsx) — a link, because `src` is a signed, expiring
  // URL (AD-9), never an inline preview.
  await card.click();
  const attachmentLink = page.getByRole("link", { name: ATTACHMENT_NAME });
  await expect(attachmentLink).toBeVisible();

  const src = await attachmentLink.getAttribute("href");
  expect(src, "the attachment link must carry an href").toBeTruthy();

  // AC 1's byte comparison. Also the only assertion that would have caught
  // review finding F8: before that fix `src` pointed at stack 0's port, so
  // this fetch fails outright on any STACK_ID != 0.
  const storedResponse = await fetch(src!);
  expect(
    storedResponse.status,
    `the stored attachment was not fetchable at ${src}`,
  ).toBe(200);

  const storedBytes = Buffer.from(await storedResponse.arrayBuffer());
  expect(storedBytes.equals(Buffer.from(ATTACHMENT_BODY, "utf8"))).toBe(true);
});
