import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const parseWranglerConfig = readFileSync(
  new URL("../workers/parse/wrangler.toml", import.meta.url),
  "utf8",
);

const uploadStepStart = workflow.indexOf(
  "name: 🚀 Upload Worker version (code + every secret, bundled atomically)",
);
const uploadStepEnd = workflow.indexOf(
  "\n      # The explicit promotion `versions upload` above deliberately never",
  uploadStepStart,
);
const uploadStep = workflow.slice(uploadStepStart, uploadStepEnd);

describe("outbound email deploy plumbing", () => {
  it("passes optional switchboard secrets only to the email upload step", () => {
    expect(uploadStepStart).toBeGreaterThanOrEqual(0);
    expect(uploadStepEnd).toBeGreaterThan(uploadStepStart);
    expect(uploadStep).toContain(
      "OUTBOUND_EMAIL_ENABLED: ${{ matrix.worker == 'email' && secrets.OUTBOUND_EMAIL_ENABLED || '' }}",
    );
    expect(uploadStep).toContain(
      "OUTBOUND_EMAIL_ACCOUNT_IDS: ${{ matrix.worker == 'email' && secrets.OUTBOUND_EMAIL_ACCOUNT_IDS || '' }}",
    );
    expect(workflow.match(/secrets\.OUTBOUND_EMAIL_ENABLED/g)).toHaveLength(1);
    expect(workflow.match(/secrets\.OUTBOUND_EMAIL_ACCOUNT_IDS/g)).toHaveLength(
      1,
    );
  });

  it("validates and safely masks inputs while leaving bootstrap untouched", () => {
    expect(uploadStep).toContain(
      'if [ "${{ matrix.worker }}" = "email" ]; then',
    );
    expect(uploadStep).toContain(
      'node "$GITHUB_WORKSPACE/scripts/outbound-email-config.mjs"',
    );
    expect(uploadStep).toContain('echo "::add-mask::$email_enabled"');
    expect(uploadStep).toContain(
      'echo "::add-mask::$masked_email_account_ids"',
    );
    expect(uploadStep).toContain(
      'email_account_ids="${email_config_lines[1]:-}"',
    );
    expect(uploadStep).toContain(
      'email_var_args+=(--var "OUTBOUND_EMAIL_ENABLED:$email_enabled")',
    );
    expect(uploadStep).toContain(
      'email_var_args+=(--var "OUTBOUND_EMAIL_ACCOUNT_IDS:$email_account_ids")',
    );
    expect(uploadStep).not.toContain("::add-mask::$OUTBOUND_EMAIL_ACCOUNT_IDS");
    expect(uploadStep).toContain('"${email_var_args[@]}"');

    const bootstrapStepStart = workflow.indexOf(
      "name: 🧱 Ensure Worker exists before atomic upload",
    );
    const bootstrapStepEnd = workflow.indexOf(
      "\n      # External review Finding 1",
      bootstrapStepStart,
    );
    const bootstrapStep = workflow.slice(bootstrapStepStart, bootstrapStepEnd);
    expect(bootstrapStep).not.toContain("OUTBOUND_EMAIL_ENABLED: ${{");
    expect(bootstrapStep).not.toContain("OUTBOUND_EMAIL_ACCOUNT_IDS: ${{");
    expect(bootstrapStep).toContain("--bootstrap-config");
  });

  it("publishes parse model vars from wrangler.toml without a CI override", () => {
    expect(parseWranglerConfig).toContain(
      'GEMINI_MODEL = "gemini-2.5-flash-lite"',
    );
    expect(parseWranglerConfig).toContain(
      'GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"',
    );
    expect(parseWranglerConfig).not.toContain("GEMINI_THINKING_BUDGET =");
    expect(uploadStep).toContain(
      "working-directory: workers/${{ matrix.worker }}",
    );
    expect(uploadStep).toContain("npx wrangler versions upload");
    expect(uploadStep).not.toMatch(/--var[^\n]*GEMINI_/);
    expect(uploadStep).not.toContain("GEMINI_MODEL");
    expect(uploadStep).not.toContain("GEMINI_FALLBACK_MODEL");
  });
});
