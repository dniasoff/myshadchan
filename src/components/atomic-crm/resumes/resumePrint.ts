import type { CrmDataProvider } from "../providers/types";
import type { ResumeFileVersion, ResumePhoto } from "../types";
import { resolveAttachmentPreviewMode } from "../attachments/attachmentPreview";

export type ResumePrintMode = "browser" | "download";

export function getResumePrintMode(
  file: Pick<ResumeFileVersion, "mime_type" | "filename">,
): ResumePrintMode {
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
  const resumeUrl = await dataProvider.signResumeFileUrl({
    storagePath: resume.path,
    fileName: resume.filename,
    inline: getResumePrintMode(resume) === "browser",
  });
  const resumeBlob = await assertResponse(await fetcher(resumeUrl)).blob();

  let photoBlob: Blob | null = null;
  if (includePicture && photo) {
    const photoUrl = await dataProvider.signResumePhotoUrl({
      storagePath: photo.path,
    });
    photoBlob = await assertResponse(await fetcher(photoUrl)).blob();
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
): Promise<void> {
  const image = documentRef.createElement("img");
  const objectUrl = URL.createObjectURL(blob);
  image.alt = fileName;
  image.className = "print-image";
  return new Promise((resolve, reject) => {
    image.onload = () => {
      revokeObjectUrl(objectUrl);
      resolve();
    };
    image.onerror = () => {
      revokeObjectUrl(objectUrl);
      reject(new Error("The image could not be rendered"));
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
  const pdf = await loadingTask.promise;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = documentRef.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = "print-page";
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The PDF could not be rendered");
      documentRef.body.appendChild(canvas);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
    }
  } finally {
    await loadingTask.destroy();
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
    </style>`,
  );
  documentRef.close();
}

export async function printResume({
  openWindow = (url, target, features) => window.open(url, target, features),
  ...options
}: ResumePrintOptions): Promise<"printed" | "downloaded"> {
  if (getResumePrintMode(options.resume) === "download") {
    await downloadResumeFiles(options);
    return "downloaded";
  }

  const printWindow = openWindow("", "_blank", "popup") as PrintWindow | null;
  if (!printWindow) throw new Error("The print window was blocked");
  printWindow.opener = null;

  try {
    const files = await fetchSelectedFiles(options);
    preparePrintDocument(printWindow.document);
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
        );
      }
    }
    if (files.photoBlob && options.photo) {
      await appendImage(
        printWindow.document,
        files.photoBlob,
        photoFilename(options.photo),
      );
    }
    printWindow.focus();
    printWindow.print();
    return "printed";
  } finally {
    printWindow.close();
  }
}
