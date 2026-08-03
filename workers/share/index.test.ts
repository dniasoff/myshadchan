import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A minimal, in-memory fake of the two `@supabase/supabase-js` surfaces
 * this Worker touches: `.from(table).select().eq()...maybeSingle()/insert()`
 * (Postgres) and `.storage.from(bucket).download(path)` (Storage). Real
 * enough to exercise this file's actual query shapes (multiple chained
 * `.eq()` calls, `.is()`, `.order()`, `.limit()`) without a live database —
 * the same "mock the client entirely" idiom `forAccount.test.ts` and
 * `entityFiles.test.ts` already use in this repo.
 */
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

const { tables, insertedLogs, storageDownload, storageFrom, resetFakeDb } =
  vi.hoisted(() => {
    const tables: Tables = {};
    const insertedLogs: Row[] = [];
    const storageDownload = vi.fn();
    const storageFrom = vi.fn(() => ({ download: storageDownload }));

    function resetFakeDb() {
      for (const key of Object.keys(tables)) delete tables[key];
      insertedLogs.length = 0;
      storageDownload.mockReset();
      storageFrom.mockClear();
    }

    return { tables, insertedLogs, storageDownload, storageFrom, resetFakeDb };
  });

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  // Loose (`==`) equality, not strict: real PostgREST compares over HTTP
  // query strings, so `forAccount()`'s string accountId ("1") legitimately
  // matches a numeric `account_id` column (1) — this fake reproduces that
  // coercion rather than being stricter than the real thing it stands in
  // for.
  return filters.every(([col, val]) =>
    val === null ? row[col] == null : row[col] == val,
  );
}

function project(row: Row, columns: string[] | null): Row {
  if (!columns) return row;
  const projected: Row = {};
  for (const col of columns) projected[col] = row[col];
  return projected;
}

function makeQuery(tableName: string) {
  const filters: Array<[string, unknown]> = [];
  let columns: string[] | null = null;
  const builder = {
    select: (cols?: string) => {
      // Faithful to real PostgREST: `.select("a, b")` returns ONLY those
      // columns — this is what makes the "single: opted-in profile fields
      // only" behaviour testable at all (a fake that always returned the
      // whole row would never catch this Worker accidentally over-selecting
      // an internal id).
      columns = cols ? cols.split(",").map((c) => c.trim()) : null;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return builder;
    },
    is: (col: string, val: unknown) => {
      filters.push([col, val]);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    async maybeSingle() {
      const rows = (tables[tableName] ?? []).filter((row) =>
        matches(row, filters),
      );
      const row = rows[0];
      return { data: row ? project(row, columns) : null, error: null };
    },
    async insert(values: Row) {
      if (tableName === "share_access_log") insertedLogs.push(values);
      (tables[tableName] ??= []).push(values);
      return { data: null, error: null };
    },
  };
  return builder;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (tableName: string) => makeQuery(tableName),
    storage: { from: storageFrom },
  }),
}));

import app from "./index";

/** One consistent share_links row builder for the whole suite. */
function seedShareLink(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: 1,
    account_id: 1,
    single_id: 1,
    token: "a".repeat(48),
    include_photo: false,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
  (tables.share_links ??= []).push(row);
  return row;
}

function seedSingle(overrides: Partial<Row> = {}): void {
  (tables.singles ??= []).push({
    id: 1,
    account_id: 1,
    first_name_en: "Rivky",
    first_name_he: "רבקה",
    ...overrides,
  });
}

function seedResume(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: 1,
    account_id: 1,
    single_id: 1,
    files: [
      {
        path: "1/resumes/single-1/abc-resume.pdf",
        filename: "resume.pdf",
        mime_type: "application/pdf",
        size: 1234,
      },
    ],
    ...overrides,
  };
  (tables.resumes ??= []).push(row);
  return row;
}

function seedPhoto(overrides: Partial<Row> = {}): void {
  (tables.resume_photos ??= []).push({
    id: 1,
    account_id: 1,
    resume_id: 1,
    path: "1/photos/shared/single-1/xyz-photo.jpg",
    hidden_at: null,
    uploaded_at: new Date().toISOString(),
    ...overrides,
  });
}

describe("share worker", () => {
  beforeEach(() => {
    resetFakeDb();
    // A sane default so tests that only care about routing/manifest
    // behaviour (not the exact streamed bytes) don't have to set this up
    // themselves; tests asserting the actual response body override it.
    storageDownload.mockResolvedValue({
      data: new Blob(["default-bytes"]),
      error: null,
    });
  });

  it("responds to GET /health", async () => {
    // Arrange / Act
    const res = await app.request("/health");

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "share", status: "ok" },
    });
  });

  describe("GET /r/:token", () => {
    it("returns 200 + the envelope for a valid, unexpired, unrevoked token", async () => {
      // Arrange
      const link = seedShareLink();
      seedSingle();
      seedResume();

      // Act
      const res = await app.request(`/r/${link.token}`, {}, env);
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body).toEqual({
        success: true,
        data: {
          single: { first_name_en: "Rivky", first_name_he: "רבקה" },
          files: [
            {
              fileKey: "resume-0",
              filename: "resume.pdf",
              mimeType: "application/pdf",
              size: 1234,
              downloadUrl: `/r/${link.token}/file/resume-0`,
            },
          ],
        },
      });
    });

    it("writes exactly one share_access_log row with resource 'profile' and a non-null duration_ms", async () => {
      // Arrange
      const link = seedShareLink();
      seedSingle();
      seedResume();

      // Act
      await app.request(`/r/${link.token}`, {}, env);

      // Assert
      expect(insertedLogs).toHaveLength(1);
      expect(insertedLogs[0]).toMatchObject({
        share_link_id: 1,
        resource: "profile",
      });
      expect(typeof insertedLogs[0].duration_ms).toBe("number");
    });

    it("AC-5: a profile view followed by a file download writes TWO share_access_log rows with distinct resource values and a non-null duration_ms on each", async () => {
      // Arrange
      const link = seedShareLink();
      seedSingle();
      seedResume();
      storageDownload.mockResolvedValue({
        data: new Blob(["bytes"]),
        error: null,
      });

      // Act
      await app.request(`/r/${link.token}`, {}, env);
      await app.request(`/r/${link.token}/file/resume-0`, {}, env);

      // Assert
      expect(insertedLogs).toHaveLength(2);
      expect(insertedLogs.map((row) => row.resource)).toEqual([
        "profile",
        "resume:resume-0",
      ]);
      for (const row of insertedLogs) {
        expect(typeof row.duration_ms).toBe("number");
      }
    });

    it("omits the photo entry entirely when include_photo is false, even if a photo exists", async () => {
      // Arrange
      const link = seedShareLink({ include_photo: false });
      seedSingle();
      seedResume();
      seedPhoto();

      // Act
      const res = await app.request(`/r/${link.token}`, {}, env);
      const body = (await res.json()) as {
        data: { files: Array<{ fileKey: string }> };
      };

      // Assert
      expect(body.data.files.some((file) => file.fileKey === "photo")).toBe(
        false,
      );
    });

    it("includes the photo entry when include_photo is true and an unhidden photo exists", async () => {
      // Arrange
      const link = seedShareLink({ include_photo: true });
      seedSingle();
      seedResume();
      seedPhoto();

      // Act
      const res = await app.request(`/r/${link.token}`, {}, env);
      const body = (await res.json()) as {
        data: { files: Array<{ fileKey: string; downloadUrl: string }> };
      };

      // Assert
      expect(body.data.files).toContainEqual({
        fileKey: "photo",
        filename: null,
        mimeType: null,
        size: null,
        downloadUrl: `/r/${link.token}/file/photo`,
      });
    });

    it("excludes a soft-hidden photo even when include_photo is true", async () => {
      // Arrange
      const link = seedShareLink({ include_photo: true });
      seedSingle();
      seedResume();
      seedPhoto({ hidden_at: new Date().toISOString() });

      // Act
      const res = await app.request(`/r/${link.token}`, {}, env);
      const body = (await res.json()) as {
        data: { files: Array<{ fileKey: string }> };
      };

      // Assert
      expect(body.data.files.some((file) => file.fileKey === "photo")).toBe(
        false,
      );
    });

    it("never exposes a raw or signed storage URL — downloadUrl is always a same-origin Worker path", async () => {
      // Arrange
      const link = seedShareLink({ include_photo: true });
      seedSingle();
      seedResume();
      seedPhoto();

      // Act
      const res = await app.request(`/r/${link.token}`, {}, env);
      const body = (await res.json()) as {
        data: { files: Array<{ downloadUrl: string }> };
      };

      // Assert
      for (const file of body.data.files) {
        expect(file.downloadUrl).toMatch(new RegExp(`^/r/${link.token}/file/`));
        expect(file.downloadUrl).not.toMatch(/supabase|signed|documents\//i);
      }
    });

    it("returns the identical 404 body for an unknown token", async () => {
      // Act
      const res = await app.request(`/r/${"z".repeat(48)}`, {}, env);

      // Assert
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: "not found" });
    });

    it("returns the identical 404 body for a revoked token", async () => {
      // Arrange
      const link = seedShareLink({ revoked_at: new Date().toISOString() });
      seedSingle();

      // Act
      const res = await app.request(`/r/${link.token}`, {}, env);

      // Assert
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: "not found" });
    });

    it("returns the identical 404 body for an expired token", async () => {
      // Arrange
      const link = seedShareLink({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      seedSingle();

      // Act
      const res = await app.request(`/r/${link.token}`, {}, env);

      // Assert
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: "not found" });
    });

    it("unknown, revoked and expired tokens all produce byte-for-byte identical response bodies", async () => {
      // Arrange
      const revoked = seedShareLink({
        id: 2,
        token: "b".repeat(48),
        revoked_at: new Date().toISOString(),
      });
      const expired = seedShareLink({
        id: 3,
        token: "c".repeat(48),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });

      // Act
      const [unknownRes, revokedRes, expiredRes] = await Promise.all([
        app.request(`/r/${"z".repeat(48)}`, {}, env),
        app.request(`/r/${revoked.token}`, {}, env),
        app.request(`/r/${expired.token}`, {}, env),
      ]);
      const [unknownText, revokedText, expiredText] = await Promise.all([
        unknownRes.text(),
        revokedRes.text(),
        expiredRes.text(),
      ]);

      // Assert
      expect(unknownRes.status).toBe(404);
      expect(revokedRes.status).toBe(404);
      expect(expiredRes.status).toBe(404);
      expect(unknownText).toBe(revokedText);
      expect(revokedText).toBe(expiredText);
    });

    it("a link revoked mid-session refuses the very next request", async () => {
      // Arrange
      const link = seedShareLink();
      seedSingle();
      seedResume();

      // Act — first request succeeds
      const before = await app.request(`/r/${link.token}`, {}, env);
      expect(before.status).toBe(200);

      // Revoke it (mutating the in-memory row directly, mirroring an
      // `update ... set revoked_at = now()` landing between two requests).
      link.revoked_at = new Date().toISOString();

      const after = await app.request(`/r/${link.token}`, {}, env);

      // Assert
      expect(after.status).toBe(404);
    });
  });

  describe("GET /r/:token/file/:fileKey", () => {
    it("streams the resume bytes through the Worker's own response, never a redirect", async () => {
      // Arrange
      const link = seedShareLink();
      seedSingle();
      seedResume();
      const blob = new Blob(["%PDF-1.4 fake bytes"], {
        type: "application/pdf",
      });
      storageDownload.mockResolvedValue({ data: blob, error: null });

      // Act
      const res = await app.request(`/r/${link.token}/file/resume-0`, {}, env);

      // Assert
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toContain("resume.pdf");
      expect(storageDownload).toHaveBeenCalledExactlyOnceWith(
        "1/resumes/single-1/abc-resume.pdf",
      );
      const text = await res.text();
      expect(text).toContain("fake bytes");
    });

    it("writes a share_access_log row with resource 'resume:<fileKey>' and a non-null duration_ms", async () => {
      // Arrange
      const link = seedShareLink();
      seedSingle();
      seedResume();
      storageDownload.mockResolvedValue({
        data: new Blob(["x"]),
        error: null,
      });

      // Act
      await app.request(`/r/${link.token}/file/resume-0`, {}, env);

      // Assert
      expect(insertedLogs).toHaveLength(1);
      expect(insertedLogs[0]).toMatchObject({
        share_link_id: 1,
        resource: "resume:resume-0",
      });
      expect(typeof insertedLogs[0].duration_ms).toBe("number");
    });

    it("streams the photo with resource 'photo' when include_photo is true", async () => {
      // Arrange
      const link = seedShareLink({ include_photo: true });
      seedSingle();
      seedResume();
      seedPhoto();
      storageDownload.mockResolvedValue({
        data: new Blob(["jpeg-bytes"], { type: "image/jpeg" }),
        error: null,
      });

      // Act
      const res = await app.request(`/r/${link.token}/file/photo`, {}, env);

      // Assert
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      // No filename is stored for a photo — never a Content-Disposition.
      expect(res.headers.get("content-disposition")).toBeNull();
      expect(insertedLogs[0]).toMatchObject({
        share_link_id: 1,
        resource: "photo",
      });
    });

    it("re-validates revoke/expiry on the file route too — a revoked link refuses a download", async () => {
      // Arrange
      const link = seedShareLink();
      seedSingle();
      seedResume();
      link.revoked_at = new Date().toISOString();

      // Act
      const res = await app.request(`/r/${link.token}/file/resume-0`, {}, env);

      // Assert
      expect(res.status).toBe(404);
      expect(storageDownload).not.toHaveBeenCalled();
    });

    describe("AC-13: fileKey is opaque and server-derived", () => {
      it("returns the identical 404 for a forged fileKey and never calls .storage.from(...)", async () => {
        // Arrange
        const link = seedShareLink();
        seedSingle();
        seedResume();

        // Act
        const res = await app.request(
          `/r/${link.token}/file/not-a-real-key`,
          {},
          env,
        );

        // Assert
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          success: false,
          error: "not found",
        });
        expect(storageFrom).not.toHaveBeenCalled();
        expect(storageDownload).not.toHaveBeenCalled();
      });

      it("returns the identical 404 for a path-traversal fileKey and never calls .storage.from(...)", async () => {
        // Arrange
        const link = seedShareLink();
        seedSingle();
        seedResume();

        // Act
        const res = await app.request(
          `/r/${link.token}/file/${encodeURIComponent("../../etc/passwd")}`,
          {},
          env,
        );

        // Assert
        expect(res.status).toBe(404);
        expect(storageFrom).not.toHaveBeenCalled();
      });

      it("returns the identical 404 for a real fileKey copied from a DIFFERENT share link's manifest, and never calls .storage.from(...)", async () => {
        // Arrange — link A has exactly ONE file (resume-0 only). Link B (a
        // different single, same or different account) has TWO files, so
        // "resume-1" is a genuine, real fileKey — but only on B's own
        // manifest, never on A's. Copying it onto A's token is exactly the
        // "real fileKey copied from a different share link" case AC-13
        // names.
        const linkA = seedShareLink({ id: 1, token: "a".repeat(48) });
        seedSingle({ id: 1 });
        seedResume({
          id: 1,
          single_id: 1,
          files: [
            {
              path: "1/resumes/single-1/a0.pdf",
              filename: "a0.pdf",
              mime_type: "application/pdf",
              size: 111,
            },
          ],
        });

        const linkB = seedShareLink({
          id: 2,
          token: "b".repeat(48),
          single_id: 2,
        });
        seedSingle({ id: 2, account_id: 1 });
        seedResume({
          id: 2,
          single_id: 2,
          files: [
            {
              path: "1/resumes/single-2/b0.pdf",
              filename: "b0.pdf",
              mime_type: "application/pdf",
              size: 222,
            },
            {
              path: "1/resumes/single-2/b1.pdf",
              filename: "b1.pdf",
              mime_type: "application/pdf",
              size: 333,
            },
          ],
        });

        // Sanity: "resume-1" is genuinely real on link B.
        const controlRes = await app.request(
          `/r/${linkB.token}/file/resume-1`,
          {},
          env,
        );
        expect(controlRes.status).toBe(200);
        storageFrom.mockClear();
        storageDownload.mockClear();

        // Act — the same fileKey string, presented against link A's token,
        // where A's own manifest only ever had "resume-0".
        const res = await app.request(
          `/r/${linkA.token}/file/resume-1`,
          {},
          env,
        );

        // Assert
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          success: false,
          error: "not found",
        });
        expect(storageFrom).not.toHaveBeenCalled();
        expect(storageDownload).not.toHaveBeenCalled();
      });
    });
  });
});
