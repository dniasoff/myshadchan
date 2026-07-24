import { describe, expect, it } from "vitest";

import { createDataProvider } from "./dataProvider";
import type { Child } from "../../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

/**
 * FakeRest mirror of the E7 child portal. These pin the same guarantees the
 * database suite (supabase/tests/child_portal.sql) proves on the real backend, so
 * demo mode never teaches the wrong thing: only shared + child-visible-state
 * suggestions leave getChildPortal, scoped to the token's own child; the token is
 * server-generated; and a revoked token yields nothing.
 */
const makeChild = async (
  dataProvider: ReturnType<typeof makeProvider>,
  firstName: string,
) => {
  const { data } = await dataProvider.create<Child>("children", {
    data: {
      account_id: 1,
      first_name_en: firstName,
      status: "active",
    } as Child,
  });
  return data;
};

describe("child portal emulation (E7)", () => {
  it("returns only shared + child-visible suggestions for the token's child", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const child = await makeChild(dataProvider, "Rivky");
    await dataProvider.createShidduch({
      child_id: child.id,
      initial_state: "look_into",
      visibility: "shared",
      name_en: "Shared Look",
    });
    await dataProvider.createShidduch({
      child_id: child.id,
      initial_state: "new",
      visibility: "shared",
      name_en: "Shared New",
    });
    await dataProvider.createShidduch({
      child_id: child.id,
      initial_state: "look_into",
      visibility: "private_parent",
      name_en: "Private Look",
    });
    const token = await dataProvider.mintChildPortalToken(child.id);

    // Act
    const portal = await dataProvider.getChildPortal(token.token);

    // Assert
    expect(portal).not.toBeNull();
    expect(portal?.child.first_name_en).toBe("Rivky");
    const names = portal?.suggestions.map((s) => s.name_en);
    expect(names).toEqual(["Shared Look"]);
    expect(portal?.suggestions[0].status_label).toBe("Being looked into");
  });

  it("never leaks another child in the same account", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const rivky = await makeChild(dataProvider, "Rivky");
    const leah = await makeChild(dataProvider, "Leah");
    await dataProvider.createShidduch({
      child_id: leah.id,
      initial_state: "look_into",
      visibility: "shared",
      name_en: "Leah Match",
    });
    const token = await dataProvider.mintChildPortalToken(rivky.id);

    // Act
    const portal = await dataProvider.getChildPortal(token.token);

    // Assert
    expect(portal?.suggestions).toHaveLength(0);
  });

  it("mints a 48-hex server-generated token and finds it as the active token", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const child = await makeChild(dataProvider, "Rivky");

    // Act
    const token = await dataProvider.mintChildPortalToken(child.id);
    const active = await dataProvider.getActiveChildPortalToken(child.id);

    // Assert
    expect(token.token).toMatch(/^[0-9a-f]{48}$/);
    expect(active?.id).toBe(token.id);
  });

  it("a revoked token yields nothing and is no longer the active token", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const child = await makeChild(dataProvider, "Rivky");
    const token = await dataProvider.mintChildPortalToken(child.id);

    // Act
    await dataProvider.revokeChildPortalToken(token.id);

    // Assert
    expect(await dataProvider.getChildPortal(token.token)).toBeNull();
    expect(await dataProvider.getActiveChildPortalToken(child.id)).toBeNull();
  });

  it("returns null for an unknown token", async () => {
    const dataProvider = makeProvider();
    expect(
      await dataProvider.getChildPortal("does-not-exist-000000000000"),
    ).toBeNull();
  });
});
