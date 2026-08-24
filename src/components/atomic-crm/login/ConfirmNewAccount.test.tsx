import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { AuthProvider, DataProvider } from "ra-core";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import "@/index.css";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { ConfirmNewAccount } from "./ConfirmNewAccount";

const identity = { id: 1, fullName: "Daniel Niasoff" };

async function harness(overrides: { affirmAge?: () => Promise<void> } = {}) {
  const affirmAge = overrides.affirmAge ?? vi.fn(() => Promise.resolve());
  const onConfirmed = vi.fn();
  const unused = () => Promise.reject(new Error("not used in this test"));

  const dataProvider = {
    affirmAge,
    ageAffirmationPending: () => Promise.resolve(true),
    getList: unused,
    getOne: unused,
    getMany: unused,
    getManyReference: unused,
    create: unused,
    update: unused,
    updateMany: unused,
    delete: unused,
    deleteMany: unused,
  } as unknown as DataProvider;

  const logout = vi.fn(() => Promise.resolve());
  const authProvider = {
    login: () => Promise.resolve(),
    logout,
    checkAuth: () => Promise.resolve(),
    checkError: () => Promise.resolve(),
    getIdentity: () => Promise.resolve(identity),
  } as unknown as AuthProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        authProvider={authProvider}
        i18nProvider={testI18nProvider}
      >
        <ConfirmNewAccount onConfirmed={onConfirmed} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, affirmAge, onConfirmed, logout };
}

const AGE_LABEL = "I confirm that I am 18 years of age or older.";

describe("ConfirmNewAccount", () => {
  it("tells a brand-new login that signing in has just created an account", async () => {
    // The half `/login` could never say: `signInWithOAuth()` has no
    // `shouldCreateUser`, so "Continue with Google" creates the account before
    // anything gets a chance to warn.
    const { screen } = await harness();

    await expect
      .element(screen.getByText(/signing in has just created one for you/))
      .toBeVisible();
  });

  it("will not let anyone through until they have actually affirmed", async () => {
    // The point of a control rather than a notice: it cannot be walked past.
    const { screen, affirmAge, onConfirmed } = await harness();
    const continueButton = screen.getByRole("button", { name: "Continue" });

    await expect.element(continueButton).toBeDisabled();
    expect(affirmAge).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("records the affirmation and hands control back once it is ticked", async () => {
    const { screen, affirmAge, onConfirmed } = await harness();

    await screen.getByLabelText(AGE_LABEL).click();
    await screen.getByRole("button", { name: "Continue" }).click();

    await vi.waitFor(() => expect(affirmAge).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
  });

  it("keeps the caller on the screen when recording fails, rather than admitting them", async () => {
    // Fail-loud on the write: they are about to be let into the app on the
    // strength of it, so a swallowed failure would admit them having recorded
    // nothing at all.
    const { screen, onConfirmed } = await harness({
      affirmAge: () => Promise.reject(new Error("network down")),
    });

    await screen.getByLabelText(AGE_LABEL).click();
    await screen.getByRole("button", { name: "Continue" }).click();

    await expect.element(screen.getByLabelText(AGE_LABEL)).toBeVisible();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("offers a way out that signs the caller out instead of proceeding", async () => {
    const { screen, logout, affirmAge } = await harness();

    await screen.getByRole("button", { name: "Not now — sign me out" }).click();

    await vi.waitFor(() => expect(logout).toHaveBeenCalled());
    expect(affirmAge).not.toHaveBeenCalled();
  });
});
