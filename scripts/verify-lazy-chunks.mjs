#!/usr/bin/env node
/**
 * Fails the build if a deliberately-lazy library chunk is STATICALLY imported
 * by anything, i.e. if it is downloaded by visitors who never use the feature.
 *
 * `attachments/docxSanitizer.guard.test.ts` already asserts that pdfjs,
 * mammoth and DOMPurify are reached only through `await import()` in the
 * SOURCE. That is necessary and it is not sufficient: the bundler can undo it
 * afterwards, and did.
 *
 * The incident this exists for: adding a `manualChunks` rule to give mammoth a
 * stable filename also swept Rollup's shared CommonJS interop helpers into
 * that chunk. Every other chunk then had to import the mammoth chunk to get
 * the helpers back — the built entry chunk contained a literal
 * `import{g,c}from"./mammoth-<hash>.js"` — so 141 KB (brotli) of Word renderer
 * was eagerly downloaded on the LOGIN page. The source-level guard stayed
 * green, every unit test stayed green, and `npm run build` stayed green. It
 * was visible only by measuring the deployed site request by request, which
 * is not a thing anyone does on every change.
 *
 * Runs as the last step of `npm run build`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Filename prefixes of the chunks that must stay dynamic-import-only. These
 * are the same names `vite.config.ts`'s precache `globIgnores` keys off — keep
 * the two in step. */
export const LAZY_CHUNK_PREFIXES = ["pdf-", "mammoth-", "purify.es-"];

/**
 * Libraries that must never land in a chunk the browser downloads before the
 * app is usable, identified by a string only that library emits.
 *
 * This is the SECOND check, and it exists because the first one cannot see the
 * shape that actually shipped: `@hello-pangea/dnd` was inside the eager `CRM`
 * chunk, not in a lazy chunk somebody statically imported — so "is any lazy
 * chunk statically imported" was green while 186 KB of Kanban drag-and-drop
 * loaded on the login screen. The cause was a 28-line SVG (`ClockIcon`)
 * exported from the board's card module and imported by the eagerly-registered
 * 360 header; one import specifier, no library mentioned anywhere near it.
 *
 * Checking the built bytes is the only thing that catches that class. The
 * markers are verified against a real build, and each currently appears in
 * exactly one chunk, which the anti-vacuity check below re-confirms.
 */
export const EAGER_FORBIDDEN_LIBRARIES = [
  { name: "@hello-pangea/dnd", marker: "dragHandleUsageInstructions" },
  { name: "cropperjs", marker: "cropper-crop-box" },
];

/**
 * Every chunk a visitor waits for before they can sign in.
 *
 * Two seeds, and the second one is the whole reason this works. The entry
 * chunk is obvious. The `CRM` chunk is NOT statically imported by it —
 * `App.tsx` loads it through `React.lazy` — but the login form lives inside
 * it (`root/CRM.tsx` passes `loginPage={LoginPage}`), so every byte in it is
 * a byte between a visitor and the sign-in screen. Seeding from the entry
 * alone made this check report green on both regressions it was written to
 * catch, because both landed in `CRM`.
 *
 * From those seeds, follow STATIC imports only. Vite writes a dynamic
 * import's target as a bare string inside `__vite__mapDeps`, with no `from`
 * before it, so the pattern below sees only the static edges — which is
 * exactly the set that costs first-load bytes.
 */
function collectEagerChunks(assets, indexHtml, files) {
  const entry = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(indexHtml)?.[1];
  if (!entry) return null;

  const seeds = [entry, ...files.filter((file) => file.startsWith("CRM-"))];
  const eager = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.pop();
    if (eager.has(file)) continue;
    const full = path.join(assets, file);
    if (!fs.existsSync(full)) continue;
    eager.add(file);
    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(
      /(?:from|import)\s*["']\.\/([A-Za-z0-9_.-]+\.js)["']/g,
    )) {
      queue.push(match[1]);
    }
  }
  return eager;
}

/**
 * Checks a build's `assets/` directory. Returns a list of failure strings —
 * empty means every lazy chunk is still reachable by dynamic import alone.
 */
export function verifyLazyChunks(distDir) {
  const assets = path.join(distDir, "assets");
  if (!fs.existsSync(assets)) {
    return [`no build output at ${assets}`];
  }

  const files = fs.readdirSync(assets).filter((name) => name.endsWith(".js"));
  const failures = [];

  // Anti-vacuity: with the chunks absent — renamed, or the feature removed —
  // every assertion below would pass while checking nothing.
  const lazyChunks = [];
  for (const prefix of LAZY_CHUNK_PREFIXES) {
    const file = files.find((name) => name.startsWith(prefix));
    if (!file) {
      failures.push(
        `expected chunk ${prefix}*.js is not in the build. Either the lazy ` +
          `library is gone or a chunk was renamed; a rename must also update ` +
          `LAZY_CHUNK_PREFIXES here and the globIgnores in vite.config.ts.`,
      );
      continue;
    }
    lazyChunks.push(file);
  }
  if (failures.length > 0) return failures;

  for (const chunk of lazyChunks) {
    // A STATIC import. Vite writes dynamic ones as a bare string inside
    // `__vite__mapDeps` — no `from` before it — and that form is correct.
    const staticImport = new RegExp(
      String.raw`from\s*["']\./${chunk.replace(/\./g, "\\.")}["']`,
    );
    for (const candidate of files) {
      if (candidate === chunk) continue;
      const source = fs.readFileSync(path.join(assets, candidate), "utf8");
      if (!staticImport.test(source)) continue;
      const kb = Math.round(fs.statSync(path.join(assets, chunk)).size / 1024);
      failures.push(
        `${chunk} (${kb} KB) is statically imported by ${candidate}, so it ` +
          `now loads for everyone — including visitors who never open the ` +
          `feature it belongs to. Usual cause: a \`manualChunks\` rule swept ` +
          `shared vendor code (Rollup's CommonJS interop helpers, most often) ` +
          `into the named chunk, so every other chunk must import it to get ` +
          `that code back. Give the shared module its own chunk, ahead of the ` +
          `library rule.`,
      );
    }
  }

  // --- the eager-bytes check ------------------------------------------------
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    failures.push(
      `no index.html at ${indexPath}; cannot resolve the entry chunk`,
    );
    return failures;
  }
  const eager = collectEagerChunks(
    assets,
    fs.readFileSync(indexPath, "utf8"),
    files,
  );
  // A single-chunk result means the CRM seed did not resolve, which is how
  // this check silently stopped covering the login path once already.
  if (!eager || eager.size < 2) {
    failures.push(
      "could not resolve the entry chunk from index.html, so the eager-bytes " +
        "check verified nothing",
    );
    return failures;
  }

  for (const { name, marker } of EAGER_FORBIDDEN_LIBRARIES) {
    const carriers = files.filter((file) =>
      fs.readFileSync(path.join(assets, file), "utf8").includes(marker),
    );
    // Anti-vacuity: a marker that matches nothing (library removed, or the
    // string minified away) would let this pass while checking nothing.
    if (carriers.length === 0) {
      failures.push(
        `${name}: marker "${marker}" appears in no chunk, so its eager-bytes ` +
          `check verified nothing. Either the library is gone (drop the entry) ` +
          `or the marker needs re-deriving from a real build.`,
      );
      continue;
    }
    const inEager = carriers.filter((file) => eager.has(file));
    if (inEager.length > 0) {
      const kb = (file) =>
        Math.round(fs.statSync(path.join(assets, file)).size / 1024);
      failures.push(
        `${name} is in ${inEager
          .map((file) => `${file} (${kb(file)} KB)`)
          .join(", ")}, which the browser fetches before the app is usable. ` +
          `Something on the eager path imports it — often a small helper ` +
          `exported from a module that also imports the library. Move the ` +
          `helper to its own file, or put the consumer behind React.lazy.`,
      );
    }
  }

  return failures;
}

function main() {
  const distDir = path.resolve(
    process.argv[2] ??
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist"),
  );
  const failures = verifyLazyChunks(distDir);

  if (failures.length > 0) {
    console.error("verify-lazy-chunks failed:\n");
    for (const failure of failures) console.error(`  - ${failure}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `verify-lazy-chunks: ${LAZY_CHUNK_PREFIXES.length} lazy chunk(s) reachable by ` +
      `dynamic import only; ${EAGER_FORBIDDEN_LIBRARIES.length} librar(ies) absent ` +
      `from the eager path.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
