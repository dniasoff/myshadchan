import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";

import { AuthError } from "./authentication";

describe("AuthError", () => {
  it("offers account creation for an unknown Google sign-in", async () => {
    const screen = await render(
      <AuthError message="crm.auth.oauth_callback.no_account" />,
      {
        wrapper: ({ children }) => (
          <CoreAdminContext i18nProvider={testI18nProvider}>
            {children}
          </CoreAdminContext>
        ),
      },
    );

    await expect
      .element(screen.getByRole("link", { name: "Create a new account" }))
      .toHaveAttribute("href", expect.stringContaining("/register"));
    await expect
      .element(screen.getByRole("link", { name: "Sign in" }))
      .toHaveAttribute("href", expect.stringContaining("/login"));
  });
});
