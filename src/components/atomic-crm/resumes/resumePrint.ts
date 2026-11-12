import type { CrmDataProvider } from "../providers/types";
import type { ResumeFileVersion, ResumePhoto } from "../types";
import { resolveAttachmentPreviewMode } from "../attachments/attachmentPreview";

export type ResumePrintMode = "browser" | "download";

export type ResumePrintResult =
  "printed" | "printed-without-picture" | "downloaded";

export type ResumePrintErrorCode =
  | "popup-blocked"
  | "file-fetch-failed"
  | "resume-render-failed"
  | "photo-render-failed";

export class ResumePrintError extends Error {
  constructor(
    readonly code: ResumePrintErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResumePrintError";
  }
}

/** HEIC/HEIF is accepted at upload time but is not decoded by desktop print browsers. */
export function isIphoneFormatFile(
  file: Pick<ResumeFileVersion, "mime_type" | "filename">,
): boolean {
  const mimeType = file.mime_type.split(";", 1)[0].trim().toLowerCase();
  const extension = file.filename.split(".").pop()?.trim().toLowerCase();
  return (
    mimeType === "image/heic" ||
    mimeType === "image/heif" ||
    extension === "heic" ||
    extension === "heif"
  );
}

export function getResumePrintMode(
  file: Pick<ResumeFileVersion, "mime_type" | "filename">,
): ResumePrintMode {
  if (isIphoneFormatFile(file)) return "download";
  const mode = resolveAttachmentPreviewMode(file.mime_type, file.filename);
  return mode === "pdf" || mode === "image" ? "browser" : "download";
}

export function selectNewestEligiblePhoto(
  photos: readonly ResumePhoto[],
): ResumePhoto | null {
  return (
    photos
      .filter(
        (photo) => photo.visibility === "shared" && photo.hidden_at == null,
      )
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0] ?? null
  );
}

type PrintWindow = Window & { opener: Window | null };
type PhotoLike = Pick<ResumePhoto, "path">;

const PRINT_CLEANUP_TIMEOUT_MS = 120_000;

export type ResumePrintOptions = {
  dataProvider: Pick<
    CrmDataProvider,
    "signResumeFileUrl" | "signResumePhotoUrl"
  >;
  resume: ResumeFileVersion;
  photo: ResumePhoto | null;
  includePicture: boolean;
  openWindow?: (
    url?: string,
    target?: string,
    features?: string,
  ) => Window | null;
  fetcher?: typeof fetch;
};

type DownloadOptions = Omit<ResumePrintOptions, "openWindow">;

function assertResponse(response: Response): Response {
  if (!response.ok) throw new Error(`storage responded ${response.status}`);
  return response;
}

function isIphoneFormatPhoto(photo: PhotoLike, blob: Blob): boolean {
  const path = photo.path.toLowerCase();
  const mimeType = blob.type.split(";", 1)[0].trim().toLowerCase();
  return (
    mimeType === "image/heic" ||
    mimeType === "image/heif" ||
    path.endsWith(".heic") ||
    path.endsWith(".heif")
  );
}

function photoFilename(photo: ResumePhoto): string {
  const pathName = photo.path.split("/").pop() ?? `photo-${photo.id}.jpg`;
  const uuidName = pathName.match(/^[0-9a-f-]{36}-(.+)$/i)?.[1] ?? pathName;
  const safeName = uuidName.replace(/[\\/]/g, "-").trim();
  return safeName || `photo-${photo.id}.jpg`;
}

function revokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  revokeObjectUrl(url);
}

async function fetchSelectedFiles({
  dataProvider,
  resume,
  photo,
  includePicture,
  fetcher = fetch,
}: DownloadOptions): Promise<{ resumeBlob: Blob; photoBlob: Blob | null }> {
  let resumeBlob: Blob;
  try {
    const resumeUrl = await dataProvider.signResumeFileUrl({
      storagePath: resume.path,
      fileName: resume.filename,
      inline: getResumePrintMode(resume) === "browser",
    });
    resumeBlob = await assertResponse(await fetcher(resumeUrl)).blob();
  } catch (cause) {
    throw new ResumePrintError(
      "file-fetch-failed",
      "The resume could not be loaded",
      { cause },
    );
  }

  const printablePhoto =
    includePicture &&
    photo &&
    photo.visibility === "shared" &&
    photo.hidden_at == null
      ? photo
      : null;
  let photoBlob: Blob | null = null;
  if (printablePhoto) {
    try {
      const photoUrl = await dataProvider.signResumePhotoUrl({
        storagePath: printablePhoto.path,
      });
      photoBlob = await assertResponse(await fetcher(photoUrl)).blob();
    } catch (cause) {
      throw new ResumePrintError(
        "file-fetch-failed",
        "The picture could not be loaded",
        { cause },
      );
    }
  }

  return { resumeBlob, photoBlob };
}

export async function downloadResumeFiles(
  options: DownloadOptions,
): Promise<void> {
  const { resumeBlob, photoBlob } = await fetchSelectedFiles(options);
  downloadBlob(resumeBlob, options.resume.filename);
  if (photoBlob && options.photo)
    downloadBlob(photoBlob, photoFilename(options.photo));
}

function appendImage(
  documentRef: Document,
  blob: Blob,
  fileName: string,
  role: "resume" | "photo",
  objectUrls: Set<string>,
): Promise<void> {
  const image = documentRef.createElement("img");
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.add(objectUrl);
  image.alt = fileName;
  image.className = "print-image";
  return new Promise((resolve, reject) => {
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      objectUrls.delete(objectUrl);
      revokeObjectUrl(objectUrl);
      image.remove();
      reject(
        new ResumePrintError(
          role === "photo" ? "photo-render-failed" : "resume-render-failed",
          role === "photo"
            ? "The picture could not be rendered"
            : "The resume could not be rendered",
        ),
      );
    };
    image.src = objectUrl;
    documentRef.body.appendChild(image);
  });
}

async function appendPdfPages(
  documentRef: Document,
  resumeBlob: Blob,
): Promise<void> {
  const [pdfjs, workerUrl] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url").then(
      (module) => module.default,
    ),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({
    data: await resumeBlob.arrayBuffer(),
  });
  try {
    const pdf = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const requestedViewport = page.getViewport({ scale: 2 });
      const maxCanvasPixels = 8_300_000;
      const requestedPixels =
        requestedViewport.width * requestedViewport.height;
      const scaleFactor = Math.min(
        1,
        Math.sqrt(maxCanvasPixels / Math.max(requestedPixels, 1)),
      );
      const viewport =
        scaleFactor === 1
          ? requestedViewport
          : page.getViewport({ scale: 2 * scaleFactor });
      const canvas = documentRef.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = "print-page";
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The PDF could not be rendered");
      documentRef.body.appendChild(canvas);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
    }
  } catch (cause) {
    throw new ResumePrintError(
      "resume-render-failed",
      "The PDF could not be rendered",
      { cause },
    );
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

function preparePrintDocument(documentRef: Document): void {
  documentRef.open();
  documentRef.write(
    `<title>Resume</title><style>
      @page { margin: 0.5in; }
      body { margin: 0; display: flex; flex-direction: column; gap: 1rem; }
      .print-page, .print-image { display: block; max-width: 100%; break-after: page; }
      .print-image { max-height: 10in; object-fit: contain; }
    </style><p id="print-status">Preparing files for printing…</p>`,
  );
  documentRef.close();
}

function clearPrintStatus(documentRef: Document): void {
  documentRef.getElementById?.("print-status")?.remove();
}

function installPrintCleanup(
  printWindow: PrintWindow,
  objectUrls: Set<string>,
): () => void {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    printWindow.removeEventListener?.("afterprint", cleanup);
    objectUrls.forEach(revokeObjectUrl);
    objectUrls.clear();
    printWindow.document.body?.replaceChildren?.();
    printWindow.close();
  };
  printWindow.addEventListener?.("afterprint", cleanup);
  const timer = setTimeout(cleanup, PRINT_CLEANUP_TIMEOUT_MS);
  return cleanup;
}

export async function printResume({
  openWindow = (url, target, features) => window.open(url, target, features),
  ...options
}: ResumePrintOptions): Promise<ResumePrintResult> {
  if (getResumePrintMode(options.resume) === "download") {
    await downloadResumeFiles(options);
    return "downloaded";
  }

  const printWindow = openWindow("", "_blank", "popup") as PrintWindow | null;
  if (!printWindow)
    throw new ResumePrintError("popup-blocked", "The print window was blocked");
  printWindow.opener = null;
  const objectUrls = new Set<string>();
  const cleanup = installPrintCleanup(printWindow, objectUrls);

  try {
    preparePrintDocument(printWindow.document);
    const files = await fetchSelectedFiles(options);
    clearPrintStatus(printWindow.document);
    let result: ResumePrintResult = "printed";
    if (getResumePrintMode(options.resume) === "browser") {
      if (
        resolveAttachmentPreviewMode(
          options.resume.mime_type,
          options.resume.filename,
        ) === "pdf"
      ) {
        await appendPdfPages(printWindow.document, files.resumeBlob);
      } else {
        await appendImage(
          printWindow.document,
          files.resumeBlob,
          options.resume.filename,
          "resume",
          objectUrls,
        );
      }
    }
    if (files.photoBlob && options.photo) {
      try {
        await appendImage(
          printWindow.document,
          files.photoBlob,
          photoFilename(options.photo),
          "photo",
          objectUrls,
        );
      } catch (cause) {
        if (
          !(cause instanceof ResumePrintError) ||
          cause.code !== "photo-render-failed" ||
          !isIphoneFormatPhoto(options.photo, files.photoBlob)
        ) {
          throw cause;
        }
        result = "printed-without-picture";
      }
    }
    printWindow.focus();
    printWindow.print();
    return result;
  } catch (cause) {
    cleanup();
    throw cause;
  }
}
