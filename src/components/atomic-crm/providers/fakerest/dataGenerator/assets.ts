import { ASSETS_BASE64 } from "./assets_base64";

/**
 * FakeRest demo asset manifest.
 *
 * The Supabase edge function bundles real files under
 * supabase/functions/seed_demo/assets/. For the in-browser FakeRest provider
 * we ship the same bytes as base64 strings and turn them into Blobs on demand.
 */

export type AssetKey = keyof typeof ASSETS_BASE64;

/** Canonical immutable, pre-watermarked demo share artifact. */
export const DEMO_SHARE_ASSET_KEY: AssetKey =
  "misc/rivky-klein-for-leah-feldman.pdf";

export function assetBase64(key: AssetKey): string {
  const data = ASSETS_BASE64[key];
  if (!data) throw new Error(`Unknown asset key: ${key}`);
  return data;
}

export function assetBlob(key: AssetKey): Blob {
  const base64 = assetBase64(key);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: assetMimeType(key) });
}

export function assetFile(key: AssetKey, fileName: string): File {
  const blob = assetBlob(key);
  return new File([blob], fileName, { type: blob.type });
}

export function assetMimeType(key: AssetKey): string {
  if (key.startsWith("portraits/")) return "image/jpeg";
  if (key.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export function assetFileName(key: AssetKey): string {
  return key.split("/").pop()!;
}
