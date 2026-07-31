import { describe, expect, it, vi } from "vitest";

import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";
import { persistOrder } from "./persistOrder";

/**
 * The board's reorder write is the ONE call in the app that still addresses
 * the `shidduchim` base table. `public.shidduchim` no longer grants
 * `authenticated` a table-level SELECT — `close_reason` is withheld at the
 * column level to enforce Story 6.3's AC-4 — so PostgREST's default
 * `return=representation` (`select=*`) answers
 * `403 {"code":"42501","message":"permission denied for table shidduchim"}`.
 *
 * `meta.columns` is what keeps that representation inside the grant. Dropping
 * it fails no type check and no other test, and breaks every drag on the
 * board, so it is asserted here directly.
 */

const card = (id: number, index: number): ShidduchSummary =>
  ({ id, index }) as unknown as ShidduchSummary;

const buildDataProvider = () => {
  const update = vi.fn(async () => ({ data: { id: 1 } }));
  return { provider: { update } as unknown as CrmDataProvider, update };
};

describe("persistOrder", () => {
  it("names the returned columns so the PATCH representation stays inside the column grant", async () => {
    // Arrange
    const { provider, update } = buildDataProvider();

    // Act — the card's stored index (9) differs from its position (0).
    await persistOrder(provider, [card(7, 9)]);

    // Assert
    expect(update).toHaveBeenCalledWith("shidduchim", {
      id: 7,
      data: { index: 0 },
      previousData: expect.anything(),
      meta: { columns: ["id", "index"] },
    });
  });

  it("writes nothing for a card already at its stored index", async () => {
    // Arrange
    const { provider, update } = buildDataProvider();

    // Act
    await persistOrder(provider, [card(7, 0), card(8, 1)]);

    // Assert
    expect(update).not.toHaveBeenCalled();
  });
});
