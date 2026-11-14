import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyRereadSections,
  claimRereadAttempt,
  releaseRereadAttempt,
} from "./rereadQuota";
import { rereadResume, REREAD_FAILURE_MESSAGE } from "./rereadRoute";
import { makeExtract, TEST_ENV } from "./parseTestFixtures";

vi.mock("./rereadQuota", () => ({
  applyRereadSections: vi.fn(),
  claimRereadAttempt: vi.fn(),
  releaseRereadAttempt: vi.fn(),
}));

const claim = vi.mocked(claimRereadAttempt);
const apply = vi.mocked(applyRereadSections);
const release = vi.mocked(releaseRereadAttempt);

const requestId = "8f7d6f38-a1ea-4f04-9b14-1e68b2c9f4e3";

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
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  return builder;
}

function makeClients(
  sections: Record<string, unknown> = {
    learningHistory: [{ label: "old", value: "keep" }],
    references: [
      { name: "Reference", relationship: "friend", phone: "unchanged" },
    ],
    additionalSections: [{ title: "Old", items: [] }],
  },
  casApplied = true,
  throwPoint?: ThrowPoint,
) {
  const memberBuilder = selectBuilder({ id: 7, disabled: false });
  const resumeBuilder = selectBuilder({
    id: 22,
    account_id: 10,
    shidduchim_id: 33,
    single_id: null,
    files: [file],
    sections,
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
  return { caller, service, updateBuilder };
}

describe("re-read route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claim.mockResolvedValue({
      ok: true,
      outcome: { outcome: "reserved", attempt_id: 41, generation: 1 },
    });
    apply.mockResolvedValue({ outcome: "applied" });
    release.mockResolvedValue({ outcome: "applied" });
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
          return selectBuilder({ id: 7, disabled: false });
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
      },
    );

    expect(result.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "parse-account:10" });
    expect(claim).not.toHaveBeenCalled();
    expect(service.storage.from).not.toHaveBeenCalled();
  });
});
