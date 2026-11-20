import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { ShareTarget } from "./ShareTarget";

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
