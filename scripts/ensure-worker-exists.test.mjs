import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  withoutRequiredSecretsTable,
  workerExists,
} from "./ensure-worker-exists.mjs";

const request = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const options = {
  accountId: "account-123",
  apiToken: "token-that-is-never-logged",
  workerName: "myshadchan-email",
  apiBase: "https://api.example.test",
};

describe("workerExists", () => {
  it("recognises an existing Worker and sends the account token", async () => {
    let requestUrl;
    let requestHeaders;
    const exists = await workerExists({
      ...options,
      fetchImpl: async (url, init) => {
        requestUrl = url;
        requestHeaders = init.headers;
        return request(200, {
          success: true,
          result: [{ id: "myshadchan-email", etag: "opaque" }],
        });
      },
    });

    expect(exists).toBe(true);
    expect(requestUrl).toBe(
      "https://api.example.test/accounts/account-123/workers/scripts",
    );
    expect(requestHeaders).toEqual({
      Accept: "application/json",
      Authorization: "Bearer token-that-is-never-logged",
    });
  });

  it("reports a missing Worker without treating an empty list as an error", async () => {
    await expect(
      workerExists({
        ...options,
        fetchImpl: async () => request(200, { success: true, result: [] }),
      }),
    ).resolves.toBe(false);
  });

  it("fails loudly on a Cloudflare API error without logging its body", async () => {
    await expect(
      workerExists({
        ...options,
        fetchImpl: async () =>
          request(500, {
            success: false,
            errors: [{ message: "provider-internal-secret" }],
          }),
      }),
    ).rejects.toThrow("Cloudflare Worker list API failed (HTTP 500)");
  });

  it("fails loudly on an authentication error", async () => {
    await expect(
      workerExists({
        ...options,
        fetchImpl: async () =>
          request(403, {
            success: false,
            errors: [{ message: "token is invalid" }],
          }),
      }),
    ).rejects.toThrow(
      "Cloudflare Worker list authentication/authorization failed (HTTP 403)",
    );
  });

  it("rejects a successful response with an invalid result shape", async () => {
    await expect(
      workerExists({
        ...options,
        fetchImpl: async () => request(200, { success: true, result: null }),
      }),
    ).rejects.toThrow("Cloudflare Worker list returned an invalid result");
  });
});

describe("withoutRequiredSecretsTable", () => {
  it("preserves committed fail-closed vars while removing only required secrets", () => {
    const bootstrap = withoutRequiredSecretsTable(`
name = "myshadchan-email"
[vars]
OUTBOUND_EMAIL_ENABLED = "false"
OUTBOUND_EMAIL_ACCOUNT_IDS = ""

[secrets]
required = ["RESEND_API_KEY"]
`);

    expect(bootstrap).toContain('OUTBOUND_EMAIL_ENABLED = "false"');
    expect(bootstrap).toContain('OUTBOUND_EMAIL_ACCOUNT_IDS = ""');
    expect(bootstrap).not.toContain("[secrets]");
    expect(bootstrap).not.toContain("RESEND_API_KEY");
  });

  it("keeps the committed email bootstrap fail-closed defaults", () => {
    const committedConfig = readFileSync(
      new URL("../workers/email/wrangler.toml", import.meta.url),
      "utf8",
    );
    const bootstrap = withoutRequiredSecretsTable(committedConfig);

    expect(bootstrap).toContain('OUTBOUND_EMAIL_ENABLED = "false"');
    expect(bootstrap).toContain('OUTBOUND_EMAIL_ACCOUNT_IDS = ""');
    expect(bootstrap).toContain('OUTBOUND_EMAIL_GLOBAL_DAILY_CAP = "40"');
    expect(bootstrap).not.toContain("[secrets]");
    expect(bootstrap).not.toContain("RESEND_API_KEY");
  });
});
