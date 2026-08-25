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
    `verify-lazy-chunks: ${LAZY_CHUNK_PREFIXES.length} lazy chunk(s) reachable by dynamic import only.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
