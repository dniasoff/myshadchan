import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
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

  it("normalizes the enable switch, masks inputs, and leaves bootstrap untouched", () => {
    expect(uploadStep).toContain(
      'if [ "${{ matrix.worker }}" = "email" ]; then',
    );
    expect(uploadStep).toContain('echo "::add-mask::$1"');
    expect(uploadStep).toContain(
      'if [ "${OUTBOUND_EMAIL_ENABLED:-}" = "true" ]; then',
    );
    expect(uploadStep).toContain(
      'email_var_args+=(--var "OUTBOUND_EMAIL_ENABLED:$email_enabled")',
    );
    expect(uploadStep).toContain(
      'email_var_args+=(--var "OUTBOUND_EMAIL_ACCOUNT_IDS:${OUTBOUND_EMAIL_ACCOUNT_IDS:-}")',
    );
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
});
