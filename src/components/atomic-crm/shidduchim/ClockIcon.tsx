/**
 * One small clock glyph, in its own module — and it has to stay that way.
 *
 * It lives on both the board's `ShidduchCard` and the 360 detail header's meta
 * row. It used to be EXPORTED FROM `ShidduchCard.tsx`, and that single import
 * was what put `@hello-pangea/dnd` on the login critical path: the 360 header
 * is registered eagerly (`entityDescriptorRegions` -> `entityDescriptor` ->
 * the `import "./entityDescriptor"` side effect in `shidduchim/index.ts` ->
 * `root/routeManifest.ts`), so importing one 28-line SVG from the card module
 * pulled in the card, and with it the whole drag-and-drop library — 186 KB of
 * a Kanban board, downloaded by every visitor before they can type an email
 * address.
 *
 * Twenty-eight lines of SVG in their own file is the entire fix. Do not move
 * this back into a module that imports a heavy library, and do not re-export
 * it from one.
 */
export const ClockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3 w-3 shrink-0"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
