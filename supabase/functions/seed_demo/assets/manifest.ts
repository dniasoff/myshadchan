import { ASSETS_BASE64 } from "./manifest_base64.ts";

/** Canonical paths generated and packed by generate_assets.py. */
export type AssetKey = keyof typeof ASSETS_BASE64;

/** Canonical immutable, pre-watermarked demo share artifact. */
export const DEMO_SHARE_ASSET_KEY: AssetKey =
  "misc/rivky-klein-for-leah-feldman.pdf";

export const ASSET_PATHS = Object.keys(ASSETS_BASE64) as AssetKey[];

// Keep the manifest usable by both Deno edge tests and the repository's
// Node/TypeScript checker.  The asset inventory is intentionally closed, so a
// small local table is safer than importing a Deno-only JSR module here.
const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export async function getAssetBytes(key: AssetKey): Promise<Uint8Array> {
  const b64 = ASSETS_BASE64[key];
  if (!b64) throw new Error(`Asset not found in packed manifest: ${key}`);
  return Uint8Array.from(atob(b64), (character) => character.charCodeAt(0));
}

export function getAssetMimeType(key: AssetKey): string {
  const extension = key.slice(key.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[extension] ?? "application/octet-stream";
}
