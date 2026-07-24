import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import type { ChildPortalData } from "../types";
import { ChildPortalPage } from "./ChildPortalPage";
import type { PortalUrl } from "./portalToken";

/**
 * These tests pin the portal's fail-soft contract: a valid token renders the
 * calm read-only view; a missing, unknown, revoked, or errored token all resolve
 * to the same neutral "no longer active" notice — never a crash and never a
 * detail leak.
 */

const portalUrl = (token = "a-valid-looking-token"): PortalUrl => ({
  pathname: "/portal",
  search: "",
  hash: `#${token}`,
});

const activeData: ChildPortalData = {
  child: { first_name_en: "Rivky", first_name_he: "רבקה" },
  suggestions: [
    {
      name_en: "Dovid Berkowitz",
      name_he: null,
      redt_date: "2026-07-20",
      status_label: "Looking promising",
    },
  ],
};

describe("ChildPortalPage", () => {
  it("renders the child's space and a suggestion for a valid token", async () => {
    const screen = await render(
      <ChildPortalPage
        url={portalUrl()}
        loadPortal={() => Promise.resolve(activeData)}
      />,
    );

    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Rivky's space");
    await expect.element(screen.getByText("Dovid Berkowitz")).toBeVisible();
    await expect
      .element(screen.getByText("Looking promising"))
      .toBeInTheDocument();
  });

  it("shows a calm empty state when there are no suggestions", async () => {
    const screen = await render(
      <ChildPortalPage
        url={portalUrl()}
        loadPortal={() =>
          Promise.resolve({
            child: { first_name_en: "Rivky" },
            suggestions: [],
          })
        }
      />,
    );

    await expect
      .element(screen.getByText(/Nothing to show just yet/i))
      .toBeVisible();
  });

  it("shows the inactive notice when the token resolves to null (revoked/unknown)", async () => {
    const screen = await render(
      <ChildPortalPage
        url={portalUrl()}
        loadPortal={() => Promise.resolve(null)}
      />,
    );

    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("This link is no longer active");
  });

  it("shows the inactive notice when no token is present, without calling the loader", async () => {
    const loadPortal = vi.fn(() => Promise.resolve(activeData));
    const screen = await render(
      <ChildPortalPage
        url={{ pathname: "/portal", search: "", hash: "" }}
        loadPortal={loadPortal}
      />,
    );

    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("This link is no longer active");
    expect(loadPortal).not.toHaveBeenCalled();
  });

  it("fails soft to the inactive notice on a loader error", async () => {
    const screen = await render(
      <ChildPortalPage
        url={portalUrl()}
        loadPortal={() => Promise.reject(new Error("network"))}
      />,
    );

    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("This link is no longer active");
  });
});
