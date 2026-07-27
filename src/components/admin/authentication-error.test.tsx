import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";

import { AuthenticationError } from "./authentication-error";

describe("AuthenticationError", () => {
  it("renders a visible heading", async () => {
    // Arrange / Act
    const screen = await render(<AuthenticationError />, {
      wrapper: ({ children }) => (
        <CoreAdminContext i18nProvider={testI18nProvider}>
          {children}
        </CoreAdminContext>
      ),
    });

    // Assert
    await expect
      .element(screen.getByRole("heading", { name: "Authentication error" }))
      .toBeInTheDocument();
  });
});
