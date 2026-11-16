import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyResumeRead,
  applyRereadSections,
  claimRereadAttempt,
  releaseRereadAttempt,
} from "./rereadQuota";
import {
  isResumeUnread,
  rereadResume,
  REREAD_FAILURE_MESSAGE,
} from "./rereadRoute";
import { makeExtract, TEST_ENV } from "./parseTestFixtures";
import { RESUME_UNREAD_PARITY_FIXTURES } from "./resumeUnreadFixtures";
import { ExtractorTimeoutError } from "./resumeExtractor";

vi.mock("./rereadQuota", () => ({
  applyResumeRead: vi.fn(),
  applyRereadSections: vi.fn(),
  claimRereadAttempt: vi.fn(),
  releaseRereadAttempt: vi.fn(),
}));

const applyResume = vi.mocked(applyResumeRead);
const claim = vi.mocked(claimRereadAttempt);
const apply = vi.mocked(applyRereadSections);
const release = vi.mocked(releaseRereadAttempt);

const requestId = "8f7d6f38-a1ea-4f04-9b14-1e68b2c9f4e3";
const AUTH_USER_ID = "auth-user-42";
const PROFILE_MEMBER_ID = 700;

type TestFile = {
  path: string;
  filename: string;
  uploaded_at: string;
  mime_type: string;
  size: number;
};

type ThrowPoint = "metadata" | "download" | "arrayBuffer" | "cas";

const file: TestFile = {
  path: "10/resumes/33/current.pdf",
  filename: "current.pdf",
  uploaded_at: "2026-02-01T00:00:00.000Z",
  mime_type: "application/pdf",
  size: 8,
};

function selectBuilder(data: unknown, error: unknown = null) {
  let selectedData = data;
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((field: string, value: unknown) => {
      if (
        selectedData &&
        typeof selectedData === "object" &&
        field in selectedData &&
        (selectedData as Record<string, unknown>)[field] !== value
      ) {
        selectedData = null;
      }
      return builder;
    }),
    maybeSingle: vi.fn(async () => ({ data: selectedData, error })),
  };
  return builder;
}

function makeClients(
  sections: unknown = {
    learningHistory: [{ label: "old", value: "keep" }],
    references: [
      { name: "Reference", relationship: "friend", phone: "unchanged" },
    ],
    additionalSections: [{ title: "Old", items: [] }],
  },
  casApplied = true,
  throwPoint?: ThrowPoint,
  userId: string | undefined = AUTH_USER_ID,
  memberRow: unknown = {
    id: PROFILE_MEMBER_ID,
    user_id: AUTH_USER_ID,
    disabled: false,
  },
  memberError: unknown = null,
  extracted: unknown = null,
) {
  const memberBuilder = selectBuilder(memberRow, memberError);
  const resumeBuilder = selectBuilder({
    id: 22,
    account_id: 10,
    shidduchim_id: 33,
    single_id: null,
    files: [file],
    sections,
    extracted,
  });
  const caller = {
    rpc: vi.fn(async (name: string) => {
      if (name === "current_context_id") return { data: 10, error: null };
      if (name === "current_member_role") {
        return { data: "parent_admin", error: null };
      }
      return { data: 7, error: null };
    }),
    from: vi.fn((table: string) =>
      table === "members" ? memberBuilder : resumeBuilder,
    ),
  };

  const updateBuilder = {
    update: vi.fn(() => updateBuilder),
    eq: vi.fn(() => updateBuilder),
    is: vi.fn(() => updateBuilder),
    select: vi.fn(() => updateBuilder),
    maybeSingle: vi.fn(async () => {
      if (throwPoint === "cas") throw new Error("CAS unavailable");
      return {
        data: casApplied ? { id: 22 } : null,
        error: null,
      };
    }),
  };
  const fileData = {
    size: 8,
    arrayBuffer: vi.fn(async () => {
      if (throwPoint === "arrayBuffer") {
        throw new Error("buffer unavailable");
      }
      return new TextEncoder().encode("%PDF-1.7").buffer;
    }),
  } as unknown as Blob;
  const storage = {
    from: vi.fn(() => ({
      list: vi.fn(async () => {
        if (throwPoint === "metadata") throw new Error("storage unavailable");
        return {
          data: [
            {
              name: file.filename,
              metadata: { size: file.size, mimetype: file.mime_type },
            },
          ],
          error: null,
        };
      }),
      download: vi.fn(async () => {
        if (throwPoint === "download") throw new Error("download unavailable");
        return { data: fileData, error: null };
      }),
    })),
  };
  const service = {
    from: vi.fn(() => updateBuilder),
    storage,
  };
  return { caller, service, updateBuilder, memberBuilder, userId };
}

async function expectForbidden(
  options: {
    userId?: string | undefined;
    memberRow?: unknown;
    memberError?: unknown;
  } = {},
) {
  const userId = Object.prototype.hasOwnProperty.call(options, "userId")
    ? options.userId
    : AUTH_USER_ID;
  const memberRow = Object.prototype.hasOwnProperty.call(options, "memberRow")
    ? options.memberRow
    : { id: PROFILE_MEMBER_ID, user_id: AUTH_USER_ID, disabled: false };
  const { caller, service, memberBuilder } = makeClients(
    undefined,
    true,
    undefined,
    userId,
    memberRow,
    options.memberError,
  );
  const extractor = { extract: vi.fn() };

  const result = await rereadResume(
    { resume_id: 22, request_id: requestId },
    {
      caller: caller as never,
      service: service as never,
      extractor,
      env: TEST_ENV,
      userId,
    },
  );

  expect(result.status).toBe(403);
  expect(claim).not.toHaveBeenCalled();
  expect(service.from).not.toHaveBeenCalled();
  expect(service.storage.from).not.toHaveBeenCalled();
  expect(extractor.extract).not.toHaveBeenCalled();
  return { memberBuilder };
}

describe("re-read route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claim.mockResolvedValue({
      ok: true,
      outcome: { outcome: "reserved", attempt_id: 41, generation: 1 },
    });
    apply.mockResolvedValue({ outcome: "applied" });
    applyResume.mockResolvedValue({ outcome: "applied" });
    release.mockResolvedValue({ outcome: "applied" });
  });

  it.each(RESUME_UNREAD_PARITY_FIXTURES)(
    "matches the shared raw-shape parity fixture: $name",
    ({ sections, extracted, expectedUnread }) => {
      expect(isResumeUnread({ sections, extracted })).toBe(expectedUnread);
    },
  );

  it("uses the authenticated user id for a distinct member profile", async () => {
    const { caller, service, memberBuilder } = makeClients();

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor: { extract: vi.fn(async () => makeExtract()) },
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(200);
    expect(memberBuilder.eq).toHaveBeenCalledWith("user_id", AUTH_USER_ID);
  });

  it("returns 403 for a disabled login before service work", async () => {
    const { memberBuilder } = await expectForbidden({
      memberRow: {
        id: PROFILE_MEMBER_ID,
        user_id: AUTH_USER_ID,
        disabled: true,
      },
    });

    expect(memberBuilder.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when the login has no member profile", async () => {
    const { memberBuilder } = await expectForbidden({ memberRow: null });

    expect(memberBuilder.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when the member profile belongs to another user", async () => {
    const { memberBuilder } = await expectForbidden({
      memberRow: {
        id: PROFILE_MEMBER_ID,
        user_id: "another-auth-user",
        disabled: false,
      },
    });

    expect(memberBuilder.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when the member lookup errors", async () => {
    const { memberBuilder } = await expectForbidden({
      memberError: new Error("member lookup unavailable"),
    });

    expect(memberBuilder.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when authentication provides no user id", async () => {
    const { memberBuilder } = await expectForbidden({ userId: undefined });

    expect(memberBuilder.maybeSingle).not.toHaveBeenCalled();
  });

  it("writes only additionalSections and the schema marker, preserving legacy sections", async () => {
    const { caller, service } = makeClients();
    const references = [
      {
        name: "Reference",
        relationship: "friend",
        phone: "unchanged",
      },
    ];
    const learningHistory = [{ label: "old", value: "keep" }];
    const extractor = {
      extract: vi.fn(async () =>
        makeExtract({
          sections: {
            learningHistory: [{ label: "new", value: "must ignore" }],
            references: [
              {
                name: "new",
                relationship: "friend",
                phone: "must ignore",
              },
            ],
            additionalSections: [
              {
                key: "work",
                title: "Work",
                items: [{ label: "Role", value: "Teacher" }],
                order: 0,
              },
            ],
          },
        }),
      ),
    };

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor,
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(200);
    expect(release).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith(
      TEST_ENV,
      10,
      22,
      41,
      1,
      {
        learningHistory,
        references,
        additionalSections: [{ title: "Old", items: [] }],
      },
      {
        learningHistory,
        references,
        schemaVersion: 4,
        additionalSections: [
          {
            key: "work",
            title: "Work",
            items: [{ label: "Role", value: "Teacher" }],
            order: 0,
          },
        ],
      },
      4,
    );
    expect(apply).toHaveBeenCalledTimes(1);
    expect((apply.mock.calls[0] as unknown[])[6]).toMatchObject({
      learningHistory,
      references,
      schemaVersion: 4,
      additionalSections: [
        {
          key: "work",
          title: "Work",
          items: [{ label: "Role", value: "Teacher" }],
          order: 0,
        },
      ],
    });
    expect((apply.mock.calls[0] as unknown[])[6]).toMatchObject({
      learningHistory,
      references,
    });
  });

  it("fill-empty mode applies the exact uploaded file and the validated draft", async () => {
    const { caller, service } = makeClients();
    const raw = makeExtract({
      father_en: { value: "Yosef", confidence: 0.9 },
      sections: {
        learningHistory: [{ label: "Learning", value: "Lakewood" }],
        references: [],
        additionalSections: [],
      },
    });

    const result = await rereadResume(
      {
        resume_id: 22,
        request_id: requestId,
        mode: "fill_empty",
        file_identity: file.path,
      },
      {
        caller: caller as never,
        service: service as never,
        extractor: { extract: vi.fn(async () => raw) },
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(200);
    expect(applyResume).toHaveBeenCalledWith(
      TEST_ENV,
      10,
      22,
      41,
      1,
      file.path,
      expect.objectContaining({
        name_en: "Rivky",
        father_en: "Yosef",
        age: 24,
      }),
      raw,
      raw.sections,
      4,
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("upgrades a legacy unread request to the full fill-empty apply", async () => {
    const { caller, service } = makeClients(
      null,
      true,
      undefined,
      AUTH_USER_ID,
      undefined,
      null,
      null,
    );
    const extractor = { extract: vi.fn(async () => makeExtract()) };

    const result = await rereadResume(
      {
        resume_id: 22,
        request_id: requestId,
        file_identity: "stale-old-path.pdf",
      },
      {
        caller: caller as never,
        service: service as never,
        extractor,
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(200);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(applyResume).toHaveBeenCalledWith(
      TEST_ENV,
      10,
      22,
      41,
      1,
      file.path,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      4,
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps legacy mode as additional-sections reread for an already-read resume", async () => {
    const { caller, service } = makeClients();
    const extractor = { extract: vi.fn(async () => makeExtract()) };

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor,
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(200);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(applyResume).not.toHaveBeenCalled();
  });

  it("maps entitlement outcomes to distinct static response codes", async () => {
    const { caller, service } = makeClients();
    claim.mockResolvedValueOnce({
      ok: true,
      outcome: { outcome: "not_entitled" },
    });

    const notEntitled = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor: { extract: vi.fn() },
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );
    expect(notEntitled).toEqual({
      status: 402,
      body: {
        success: false,
        error: REREAD_FAILURE_MESSAGE,
        meta: { code: "not_entitled" },
      },
    });

    claim.mockResolvedValueOnce({
      ok: true,
      outcome: { outcome: "no_allowance" },
    });
    const noAllowance = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor: { extract: vi.fn() },
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );
    expect(noAllowance.body).toEqual({
      success: false,
      error: REREAD_FAILURE_MESSAGE,
      meta: { code: "no_allowance" },
    });
  });

  it("releases the one reservation when the extractor fails", async () => {
    const { caller, service } = makeClients();
    const extractor = {
      extract: vi.fn(async () => {
        throw new Error("model failed");
      }),
    };

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor,
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      success: false,
      error: REREAD_FAILURE_MESSAGE,
    });
    expect(release).toHaveBeenCalledWith(TEST_ENV, 10, 41, 1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("returns a static timeout code while releasing the reservation", async () => {
    const { caller, service } = makeClients();
    const extractor = {
      extract: vi.fn(async () => {
        throw new ExtractorTimeoutError(60_000);
      }),
    };

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor,
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result).toEqual({
      status: 422,
      body: {
        success: false,
        error: REREAD_FAILURE_MESSAGE,
        meta: { code: "timeout" },
      },
    });
    expect(release).toHaveBeenCalledWith(TEST_ENV, 10, 41, 1);
  });

  it.each(["metadata", "download", "arrayBuffer", "cas"] as const)(
    "releases when the %s await throws",
    async (throwPoint) => {
      const { caller, service } = makeClients(undefined, true, throwPoint);
      if (throwPoint === "cas") {
        apply.mockRejectedValueOnce(new Error("atomic apply unavailable"));
      }

      const result = await rereadResume(
        { resume_id: 22, request_id: requestId },
        {
          caller: caller as never,
          service: service as never,
          extractor: { extract: vi.fn(async () => makeExtract()) },
          env: TEST_ENV,
          userId: AUTH_USER_ID,
        },
      );

      expect(result.status).toBe(422);
      expect(release).toHaveBeenCalledWith(TEST_ENV, 10, 41, 1);
      if (throwPoint === "cas") {
        expect(apply).toHaveBeenCalledTimes(1);
      } else {
        expect(apply).not.toHaveBeenCalled();
      }
    },
  );

  it("releases when the atomic apply RPC throws", async () => {
    const { caller, service } = makeClients();
    apply.mockRejectedValueOnce(new Error("atomic apply unavailable"));

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor: { extract: vi.fn(async () => makeExtract()) },
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(422);
    expect(release).toHaveBeenCalledWith(TEST_ENV, 10, 41, 1);
  });

  it("releases on a compare-and-set miss and never overwrites newer edits", async () => {
    const { caller, service } = makeClients();
    apply.mockResolvedValueOnce({ outcome: "cas_failed" });

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor: { extract: vi.fn(async () => makeExtract()) },
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(409);
    expect(release).toHaveBeenCalledWith(TEST_ENV, 10, 41, 1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not touch service storage when the stored path is not owned by the account", async () => {
    const { caller, service } = makeClients();
    const badCaller = {
      ...caller,
      from: vi.fn((table: string) => {
        if (table === "members")
          return selectBuilder({
            id: PROFILE_MEMBER_ID,
            user_id: AUTH_USER_ID,
            disabled: false,
          });
        return selectBuilder({
          id: 22,
          account_id: 10,
          shidduchim_id: 33,
          single_id: null,
          files: [{ ...file, path: "11/resumes/33/current.pdf" }],
          sections: {},
        });
      }),
    };

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: badCaller as never,
        service: service as never,
        extractor: { extract: vi.fn() },
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(422);
    expect(service.storage.from).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("returns a calm single-flight response without downloading or charging again", async () => {
    const { caller, service } = makeClients();
    claim.mockResolvedValue({
      ok: true,
      outcome: { outcome: "in_progress", attempt_id: 41, generation: 1 },
    });
    const extractor = { extract: vi.fn() };

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor,
        env: TEST_ENV,
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      success: false,
      error: "This resume is already being read. Please try again shortly.",
      meta: { code: "already_reading" },
    });
    expect(service.storage.from).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it("applies the account rate limit before storage or quota work", async () => {
    const { caller, service } = makeClients();
    const limit = vi.fn(async () => ({ success: false }));

    const result = await rereadResume(
      { resume_id: 22, request_id: requestId },
      {
        caller: caller as never,
        service: service as never,
        extractor: { extract: vi.fn() },
        env: {
          ...TEST_ENV,
          RATE_LIMITING_ENFORCED: "true",
          PARSE_USER_RATE_LIMITER: { limit },
        },
        userId: AUTH_USER_ID,
      },
    );

    expect(result.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "parse-account:10" });
    expect(claim).not.toHaveBeenCalled();
    expect(service.storage.from).not.toHaveBeenCalled();
  });
});
