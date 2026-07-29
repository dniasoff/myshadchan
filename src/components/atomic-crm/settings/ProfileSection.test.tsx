import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { AuthProvider, DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

// Every assertion here is about real computed geometry — row heights, clipped
// text — which is meaningless without the real Tailwind stylesheet actually
// applying to the rendered classes. Same precedent as
// `entity360/Entity360.responsive.test.tsx`.
import "@/index.css";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { ProfileSection } from "./ProfileSection";

/**
 * Loose-end G, and the constraint it has to respect.
 *
 * G: on mobile Settings the user's own email rendered as `routes-178528194…`
 * — cut at a hard `max-w-40` (160px) with most of the row empty beside it.
 *
 * The constraint: the truncation itself is load-bearing. It was added in
 * `10dacf4` because a value wide enough to not fit beside its label wraps
 * `ItemActions` onto a second line (`Item` is `flex-wrap`), making the
 * settled row taller than the skeleton it replaces — a late height change
 * that raced `e2e/invite-sending.spec.ts` on ~40% of full-suite runs. So
 * these tests pin both halves: more of the email is visible, AND no email,
 * however long, can change the row's height.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;

/** The address from the audit screenshot, at its real length. */
const REPORTED_EMAIL = "routes-1785281940@example.com";

const buildMember = (email: string) => ({
  id: 5,
  first_name: "Rivka",
  last_name: "Klein",
  email,
  avatar: null,
  administrator: false,
});

const buildAuthProvider = (identity: unknown): AuthProvider =>
  ({
    checkAuth: () => Promise.resolve(),
    checkError: () => Promise.resolve(),
    getPermissions: () => Promise.resolve(),
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getIdentity: () =>
      identity === undefined
        ? new Promise<never>(() => {})
        : Promise.resolve(identity),
  }) as unknown as AuthProvider;

const buildDataProvider = (member: unknown): DataProvider =>
  ({
    getOne: vi.fn().mockResolvedValue({ data: member }),
  }) as unknown as DataProvider;

const renderProfile = async ({ email }: { email?: string }) => {
  const member = email === undefined ? undefined : buildMember(email);

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        authProvider={buildAuthProvider(
          member === undefined ? undefined : { id: 5, fullName: "Rivka Klein" },
        )}
        dataProvider={buildDataProvider(member)}
        queryClient={new QueryClient()}
        i18nProvider={testI18nProvider}
      >
        <ProfileSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

/** The `<div data-slot="item">` rows inside the profile card, in order. */
const rowsOf = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll('[data-slot="item"]'));

describe("ProfileSection — the email row at 390px", () => {
  afterEach(async () => {
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("shows the whole email instead of clipping it at a 160px cap", async () => {
    // Arrange
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);

    // Act
    const screen = await renderProfile({ email: REPORTED_EMAIL });
    await expect.element(screen.getByText(REPORTED_EMAIL)).toBeInTheDocument();
    const value = screen.container.querySelector(
      `[title="${REPORTED_EMAIL}"]`,
    ) as HTMLElement;

    // Assert — nothing is scrolled out of view, and the slot is wider than
    // the `max-w-40` (160px) it replaced.
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
    expect(value.clientWidth).toBeGreaterThan(160);
  });

  it("exposes the full value as a title for pointer users", async () => {
    // Arrange
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);

    // Act
    const screen = await renderProfile({ email: REPORTED_EMAIL });

    // Assert
    await expect
      .element(screen.getByText(REPORTED_EMAIL))
      .toHaveAttribute("title", REPORTED_EMAIL);
  });

  it("keeps the row single-line for an email far too long to fit", async () => {
    // Arrange — the case the truncation exists for.
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);
    const shortEmail = "a@b.co";
    const longEmail = `${"very-long-local-part".repeat(4)}@example-domain.test`;

    // Act
    const shortScreen = await renderProfile({ email: shortEmail });
    await expect.element(shortScreen.getByText(shortEmail)).toBeInTheDocument();
    const shortHeight = rowsOf(shortScreen.container).at(-1)!.offsetHeight;

    const longScreen = await renderProfile({ email: longEmail });
    await expect.element(longScreen.getByText(longEmail)).toBeInTheDocument();
    const longHeight = rowsOf(longScreen.container).at(-1)!.offsetHeight;

    // Assert — a wrapped `ItemActions` would make this ~30px taller.
    expect(longHeight).toBe(shortHeight);
  });

  it("settles into rows exactly as tall as the skeleton rows they replace", async () => {
    // Arrange — this is the CLS invariant `10dacf4` established; widening
    // the value slot must not break it.
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);

    // Act
    const pendingScreen = await renderProfile({ email: undefined });
    const skeletonHeights = rowsOf(pendingScreen.container).map(
      (row) => row.offsetHeight,
    );

    const settledScreen = await renderProfile({ email: REPORTED_EMAIL });
    await expect
      .element(settledScreen.getByText(REPORTED_EMAIL))
      .toBeInTheDocument();
    const settledHeights = rowsOf(settledScreen.container).map(
      (row) => row.offsetHeight,
    );

    // Assert
    expect(skeletonHeights).toHaveLength(4);
    expect(settledHeights).toEqual(skeletonHeights);
  });
});
