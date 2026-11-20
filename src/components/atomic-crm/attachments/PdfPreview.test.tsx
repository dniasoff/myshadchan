import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { PdfPreview } from "./PdfPreview";

const pdfMocks = vi.hoisted(() => {
  const getDocument = vi.fn();
  const workerOptions = {};
  return { getDocument, workerOptions };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: pdfMocks.workerOptions,
  getDocument: pdfMocks.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "worker.js",
}));

type RenderTask = {
  promise: Promise<void>;
  cancel: ReturnType<typeof vi.fn>;
};

const makePdf = (baseWidth = 600, baseHeight = 800) => {
  const tasks: Array<{
    resolve: () => void;
    task: RenderTask;
  }> = [];
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: baseWidth * scale,
      height: baseHeight * scale,
    })),
    render: vi.fn(() => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      const task: RenderTask = {
        promise,
        cancel: vi.fn(),
      };
      tasks.push({ resolve, task });
      return task;
    }),
  };
  const documentProxy = {
    numPages: 1,
    getPage: vi.fn().mockResolvedValue(page),
  };
  const loadingTask = {
    promise: Promise.resolve(documentProxy),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  pdfMocks.getDocument.mockReturnValue(loadingTask);
  return { documentProxy, loadingTask, page, tasks };
};

const renderPdf = async (width = 600) => {
  const signUrl = vi
    .fn()
    .mockResolvedValue("https://storage.example/resume.pdf");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new ArrayBuffer(0), { status: 200 }),
  );
  const screen = await render(
    <CoreAdminContext i18nProvider={testI18nProvider}>
      <div style={{ height: "800px", width: `${width}px` }}>
        <PdfPreview
          fileName="test.pdf"
          signUrl={signUrl}
          active
          onDownload={() => {}}
        />
      </div>
    </CoreAdminContext>,
  );
  return { screen, signUrl };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PdfPreview rendering lifecycle", () => {
  beforeEach(() => {
    pdfMocks.getDocument.mockReset();
  });

  it("uses the measured CSS width and caps DPR 3 at two device pixels per CSS pixel", async () => {
    const { page, tasks } = makePdf();
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(3);
    const { screen } = await renderPdf(600);

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    const renderScale = page.getViewport.mock.calls.at(-1)?.[0].scale;
    expect(renderScale).toBe(2);
    tasks[0].resolve();
    await expect
      .poll(() => screen.container.querySelector("canvas")?.width ?? 0)
      .toBeGreaterThan(900);
  });

  it("re-renders after a container resize and cancels the stale render", async () => {
    const { page, tasks } = makePdf();
    const { screen } = await renderPdf(600);

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    const wrapper = screen.container.querySelector<HTMLElement>(
      '[style*="width: 600px"]',
    );
    expect(wrapper).not.toBeNull();
    if (wrapper) wrapper.style.width = "400px";

    await expect.poll(() => page.render.mock.calls.length).toBe(2);
    expect(tasks[0].task.cancel).toHaveBeenCalledTimes(1);
    expect(page.getViewport.mock.calls.at(-1)?.[0].scale).toBeCloseTo(2 / 3);
    tasks[1].resolve();
  });

  it("keeps unusually tall pages under the canvas area cap", async () => {
    const { page, tasks } = makePdf(600, 6000);
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(3);
    await renderPdf(600);

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    const renderScale = page.getViewport.mock.calls.at(-1)?.[0].scale ?? 0;
    expect(600 * renderScale * (6000 * renderScale)).toBeLessThanOrEqual(
      8_300_000,
    );
    expect(renderScale).toBeLessThan(2);
    tasks[0].resolve();
  });

  it("cancels a pending page render on unmount without creating another document", async () => {
    const { page, tasks, loadingTask } = makePdf();
    const { screen } = await renderPdf();

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    screen.unmount();

    expect(tasks[0].task.cancel).toHaveBeenCalledTimes(1);
    expect(loadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1);
  });
});
