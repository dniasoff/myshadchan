/**
 * Touch-sized dropdown rows for the menus the mobile shell owns (the bottom
 * nav's "More" menu, the create menu, the context switcher's rows).
 *
 * A `<DropdownMenuItem>` is `px-2 py-1.5 text-sm` — a 32px row, well under
 * the 44px touch minimum, and the rows sit flush against each other so a
 * mis-tap lands on the neighbouring destination rather than on nothing. This
 * raises the row to 44px on touch and restores the desktop density above
 * `md`, the same shape `ui/button.tsx`'s default size and `ui/input.tsx`
 * already use (`min-h-11 md:min-h-9`). It must come from a module of its own
 * rather than from `MobileNavigation.tsx`: `ContextSwitcher.tsx` uses it too
 * and `MobileNavigation` already imports `ContextSwitcher`, so the reverse
 * import would be a cycle.
 */
export const MOBILE_MENU_ITEM_CLASSNAME =
  "min-h-11 py-2.5 md:min-h-0 md:py-1.5";
