export const MAX_PHOTO_UPLOAD_BYTES = 8 * 1024 * 1024;

export const PHOTO_UPLOAD_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".webp",
].join(",");

const MIME_BY_EXTENSION: Record<string, string> = {
  heic: "image/heic",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const PHOTO_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function photoMimeType(file: Pick<File, "name" | "type">): string {
  const extensionMime = MIME_BY_EXTENSION[extensionOf(file.name)];
  return !file.type || file.type === "application/octet-stream"
    ? extensionMime || file.type
    : file.type;
}

export function validatePhotoUpload(
  file: Pick<File, "name" | "type" | "size">,
): string | null {
  if (file.size === 0) {
    return "This photo is empty. Choose a photo with some content.";
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    return "This photo is too large. Choose a photo up to 8 MB.";
  }
  if (!PHOTO_MIME_TYPES.has(photoMimeType(file))) {
    return "This file type is not supported. Choose a JPG, PNG, HEIC or WebP photo.";
  }
  return null;
}
