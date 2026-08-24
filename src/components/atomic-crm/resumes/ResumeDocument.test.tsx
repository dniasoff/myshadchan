import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { DataProvider } from "ra-core";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Resume, ResumeFileVersion } from "../types";
import { ResumeDocument } from "./ResumeDocument";

/**
 * The Resume tab's whole subject is one document, and it used to show
 * everything except that document: an upload button, a one-line file row, and
 * the resume itself hidden behind a "View" that opened a dialog over the
 * page. These pin the embed — that the newest version renders in the page
 * without anyone clicking, that an older one can be swapped in, and that the
 * swap affordance does not appear when there is nothing to swap to.
 *
 * Each test renders its own tree and queries the document for the frame,
 * which the file name (unique per test) scopes. There is deliberately no
 * `cleanup()` — teardown between renders leaves later ones unqueryable in
 * this harness (see `shidduchim/PipelineStateOptions.test.tsx`).
 */
const SIGNED = "https://storage.example/signed";

const version = (
  overrides: Partial<ResumeFileVersion> = {},
): ResumeFileVersion => ({
  path: "acct/resumes/1/old.pdf",
  filename: "old.pdf",
  uploaded_at: "2026-01-01T00:00:00Z",
  uploaded_by: null,
  mime_type: "application/pdf",
  size: 1000,
  ...overrides,
});

function providerFor(files: ResumeFileVersion[]) {
  const signResumeFileUrl = vi.fn(
    (params: { storagePath: string; inline?: boolean }) =>
      Promise.resolve(`${SIGNED}/${params.storagePath}`),
  );
  const dataProvider = {
    getList: (resource: string) =>
      resource === "resumes"
        ? Promise.resolve({
            data: [{ id: 1, files, created_at: "" } as unknown as Resume],
            total: 1,
          })
        : Promise.resolve({ data: [], total: 0 }),
    signResumeFileUrl,
  } as unknown as DataProvider;
  return { dataProvider, signResumeFileUrl };
}

const renderDocument = async (files: ResumeFileVersion[]) => {
  const { dataProvider, signResumeFileUrl } = providerFor(files);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResumeDocument shidduchimId={1} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, signResumeFileUrl };
};

const frameFor = (title: string) =>
  document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`);

describe("ResumeDocument — the resume is on the page, not behind a click", () => {
  it("embeds the newest version without anyone opening anything", async () => {
    // Arrange / Act — an older version listed first, to prove the embed picks
    // by `uploaded_at` rather than by array order.
    await renderDocument([
      version({ path: "p/older-a.pdf", filename: "older-a.pdf" }),
      version({
        path: "p/newest-a.pdf",
        filename: "newest-a.pdf",
        uploaded_at: "2026-06-01T00:00:00Z",
      }),
    ]);

    // Assert
    await expect
      .poll(() => frameFor("newest-a.pdf")?.src)
      .toBe(`${SIGNED}/p/newest-a.pdf`);
    expect(frameFor("older-a.pdf")).toBeNull();
  });

  it("asks for the viewing form of the URL, so it renders instead of downloading", async () => {
    // Arrange / Act
    const { signResumeFileUrl } = await renderDocument([
      version({ path: "p/inline-b.pdf", filename: "inline-b.pdf" }),
    ]);

    // Assert — `inline: false` is what puts `Content-Disposition: attachment`
    // on the URL; the embed must never ask for that.
    await expect
      .poll(() => signResumeFileUrl.mock.calls.length)
      .toBeGreaterThanOrEqual(1);
    expect(signResumeFileUrl).toHaveBeenCalledWith(
      expect.objectContaining({ inline: true }),
    );
  });

  it("swaps the embed to an older version on Show", async () => {
    // Arrange
    const { screen } = await renderDocument([
      version({
        path: "p/newest-c.pdf",
        filename: "newest-c.pdf",
        uploaded_at: "2026-06-01T00:00:00Z",
      }),
      version({ path: "p/older-c.pdf", filename: "older-c.pdf" }),
    ]);
    await expect.poll(() => frameFor("newest-c.pdf")).not.toBeNull();

    // Act — the newest row is already shown, so the only Show belongs to the
    // older version.
    await screen.getByRole("button", { name: "Show" }).click();

    // Assert
    await expect
      .poll(() => frameFor("older-c.pdf")?.src)
      .toBe(`${SIGNED}/p/older-c.pdf`);
    expect(frameFor("newest-c.pdf")).toBeNull();
  });

  it("offers no Show button when there is only one version to show", async () => {
    // Arrange / Act — a control that cannot change anything is the same
    // defect as pagination on a single-page list.
    const { screen } = await renderDocument([
      version({ path: "p/only-d.pdf", filename: "only-d.pdf" }),
    ]);
    await expect.poll(() => frameFor("only-d.pdf")).not.toBeNull();

    // Assert — but Download stays, because keeping a copy is still meaningful.
    expect(screen.getByRole("button", { name: "Show" }).query()).toBeNull();
    await expect
      .element(screen.getByRole("button", { name: "Download" }))
      .toBeVisible();
  });

  it("renders no embed at all when no resume has been uploaded", async () => {
    // Arrange / Act
    const { screen } = await renderDocument([]);

    // Assert — an empty bordered box would read as a broken document.
    await expect
      .element(screen.getByText("No resume uploaded yet."))
      .toBeVisible();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
