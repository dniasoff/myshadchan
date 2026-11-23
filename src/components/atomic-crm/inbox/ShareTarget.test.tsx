import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { ShareTarget } from "./ShareTarget";
import {
  applyParsedResumeFields,
  uploadSharedFiles,
} from "./ShareTarget.helpers";

const { uploadToBucket } = vi.hoisted(() => ({ uploadToBucket: vi.fn() }));
vi.mock("../providers/supabase/dataProvider", () => ({ uploadToBucket }));

const renderShareTarget = async () => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as unknown as CrmDataProvider;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const screen = await render(
    <TestMemoryRouter initialEntries={["/share?text=hello"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ShareTarget />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider };
};

describe("Android share target", () => {
  it("reports partial uploads for cleanup instead of leaving the first file orphaned", async () => {
    uploadToBucket
      .mockResolvedValueOnce({
        title: "first.jpg",
        type: "image/jpeg",
        path: "10/inbox/1/first.jpg",
        src: "first",
      })
      .mockRejectedValueOnce(new Error("second failed"));
    const cleanup = vi.fn().mockResolvedValue(undefined);

    await expect(
      uploadSharedFiles(
        [
          new File(["first"], "first.jpg", { type: "image/jpeg" }),
          new File(["second"], "second.jpg", { type: "image/jpeg" }),
        ],
        1,
        async (uploaded) => cleanup(uploaded.map((file) => file.path)),
      ),
    ).rejects.toThrow("second failed");
    expect(cleanup).toHaveBeenCalledWith(["10/inbox/1/first.jpg"]);
  });

  it("maps the complete parsed resume into the suggestion payload", () => {
    const input = { single_id: 1 };
    applyParsedResumeFields(
      input,
      {
        name_en: "Model Name",
        name_he: "שם",
        father_en: "Father",
        father_he: null,
        mother_en: "Mother",
        mother_he: null,
        seminary_en: "Seminary",
        seminary_he: null,
        shul_en: "Shul",
        shul_he: null,
        location_en: "Jerusalem",
        location_he: null,
        age: 24,
        height: "5'6\"",
        person_gender: "female",
        kohen_status: null,
        marital_status: "single",
      },
      "Edited Name",
      "Bold Name",
    );

    expect(input).toMatchObject({
      name_en: "Edited Name",
      name_he: "שם",
      father_en: "Father",
      mother_en: "Mother",
      seminary_en: "Seminary",
      location_en: "Jerusalem",
      age: 24,
      height: "5'6\"",
      person_gender: "female",
      marital_status: "single",
    });
  });

  it("filters the shadchan picker to active rows", async () => {
    const { dataProvider } = await renderShareTarget();

    await expect
      .poll(() =>
        (dataProvider.getList as ReturnType<typeof vi.fn>).mock.calls.some(
          ([resource, params]) =>
            resource === "shadchanim" &&
            params.filter?.["archived_at@is"] === null,
        ),
      )
      .toBe(true);
  });

  it("advertises images and resume document MIME types", async () => {
    const manifest = (await fetch("/manifest.json").then((response) =>
      response.json(),
    )) as {
      share_target: { params: { files: Array<{ accept: string[] }> } };
    };
    const accept = manifest.share_target.params.files[0]?.accept;
    expect(accept).toEqual([
      "image/*",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });
});
