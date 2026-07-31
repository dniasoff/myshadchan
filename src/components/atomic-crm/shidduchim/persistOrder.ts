import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";

/**
 * The board's own persisted card order — and the ONE write in the app that
 * still addresses the `shidduchim` base table rather than its summary view.
 *
 * `meta.columns` is not cosmetic here. PostgREST answers a PATCH with
 * `Prefer: return=representation`, and with no `select` that representation is
 * `select=*` — which needs SELECT on EVERY column. `authenticated` no longer
 * has that on this table: `close_reason` is withheld at the column level to
 * enforce Story 6.3's AC-4 (06_grants.sql), and Postgres offers no "all
 * columns except one" grant, so SELECT is granted column by column instead.
 * Without this list, dragging a card would answer
 * `403 {"code":"42501","message":"permission denied for table shidduchim"}`
 * and the board would roll the optimistic reorder back on every drop.
 *
 * `id` and `index` are all that is named because that is all this call writes
 * and all it needs echoed back — a narrow representation is the right default
 * for a write path regardless of the grant.
 */
const REORDER_COLUMNS = ["id", "index"] as const;

export const persistOrder = async (
  dataProvider: CrmDataProvider,
  cards: ShidduchSummary[],
): Promise<void> => {
  const updates = cards.flatMap((card, index) =>
    card.index === index
      ? []
      : [
          dataProvider.update("shidduchim", {
            id: card.id,
            data: { index },
            previousData: card,
            meta: { columns: [...REORDER_COLUMNS] },
          }),
        ],
  );
  await Promise.all(updates);
};
