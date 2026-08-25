import { vi } from "vitest";

import {
  assetBase64,
  type AssetKey,
} from "@/components/atomic-crm/providers/fakerest/dataGenerator/assets";

/**
 * Real PDF bytes for tests, and a `fetch` stub that serves them.
 *
 * `attachments/PdfPreview` parses the file with pdf.js rather than handing a
 * URL to the browser, so a test that stubs `signUrl` alone is not enough any
 * more — the component then really fetches, and a fabricated
 * `https://storage.example/...` would 404. It also means a hand-rolled
 * "%PDF-1.4 …" string will not do: pdf.js validates the xref table and throws.
 *
 * The demo's own seeded asset is used instead — a genuine 122 KB single-page
 * PDF that already lives in the repo, so the fixture is real bytes rather
 * than something invented to satisfy the parser.
 */
const FIXTURE_ASSET: AssetKey = "misc/family-notes.pdf";

export function realPdfBytes(): ArrayBuffer {
  const binary = atob(assetBase64(FIXTURE_ASSET));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/**
 * Serves `realPdfBytes()` for every request, and restores the real `fetch` on
 * teardown. Returns the spy so a test can assert what was requested.
 */
export function stubFetchWithPdf(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(realPdfBytes(), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    ),
  );
}

/**
 * Whether a canvas has actually been PAINTED, not merely mounted.
 *
 * Two separate facts, because either alone is weak. An unpainted canvas keeps
 * the HTML default 300×150 intrinsic size, so a larger one proves the render
 * pass ran and sized it from the page's viewport; and a canvas can be sized
 * and still be blank (iOS silently hands back an empty one past its area
 * limit — the exact failure this whole change exists to avoid), so the pixels
 * are checked for actual ink as well.
 */
export function isCanvasPainted(canvas: HTMLCanvasElement): boolean {
  if (canvas.width <= 300 || canvas.height <= 150) return false;
  const context = canvas.getContext("2d");
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const first = [data[0], data[1], data[2], data[3]].join(",");
  for (let index = 4; index < data.length; index += 4) {
    const pixel = [
      data[index],
      data[index + 1],
      data[index + 2],
      data[index + 3],
    ].join(",");
    if (pixel !== first) return true;
  }
  return false;
}
