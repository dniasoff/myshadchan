import { contentType } from "jsr:@std/media-types@1";

/**
 * Demo asset manifest: small, fictional/synthetic files bundled with the
 * seed_demo edge function. Every value is a thunk returning a Uint8Array so
 * Deno.readFile runs only when the asset is actually needed.
 */
export const ASSETS = {
  portraits: {
    rivky: () =>
      Deno.readFile(new URL("./portraits/rivky-stern.jpg", import.meta.url)),
    yaakov: () =>
      Deno.readFile(new URL("./portraits/yaakov-stern.jpg", import.meta.url)),
    ahron: () =>
      Deno.readFile(new URL("./portraits/ahron-klein.jpg", import.meta.url)),
    eliezer: () =>
      Deno.readFile(new URL("./portraits/eliezer-katz.jpg", import.meta.url)),
    yosef: () =>
      Deno.readFile(new URL("./portraits/yosef-mandel.jpg", import.meta.url)),
    estherMalka: () =>
      Deno.readFile(
        new URL("./portraits/esther-malka-weiss.jpg", import.meta.url),
      ),
    devoraLeah: () =>
      Deno.readFile(
        new URL("./portraits/devora-leah-gross.jpg", import.meta.url),
      ),
    shira: () =>
      Deno.readFile(new URL("./portraits/shira-feldman.jpg", import.meta.url)),
  },
  resumes: {
    rivky: () =>
      Deno.readFile(new URL("./resumes/rivky-stern.pdf", import.meta.url)),
    yaakov: () =>
      Deno.readFile(new URL("./resumes/yaakov-stern.pdf", import.meta.url)),
    ahron: () =>
      Deno.readFile(new URL("./resumes/ahron-klein.pdf", import.meta.url)),
    eliezer: () =>
      Deno.readFile(new URL("./resumes/eliezer-katz.pdf", import.meta.url)),
    yosef: () =>
      Deno.readFile(new URL("./resumes/yosef-mandel.pdf", import.meta.url)),
    estherMalka: () =>
      Deno.readFile(
        new URL("./resumes/esther-malka-weiss.pdf", import.meta.url),
      ),
    devoraLeah: () =>
      Deno.readFile(
        new URL("./resumes/devora-leah-gross.pdf", import.meta.url),
      ),
    shira: () =>
      Deno.readFile(new URL("./resumes/shira-feldman.pdf", import.meta.url)),
  },
  misc: {
    familyNotes: () =>
      Deno.readFile(new URL("./misc/family-notes.pdf", import.meta.url)),
    referenceSummary: () =>
      Deno.readFile(new URL("./misc/reference-summary.pdf", import.meta.url)),
    steinNotes: () =>
      Deno.readFile(new URL("./misc/stein-notes.pdf", import.meta.url)),
  },
} as const;

export type AssetKey =
  | keyof typeof ASSETS.portraits
  | keyof typeof ASSETS.resumes
  | keyof typeof ASSETS.misc;

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
