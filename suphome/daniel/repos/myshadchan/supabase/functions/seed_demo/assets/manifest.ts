import { contentType } from "jsr:@std/media-types@1";

type AssetThunk = () => Promise<Uint8Array>;

function asset(fileName: string): AssetThunk {
  return () => Deno.readFile(new URL(`./${fileName}`, import.meta.url));
}

/**
 * Demo asset manifest: small, fictional/synthetic files bundled with the
 * seed_demo edge function. Every value is a thunk returning a Uint8Array so
 * Deno.readFile runs only when the asset is actually needed.
 */
export const ASSETS = {
  portraits: {
    rivky: asset("portraits/rivky-stern.jpg"),
    yaakov: asset("portraits/yaakov-stern.jpg"),
    ahron: asset("portraits/ahron-klein.jpg"),
    eliezer: asset("portraits/eliezer-katz.jpg"),
    yosef: asset("portraits/yosef-mandel.jpg"),
    estherMalka: asset("portraits/esther-malka-weiss.jpg"),
    devoraLeah: asset("portraits/devora-leah-gross.jpg"),
    shira: asset("portraits/shira-feldman.jpg"),
  },
  resumes: {
    rivky: asset("resumes/rivky-stern.pdf"),
    yaakov: asset("resumes/yaakov-stern.pdf"),
    ahron: asset("resumes/ahron-klein.pdf"),
    eliezer: asset("resumes/eliezer-katz.pdf"),
    yosef: asset("resumes/yosef-mandel.pdf"),
    estherMalka: asset("resumes/esther-malka-weiss.pdf"),
    devoraLeah: asset("resumes/devora-leah-gross.pdf"),
    shira: asset("resumes/shira-feldman.pdf"),
  },
  misc: {
    familyNotes: asset("misc/family-notes.pdf"),
    referenceSummary: asset("misc/reference-summary.pdf"),
    steinNotes: asset("misc/stein-notes.pdf"),
  },
} as const;

export type AssetKey =
  | keyof typeof ASSETS.portraits
  | keyof typeof ASSETS.resumes
  | keyof typeof ASSETS.misc;

const KEY_TO_FILENAME: Record<AssetKey, string> = {
  rivky: "portraits/rivky-stern.jpg",
  yaakov: "portraits/yaakov-stern.jpg",
  ahron: "portraits/ahron-klein.jpg",
  eliezer: "portraits/eliezer-katz.jpg",
  yosef: "portraits/yosef-mandel.jpg",
  estherMalka: "portraits/esther-malka-weiss.jpg",
  devoraLeah: "portraits/devora-leah-gross.jpg",
  shira: "portraits/shira-feldman.jpg",
  familyNotes: "misc/family-notes.pdf",
  referenceSummary: "misc/reference-summary.pdf",
  steinNotes: "misc/stein-notes.pdf",
};

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
  return contentType(KEY_TO_FILENAME[key]) ?? "application/octet-stream";
}
