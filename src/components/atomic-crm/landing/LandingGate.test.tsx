import { render } from "vitest-browser-react";
import { LandingGate } from "./LandingGate";
import { isPublicEntryUrl, type LandingUrl } from "./landingEntryUrl";

/**
 * These tests pin the front-door split: `/` without a session is the only URL
 * that ever shows the public page, and an auth callback landing on `/` must
 * reach the app rather than be swallowed by the landing page.
 */

const url = (overrides: Partial<LandingUrl> = {}): LandingUrl => ({
  pathname: "/",
  search: "",
  hash: "",
  ...overrides,
});

const renderGate = (props: {
  hasSession?: boolean;
  url?: LandingUrl;
  checkSession?: () => Promise<boolean>;
}) =>
  render(
    <LandingGate
      url={props.url ?? url()}
      checkSession={
        props.checkSession ?? (() => Promise.resolve(props.hasSession ?? false))
      }
    >
      <div>The signed-in app</div>
    </LandingGate>,
  );

describe("isPublicEntryUrl", () => {
  it("accepts the bare root path", () => {
    expect(isPublicEntryUrl(url())).toBe(true);
  });

  it("rejects any path other than the root", () => {
    expect(isPublicEntryUrl(url({ pathname: "/login" }))).toBe(false);
    expect(isPublicEntryUrl(url({ pathname: "/shidduchim" }))).toBe(false);
  });

  it("rejects an OAuth callback that lands on the root path", () => {
    expect(isPublicEntryUrl(url({ search: "?code=abc123" }))).toBe(false);
    expect(
      isPublicEntryUrl(url({ hash: "#access_token=abc123&type=recovery" })),
    ).toBe(false);
  });

  it("rejects a deep link into the app, which routes on the hash", () => {
    expect(isPublicEntryUrl(url({ hash: "#/shidduchim" }))).toBe(false);
    expect(isPublicEntryUrl(url({ hash: "#/login" }))).toBe(false);
  });

  it("accepts the app root in the hash", () => {
    expect(isPublicEntryUrl(url({ hash: "#/" }))).toBe(true);
  });

  it("rejects an auth error handed back on the root path", () => {
    expect(isPublicEntryUrl(url({ search: "?error=access_denied" }))).toBe(
      false,
    );
  });
});

describe("LandingGate", () => {
  it("shows the landing page to a visitor with no session", async () => {
    // Arrange / Act
    const screen = await renderGate({ hasSession: false });

    // Assert
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    await expect
      .element(screen.getByText("The signed-in app"))
      .not.toBeInTheDocument();
  });

  it("shows the app to a visitor who already has a session", async () => {
    // Arrange / Act
    const screen = await renderGate({ hasSession: true });

    // Assert
    await expect.element(screen.getByText("The signed-in app")).toBeVisible();
  });

  it("shows the app without checking the session on any other path", async () => {
    // Arrange
    const checkSession = vi.fn(() => Promise.resolve(false));

    // Act
    const screen = await renderGate({
      url: url({ pathname: "/shidduchim" }),
      checkSession,
    });

    // Assert
    await expect.element(screen.getByText("The signed-in app")).toBeVisible();
    expect(checkSession).not.toHaveBeenCalled();
  });

  it("falls back to the public page when the session check fails", async () => {
    // Arrange / Act
    const screen = await renderGate({
      checkSession: () => Promise.reject(new Error("auth service unreachable")),
    });

    // Assert
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
  });
});
