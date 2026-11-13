import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertBootstrapAllowed,
  SAFE_BOOTSTRAP_WORKERS,
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

const pageInfo = (page, totalPages) => ({
  page,
  per_page: 100,
  total_count: totalPages * 100,
  total_pages: totalPages,
});

function isTomlTableHeader(line) {
  const trimmed = line.trim();
  return (
    (trimmed.startsWith("[[") && trimmed.endsWith("]]")) ||
    (trimmed.startsWith("[") &&
      !trimmed.startsWith("[[") &&
      trimmed.endsWith("]"))
  );
}

function expectedBootstrapConfig(committed) {
  const lines = committed.split("\n");
  const secretsStart = lines.findIndex((line) => line.trim() === "[secrets]");
  const nextTable = lines.findIndex(
    (line, index) => index > secretsStart && isTomlTableHeader(line),
  );
  const secretsEnd = nextTable === -1 ? lines.length : nextTable;
  return lines
    .slice(0, secretsStart)
    .concat(lines.slice(secretsEnd))
    .join("\n");
}

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
          result_info: pageInfo(1, 1),
        });
      },
    });

    expect(exists).toBe(true);
    expect(String(requestUrl)).toBe(
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
        fetchImpl: async (url) =>
          String(url).includes("/myshadchan-email")
            ? new Response(null, { status: 404 })
            : request(200, { success: true, result: [] }),
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
            result_info: pageInfo(1, 1),
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
            result_info: pageInfo(1, 1),
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
        fetchImpl: async () =>
          request(200, {
            success: true,
            result: null,
            result_info: pageInfo(1, 1),
          }),
      }),
    ).rejects.toThrow("Cloudflare Worker list returned an invalid result");
  });

  it("fails closed when the fallback single-script lookup is unauthorized", async () => {
    await expect(
      workerExists({
        ...options,
        fetchImpl: async (url) =>
          String(url).includes("/myshadchan-email")
            ? new Response(null, { status: 403 })
            : request(200, { success: true, result: [] }),
      }),
    ).rejects.toThrow(
      "Cloudflare Worker lookup authentication/authorization failed (HTTP 403)",
    );
  });

  it("follows all result_info pages before declaring a Worker missing", async () => {
    const requestedPages = [];
    await expect(
      workerExists({
        ...options,
        fetchImpl: async (url) => {
          const page = new URL(url).searchParams.get("page") ?? "1";
          requestedPages.push(page);
          return request(200, {
            success: true,
            result:
              page === "2" ? [{ id: "myshadchan-email" }] : [{ id: "other" }],
            result_info: pageInfo(Number(page), 2),
          });
        },
      }),
    ).resolves.toBe(true);
    expect(requestedPages).toEqual(["1", "2"]);
  });

  it("fails closed when a list page is truncated or has incomplete pagination metadata", async () => {
    let page = 0;
    await expect(
      workerExists({
        ...options,
        fetchImpl: async (url) => {
          page += 1;
          if (page === 1) {
            return request(200, {
              success: true,
              result: [{ id: "other" }],
              result_info: { page: 1, total_pages: 2 },
            });
          }
          expect(String(url)).toContain("page=2");
          return request(200, { success: true, result: [{ id: "other" }] });
        },
      }),
    ).rejects.toThrow(
      "Cloudflare Worker list returned partial pagination data",
    );
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

  it.each(["ai", "parse", "cron", "billing", "ingest", "match", "share"])(
    "refuses to bootstrap %s because it has no safe default-off gate",
    (worker) => {
      expect(() => assertBootstrapAllowed(`myshadchan-${worker}`)).toThrow(
        `Refusing to bootstrap myshadchan-${worker}`,
      );
    },
  );

  it("has one explicit bootstrap allowlist and allows only email", () => {
    expect(SAFE_BOOTSTRAP_WORKERS).toEqual(["email"]);
    expect(() => assertBootstrapAllowed("myshadchan-email")).not.toThrow();
  });

  it.each(["ai", "parse", "email"])(
    "diffs %s bootstrap config against its committed config with only [secrets] removed",
    (worker) => {
      const committed = readFileSync(
        new URL(`../workers/${worker}/wrangler.toml`, import.meta.url),
        "utf8",
      );
      const generated = withoutRequiredSecretsTable(committed);
      const expected = expectedBootstrapConfig(committed);

      expect(generated).toBe(expected);
      expect(generated).toContain("[[ratelimits]]");
    },
  );
});
