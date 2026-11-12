import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  DocxExtractionError,
  MAX_DOCX_EXTRACTED_TEXT_BYTES,
  MAX_DOCX_UNCOMPRESSED_BYTES,
  MAX_DOCX_ZIP_ENTRIES,
  extractDocxText,
  inspectDocxZip,
} from "./docxExtractor";

async function makeDocx(documentBody: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${documentBody}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeBilingualDocx(): Promise<ArrayBuffer> {
  return makeDocx(
    "<w:p><w:r><w:t>Ari Rosenberg</w:t></w:r></w:p><w:p><w:r><w:t>בית יעקב</w:t></w:r></w:p>",
  );
}

function firstCentralDirectoryRecord(buffer: ArrayBuffer): number {
  const data = new Uint8Array(buffer);
  for (let offset = 0; offset + 4 <= data.byteLength; offset += 1) {
    if (
      data[offset] === 0x50 &&
      data[offset + 1] === 0x4b &&
      data[offset + 2] === 0x01 &&
      data[offset + 3] === 0x02
    ) {
      return offset;
    }
  }
  throw new Error("fixture has no central directory");
}

function endOfCentralDirectory(buffer: ArrayBuffer): number {
  const data = new Uint8Array(buffer);
  for (let offset = data.byteLength - 22; offset >= 0; offset -= 1) {
    if (
      data[offset] === 0x50 &&
      data[offset + 1] === 0x4b &&
      data[offset + 2] === 0x05 &&
      data[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("fixture has no EOCD");
}

describe("DOCX extraction safety", () => {
  it("extracts English and Hebrew prose through Mammoth", async () => {
    const text = await extractDocxText(await makeBilingualDocx());

    expect(text).toContain("Ari Rosenberg");
    expect(text).toContain("בית יעקב");
  });

  it("rejects an empty document with a typed, content-free failure", async () => {
    await expect(extractDocxText(await makeDocx(""))).rejects.toMatchObject({
      failure: "empty",
      message: "DOCX extraction failed",
    });
  });

  it("rejects malformed bytes without exposing parser details", async () => {
    await expect(extractDocxText(new ArrayBuffer(4))).rejects.toMatchObject({
      failure: "malformed",
      message: "DOCX extraction failed",
    });
  });

  it("rejects encrypted entries before Mammoth can decompress them", async () => {
    const buffer = await makeBilingualDocx();
    const view = new DataView(buffer);
    const record = firstCentralDirectoryRecord(buffer);
    view.setUint16(record + 8, 1, true);

    expect(() => inspectDocxZip(buffer)).toThrowError(DocxExtractionError);
    try {
      inspectDocxZip(buffer);
    } catch (error) {
      expect(error).toMatchObject({ failure: "password_protected" });
    }
  });

  it("rejects a ZIP bomb declared above the uncompressed budget", async () => {
    const buffer = await makeBilingualDocx();
    const view = new DataView(buffer);
    const record = firstCentralDirectoryRecord(buffer);
    view.setUint32(record + 24, MAX_DOCX_UNCOMPRESSED_BYTES + 1, true);

    expect(() => inspectDocxZip(buffer)).toThrowError(DocxExtractionError);
    try {
      inspectDocxZip(buffer);
    } catch (error) {
      expect(error).toMatchObject({ failure: "too_large" });
    }
  });

  it("rejects an archive with too many entries", async () => {
    const buffer = await makeBilingualDocx();
    const view = new DataView(buffer);
    const eocd = endOfCentralDirectory(buffer);
    view.setUint16(eocd + 8, MAX_DOCX_ZIP_ENTRIES + 1, true);
    view.setUint16(eocd + 10, MAX_DOCX_ZIP_ENTRIES + 1, true);

    expect(() => inspectDocxZip(buffer)).toThrowError(DocxExtractionError);
    try {
      inspectDocxZip(buffer);
    } catch (error) {
      expect(error).toMatchObject({ failure: "too_large" });
    }
  });

  it("exposes the extracted text bound as a finite byte budget", () => {
    expect(MAX_DOCX_EXTRACTED_TEXT_BYTES).toBe(256 * 1024);
  });
});
