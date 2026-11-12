import { describe, expect, it } from "vitest";

import {
  MAX_PHOTO_UPLOAD_BYTES,
  PHOTO_UPLOAD_ACCEPT,
  validatePhotoUpload,
} from "./photoUpload";

describe("photo upload validation", () => {
  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["photo.heic", "image/heic"],
    ["photo.webp", "image/webp"],
  ])("accepts %s", (name, type) => {
    expect(
      validatePhotoUpload({ name, type, size: MAX_PHOTO_UPLOAD_BYTES }),
    ).toBeNull();
  });

  it("accepts a browser-provided octet-stream when the extension is supported", () => {
    expect(
      validatePhotoUpload({
        name: "photo.heic",
        type: "application/octet-stream",
        size: 100,
      }),
    ).toBeNull();
  });

  it("rejects unsupported types with the plain-English message", () => {
    expect(
      validatePhotoUpload({ name: "photo.gif", type: "image/gif", size: 100 }),
    ).toBe(
      "This file type is not supported. Choose a JPG, PNG, HEIC or WebP photo.",
    );
  });

  it("rejects photos larger than 8 MB", () => {
    expect(
      validatePhotoUpload({
        name: "photo.jpg",
        type: "image/jpeg",
        size: MAX_PHOTO_UPLOAD_BYTES + 1,
      }),
    ).toBe("This photo is too large. Choose a photo up to 8 MB.");
  });

  it("rejects empty photos with a plain-English message", () => {
    expect(
      validatePhotoUpload({ name: "photo.jpg", type: "image/jpeg", size: 0 }),
    ).toBe("This photo is empty. Choose a photo with some content.");
  });

  it("advertises only the supported photo types to the native picker", () => {
    expect(PHOTO_UPLOAD_ACCEPT).toContain("image/heic");
    expect(PHOTO_UPLOAD_ACCEPT).toContain(".webp");
    expect(PHOTO_UPLOAD_ACCEPT).not.toContain("image/gif");
  });
});
