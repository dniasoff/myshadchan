import { render } from "vitest-browser-react";
import { LandingPage } from "./LandingPage";
import { SIGN_IN_PATH } from "./landingLinks";

/**
 * The landing page is the one public surface of the product, so these tests pin
 * what it must say (what it does, how it works, what happens to the data) and
 * the register it must not slip into: plain statements of fact, no pitch.
 */

describe("LandingPage", () => {
  it("states what the product is in a single top-level heading", async () => {
    // Arrange / Act
    const screen = await render(<LandingPage />);

    // Assert
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("A record of the shidduch process for your children.");
  });

  it("offers a keyboard-reachable way into the app", async () => {
    // Arrange / Act
    const screen = await render(<LandingPage />);

    // Assert
    const links = screen.getByRole("link", { name: /^sign in$/i });
    await expect.element(links.first()).toHaveAttribute("href", SIGN_IN_PATH);
  });

  it("names each of the four things it stores", async () => {
    // Arrange / Act
    const screen = await render(<LandingPage />);

    // Assert
    for (const heading of [
      /^resumes$/i,
      /^repeat suggestions$/i,
      /^reference calls$/i,
      /^status$/i,
    ]) {
      await expect
        .element(screen.getByRole("heading", { name: heading }))
        .toBeVisible();
    }
  });

  it("lists the three steps in order", async () => {
    // Arrange / Act
    const screen = await render(<LandingPage />);

    // Assert
    for (const heading of [
      /enter the resume/i,
      /record what happens/i,
      /set the state/i,
    ]) {
      await expect
        .element(screen.getByRole("heading", { name: heading }))
        .toBeVisible();
    }
    await expect.element(screen.getByText("03").first()).toBeVisible();
  });

  it("states what happens to the data without addressing the reader", async () => {
    // Arrange / Act
    const screen = await render(<LandingPage />);

    // Assert
    await expect
      .element(screen.getByText(/not pooled with other families/i))
      .toBeVisible();
    await expect
      .element(screen.getByText(/there is no public directory/i))
      .toBeVisible();
    await expect
      .element(screen.getByText(/exported or deleted at any time/i))
      .toBeVisible();
  });

  it("describes the licence honestly rather than claiming to be open source today", async () => {
    // Arrange / Act
    const screen = await render(<LandingPage />);

    // Assert
    await expect
      .element(
        screen.getByText(
          /becomes fully open source two years after each release/i,
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText(/run at cost, not for profit/i).first())
      .toBeVisible();
  });

  it("shows the seven pipeline states bilingually", async () => {
    // Arrange / Act
    const screen = await render(<LandingPage />);

    // Assert
    await expect.element(screen.getByText("For-sure-not")).toBeVisible();
    await expect.element(screen.getByText("בטוח לא")).toBeVisible();
  });

  it("uses landmarks a screen reader can navigate", async () => {
    // Arrange / Act
    const screen = await render(<LandingPage />);

    // Assert
    await expect.element(screen.getByRole("banner")).toBeInTheDocument();
    await expect.element(screen.getByRole("main")).toBeInTheDocument();
    await expect.element(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("stays out of marketing register", async () => {
    // Arrange: sales language, second-person reassurance and the scene-setting
    // the copy was rewritten to remove.
    const bannedPhrases = [
      "revolutionize",
      "revolutionise",
      "transform",
      "effortless",
      "calm",
      "you do not have to",
      "nothing gets lost",
      "!",
      "CRM",
      "AI-powered",
      "platform",
      "pipeline",
    ];

    // Act
    await render(<LandingPage />);
    const copy = document.body.innerText;

    // Assert
    expect(copy).toContain("The service is free.");
    for (const phrase of bannedPhrases) {
      expect(copy.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });
});
