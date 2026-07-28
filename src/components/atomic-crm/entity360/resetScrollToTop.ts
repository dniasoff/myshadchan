/**
 * AC 11 / contract §5 rule 9 — `<Resource>` wraps the ENTIRE `list` element
 * (i.e. everything `buildEntityRoutes` returns: index, `new`, `:id/edit`,
 * `:id`, `:id/:tab`) in a single `<RestoreScrollPosition storeKey={
 * `${name}.list.scrollPosition`}>` (`ra-core/dist/core/Resource.js:14`),
 * whose own mount-only effect restores whatever offset was last saved while
 * scrolling the list. That effect lives on an ANCESTOR of every route this
 * module resets.
 *
 * A `useLayoutEffect` here does NOT win that race, even though all layout
 * effects finish before any passive effect runs: `RestoreScrollPosition`'s
 * restore is itself a passive `useEffect` on the ancestor, so by the time it
 * fires — later in the SAME synchronous passive-effect flush, since flushing
 * proceeds children-before-parents in one pass — it already closed over
 * `position` at ITS OWN render, before our layout effect (or our own plain
 * effect) could have mutated the shared store. Mutating the store earlier
 * does not retroactively change a closure that already captured the old
 * value. Proved empirically (not reasoned) against a real
 * `<RestoreScrollPosition>` + seeded store: both a plain `useEffect` and a
 * `useLayoutEffect` reset produce the call sequence `[[0, 0], [0, 500]]` —
 * the restore still overwrites us either way.
 *
 * `queueMicrotask` is what actually wins: it defers our call until AFTER the
 * current synchronous passive-effect flush unwinds entirely — i.e. strictly
 * after `RestoreScrollPosition`'s restore has already run (and possibly
 * overshot) — so ours is the last word and the only one the user ever sees
 * (both happen before the browser's next paint, so there is no visible
 * flash of the restored offset). Verified against the same real tree: the
 * sequence becomes `[[0, 500], [0, 0]]`.
 */
export function resetScrollToTop(): void {
  queueMicrotask(() => window.scrollTo(0, 0));
}
