import { contentType } from "jsr:@std/media-types@1";
import { ASSETS_BASE64 } from "./manifest_base64.ts";

/**
 * Demo asset manifest: small, fictional/synthetic files bundled with the
 * seed_demo edge function. Every value is a thunk returning a Uint8Array so
 * Deno.readFile runs only when the asset is actually needed.
 *
 * The read falls back to an embedded base64 copy when the on-disk file is not
 * available (e.g. `supabase functions serve` does not bundle static assets into
 * the temporary runtime directory). Deployed functions use the real files on
 * disk; the base64 fallback is only for local development and smoke tests.
 */
export const ASSETS = {
  portraits: {
    rivky: () => readAsset("portraits/rivky-stern.jpg"),
    yaakov: () => readAsset("portraits/yaakov-stern.jpg"),
    ahron: () => readAsset("portraits/ahron-klein.jpg"),
    eliezer: () => readAsset("portraits/eliezer-katz.jpg"),
    yosef: () => readAsset("portraits/yosef-mandel.jpg"),
    estherMalka: () => readAsset("portraits/esther-malka-weiss.jpg"),
    devoraLeah: () => readAsset("portraits/devora-leah-gross.jpg"),
    shira: () => readAsset("portraits/shira-feldman.jpg"),
  },
  resumes: {
    rivky: () => readAsset("resumes/rivky-stern.pdf"),
    yaakov: () => readAsset("resumes/yaakov-stern.pdf"),
    ahron: () => readAsset("resumes/ahron-klein.pdf"),
    eliezer: () => readAsset("resumes/eliezer-katz.pdf"),
    yosef: () => readAsset("resumes/yosef-mandel.pdf"),
    estherMalka: () => readAsset("resumes/esther-malka-weiss.pdf"),
    devoraLeah: () => readAsset("resumes/devora-leah-gross.pdf"),
    shira: () => readAsset("resumes/shira-feldman.pdf"),
  },
  misc: {
    familyNotes: () => readAsset("misc/family-notes.pdf"),
    referenceSummary: () => readAsset("misc/reference-summary.pdf"),
    steinNotes: () => readAsset("misc/stein-notes.pdf"),
  },
} as const;

export type AssetKey =
  | keyof typeof ASSETS.portraits
  | keyof typeof ASSETS.resumes
  | keyof typeof ASSETS.misc;

async function readAsset(relativePath: string): Promise<Uint8Array> {
  try {
    return await Deno.readFile(new URL(`./${relativePath}`, import.meta.url));
  } catch {
    const b64 = ASSETS_BASE64[relativePath];
    if (!b64) {
      throw new Error(
        `Asset not found on disk or in base64 fallback: ${relativePath}`,
      );
    }
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
}

export async function getAssetBytes(key: AssetKey): Promise<Uint8Array> {
  const getter =
    ASSETS.portraits[key as keyof typeof ASSETS.portraits] ??
    ASSETS.resumes[key as keyof typeof ASSETS.resumes] ??
    ASSETS.misc[key as keyof typeof ASSETS.misc];
  if (!getter) {
    throw new Error(`Unknown asset key: ${key}`);
  }
  return getter();
}

export function getAssetMimeType(key: AssetKey): string {
  const fileName = keyToFileName(key);
  return contentType(fileName) ?? "application/octet-stream";
}

function keyToFileName(key: AssetKey): string {
  if (key in ASSETS.portraits) return `${key}.jpg`;
  if (key in ASSETS.resumes) return `${key}.pdf`;
  return `${key}.pdf`;
}
