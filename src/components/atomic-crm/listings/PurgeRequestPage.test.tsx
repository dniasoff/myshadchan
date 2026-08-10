import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { PurgeRequestPage } from "./PurgeRequestPage";

const buildDataProvider = (): CrmDataProvider =>
  ({
    create: vi.fn(),
    getList: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
    getOne: vi.fn(() => Promise.resolve({ data: null })),
    getMany: vi.fn(() => Promise.resolve({ data: [] })),
    update: vi.fn(),
    delete: vi.fn(),
  }) as unknown as CrmDataProvider;

const renderPage = async (
  dataProvider: CrmDataProvider = buildDataProvider(),
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <TestMemoryRouter initialEntries={["/purge-request"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <PurgeRequestPage />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("PurgeRequestPage — renders the form fields", () => {
  it("shows all three fields: name, contact, and details", async () => {
    const dataProvider = buildDataProvider();
    const screen = await renderPage(dataProvider);

    await expect
      .element(screen.getByLabelText("Your full name"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("Email or phone to reach you"))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByLabelText("Anything else that helps us find your record"),
      )
      .toBeInTheDocument();
  });
});

describe("PurgeRequestPage — validation blocks empty submit", () => {
  it("shows errors when submitting with empty fields", async () => {
    const dataProvider = buildDataProvider();
    const screen = await renderPage(dataProvider);

    const submitButton = screen.getByRole("button", {
      name: /submit request/i,
    });
    await submitButton.click();

    await expect
      .element(screen.getByText("Your name is required"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("An email or phone number is required"))
      .toBeInTheDocument();

    expect(dataProvider.create).not.toHaveBeenCalled();
  });
});

describe("PurgeRequestPage — filled form calls data provider once", () => {
  it("calls create with entered values and shows success state", async () => {
    let resolveCreate: (value: { data: { id: number } }) => void = () => {};
    const create = vi.fn(
      () =>
        new Promise<{ data: { id: number } }>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const dataProvider = buildDataProvider();
    (dataProvider.create as unknown as typeof create) = create;

    const screen = await renderPage(dataProvider);

    const nameInput = screen.getByLabelText("Your full name");
    const contactInput = screen.getByLabelText("Email or phone to reach you");
    const detailsInput = screen.getByLabelText(
      "Anything else that helps us find your record",
    );
    const submitButton = screen.getByRole("button", {
      name: /submit request/i,
    });

    await nameInput.fill("Chaya Cohen");
    await contactInput.fill("chaya@example.com");
    await detailsInput.fill("Lakewood, suggested 2023 by Rivka Klein");

    await submitButton.click();

    await expect
      .poll(() => create.mock.calls.length, { timeout: 2000 })
      .toBe(1);

    expect(create).toHaveBeenCalledWith("purge_requests", {
      data: {
        single_name: "Chaya Cohen",
        contact: "chaya@example.com",
        details: "Lakewood, suggested 2023 by Rivka Klein",
      },
    });

    resolveCreate({ data: { id: 42 } });

    await expect.element(screen.getByText(/request submitted/i)).toBeVisible();
    await expect
      .element(screen.getByText(/verification link has been sent/i))
      .toBeVisible();
  });
});

describe("PurgeRequestPage — error state on failed submit", () => {
  it("shows error message when data provider throws", async () => {
    const create = vi.fn(() => Promise.reject(new Error("network error")));
    const dataProvider = buildDataProvider();
    dataProvider.create = create;

    const screen = await renderPage(dataProvider);

    const nameInput = screen.getByLabelText("Your full name");
    const contactInput = screen.getByLabelText("Email or phone to reach you");
    const submitButton = screen.getByRole("button", {
      name: /submit request/i,
    });

    await nameInput.fill("Chaya Cohen");
    await contactInput.fill("chaya@example.com");
    await submitButton.click();

    await expect
      .element(screen.getByText(/could not submit your request/i))
      .toBeVisible();
  });
});

describe("PurgeRequestPage — accessibility", () => {
  it("has proper label associations and keyboard navigation", async () => {
    const dataProvider = buildDataProvider();
    const screen = await renderPage(dataProvider);

    const nameInput = screen.getByLabelText("Your full name");
    const contactInput = screen.getByLabelText("Email or phone to reach you");
    const detailsInput = screen.getByLabelText(
      "Anything else that helps us find your record",
    );

    await expect.element(nameInput).toHaveAttribute("id");
    await expect.element(contactInput).toHaveAttribute("id");
    await expect.element(detailsInput).toHaveAttribute("id");

    nameInput.element().focus();
    expect(document.activeElement).toBe(nameInput.element());
    contactInput.element().focus();
    expect(document.activeElement).toBe(contactInput.element());
    detailsInput.element().focus();
    expect(document.activeElement).toBe(detailsInput.element());
  });
});
