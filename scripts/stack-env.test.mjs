import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEV_DB_URL,
  MAX_STACK_INDEX,
  dbUrlFromEnv,
  parseStackId,
  resolveStack,
  supabaseUrlFromEnv,
} from "./stack-env.mjs";
import { renderStackConfig } from "./stack-config.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CONFIG_E2E = path.join(REPO_ROOT, "supabase", "config.e2e.toml");

const allStacks = Array.from({ length: MAX_STACK_INDEX + 1 }, (_, i) =>
  resolveStack(i),
);

describe("the default path is unchanged when STACK_ID is unset", () => {
  it("resolves an unset STACK_ID to exactly the values the repo hard-coded", () => {
    // Arrange / Act
    const stack = resolveStack(undefined);

    // Assert — every literal below was previously hard-coded somewhere:
    // config.e2e.toml, the makefile, playwright.config.ts, e2e/fixtures.ts.
    expect(stack.isExplicit).toBe(false);
    expect(stack.projectId).toBe("atomic-crm-e2e");
    expect(stack.workdir).toBe(".supabase-e2e");
    expect(stack.logTag).toBe("supabase-e2e");
    expect(stack.outputDir).toBe("test-results");
    // Vite's own default cacheDir, so `npm run dev` / an unset-STACK_ID e2e run
    // keep writing exactly where they always did.
    expect(stack.cacheDir).toBe("node_modules/.vite");
    expect(stack.leasePath).toBe(".supabase-e2e/.stack-lease.json");
    expect(stack.ports).toEqual({
      shadow: 54340,
      api: 54341,
      db: 54342,
      studio: 54343,
      inbucket: 54344,
      analytics: 54347,
      vector: 54348,
      pooler: 54349,
      app: 5175,
      vitestBrowser: 63315,
    });
    expect(stack.supabaseUrl).toBe("http://127.0.0.1:54341");
    expect(stack.mailpitUrl).toBe("http://127.0.0.1:54344");
    expect(stack.appUrl).toBe("http://localhost:5175");
    expect(stack.dbUrl).toBe(
      "postgresql://postgres:postgres@127.0.0.1:54342/postgres",
    );
  });

  it("treats an empty STACK_ID the same as an absent one", () => {
    // Arrange / Act / Assert
    for (const raw of [undefined, null, "", "   "]) {
      expect(resolveStack(raw)).toEqual(resolveStack(undefined));
    }
  });

  it("renders a stack-0 supabase config byte-identical to the committed one", () => {
    // Arrange
    const source = fs.readFileSync(CONFIG_E2E, "utf8");

    // Act
    const rendered = renderStackConfig(source, resolveStack(undefined));

    // Assert — this is the proof that `make start-supabase-e2e` with no
    // STACK_ID boots precisely the stack it booted before the config stopped
    // being copied verbatim.
    expect(rendered).toBe(source);
  });

  it("keeps the database suites on the dev stack when STACK_ID is unset", () => {
    // Arrange / Act / Assert — this is what every supabase/tests/*.test.ts
    // hard-coded as `process.env.SUPABASE_DB_URL ?? "…54322/postgres"`.
    expect(dbUrlFromEnv({})).toBe(DEV_DB_URL);
    expect(dbUrlFromEnv({ SUPABASE_DB_URL: "postgresql://elsewhere" })).toBe(
      "postgresql://elsewhere",
    );
  });

  it("keeps the e2e fixtures on VITE_SUPABASE_URL when STACK_ID is unset", () => {
    // Arrange / Act / Assert
    expect(supabaseUrlFromEnv({})).toBe("http://127.0.0.1:54341");
    expect(supabaseUrlFromEnv({ VITE_SUPABASE_URL: "http://elsewhere" })).toBe(
      "http://elsewhere",
    );
  });
});

describe("STACK_ID outranks inherited environment variables", () => {
  it("ignores a stale SUPABASE_DB_URL when a stack is requested", () => {
    // Arrange / Act / Assert — a leaked env var must never be able to point
    // one agent's psql at another agent's database.
    expect(
      dbUrlFromEnv({
        STACK_ID: "3",
        SUPABASE_DB_URL: "postgresql://elsewhere",
      }),
    ).toBe(resolveStack(3).dbUrl);
  });

  it("ignores a stale VITE_SUPABASE_URL when a stack is requested", () => {
    // Arrange / Act / Assert — resetDb() truncates whatever this resolves to.
    expect(
      supabaseUrlFromEnv({
        STACK_ID: "3",
        VITE_SUPABASE_URL: "http://elsewhere",
      }),
    ).toBe(resolveStack(3).supabaseUrl);
  });
});

describe("stacks are mutually exclusive", () => {
  it("allocates every port to at most one stack", () => {
    // Arrange
    const claims = new Map();

    // Act
    for (const stack of allStacks) {
      for (const [name, port] of Object.entries(stack.ports)) {
        const previous = claims.get(port);
        if (previous) {
          claims.set(port, `${previous} + stack ${stack.index}.${name}`);
        } else {
          claims.set(port, `stack ${stack.index}.${name}`);
        }
      }
    }

    // Assert
    const collisions = [...claims.entries()].filter(([, owner]) =>
      owner.includes("+"),
    );
    expect(collisions).toEqual([]);
  });

  it("never allocates a port belonging to the dev stack (54320-54329)", () => {
    // Arrange / Act
    const ports = allStacks.flatMap((stack) => Object.values(stack.ports));

    // Assert
    expect(ports.filter((port) => port >= 54320 && port <= 54329)).toEqual([]);
  });

  it("gives each stack its own docker project id, workdir and output dir", () => {
    // Arrange / Act
    const ids = allStacks.map((s) => s.projectId);
    const workdirs = allStacks.map((s) => s.workdir);
    const outputDirs = allStacks.map((s) => s.outputDir);

    // Assert
    expect(new Set(ids).size).toBe(allStacks.length);
    expect(new Set(workdirs).size).toBe(allStacks.length);
    expect(new Set(outputDirs).size).toBe(allStacks.length);
  });

  it("gives each stack its own vite dependency cache", () => {
    // Arrange / Act — a shared node_modules/.vite is not a slowdown, it is a
    // hard failure: one server's re-optimisation deletes the chunk files
    // another server's loaded pages are still requesting.
    const cacheDirs = allStacks.map((s) => s.cacheDir);

    // Assert
    expect(new Set(cacheDirs).size).toBe(allStacks.length);
  });

  it("keeps each stack's lease inside its own workdir, outside the wiped part", () => {
    // Arrange / Act / Assert — `make start-supabase-e2e` deletes
    // `<workdir>/supabase`, so a lease stored under it would erase itself
    // exactly when it is meant to be blocking the caller.
    for (const stack of allStacks) {
      expect(stack.leasePath.startsWith(`${stack.workdir}/`)).toBe(true);
      expect(stack.leasePath.startsWith(`${stack.workdir}/supabase`)).toBe(
        false,
      );
    }
    expect(new Set(allStacks.map((s) => s.leasePath)).size).toBe(
      allStacks.length,
    );
  });

  it("renders a config per stack whose ports are all that stack's own", () => {
    // Arrange
    const source = fs.readFileSync(CONFIG_E2E, "utf8");

    for (const stack of allStacks) {
      // Act — renderStackConfig throws if any managed port went unshifted.
      const rendered = renderStackConfig(source, stack);

      // Assert
      expect(rendered).toContain(`project_id = "${stack.projectId}"`);
      expect(rendered).toContain(`port = ${stack.ports.api}`);
      expect(rendered).toContain(`site_url = "${stack.appUrl}"`);
    }
  });
});

describe("invalid stack ids are refused, not guessed at", () => {
  it("rejects a non-integer id rather than hashing it into a slot", () => {
    // Arrange / Act / Assert
    for (const raw of ["epic4", "1.5", "-1", "01x", "true"]) {
      expect(() => parseStackId(raw)).toThrow(/STACK_ID/);
    }
  });

  it("rejects an id past the end of the allocated port range", () => {
    // Arrange / Act / Assert
    expect(() => parseStackId(MAX_STACK_INDEX + 1)).toThrow(/out of range/);
  });
});
