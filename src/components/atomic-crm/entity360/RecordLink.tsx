import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { Identifier } from "ra-core";
import { Link } from "react-router";

import { getEntityDescriptor } from "./registry";

/**
 * AD-24's single record-navigation primitive (contract §7). Exactly these
 * five props — no `onClick`, no `ref` forwarding, no `{...rest}` spread. A
 * caller that needs drag props, a ref or a click guard puts them on its own
 * wrapper element (see `shidduchim/ShidduchCard.tsx`'s `onClickCapture`
 * guard around the dnd `<div>`); `RecordLink` itself stays a closed anchor.
 */
export interface RecordLinkProps {
  resource: string;
  id: Identifier;
  children: ReactNode;
  className?: string;
  /**
   * The one sanctioned escape hatch beyond `className`. The swept site
   * (`singles/SingleCard.tsx`; `references/ReferenceList.tsx` was the other
   * until RULING 7 deleted it) sets
   * `style={{ animationDelay }}` on the anchor alongside the `.ql-enter`
   * class; `.ql-enter` is `animation: ql-rise … both` (`src/index.css`), and
   * `animation-fill-mode: both` keeps the final keyframe's `transform`
   * applied, so moving the pair onto an inner `<Card>` would override its
   * `hover:-translate-y-0.5` / `active:scale-[0.98]`. Forwarded verbatim on
   * both the `<a>` and the degraded `<span>` below.
   */
  style?: CSSProperties;
}

/**
 * Resolves `resource`/`id` through the entity descriptor registry
 * (`getEntityDescriptor` — never `requireEntityDescriptor`, contract §4
 * rule 3) and renders an anchor at `descriptor.buildRecordPath(id)`.
 *
 * An unregistered resource degrades to an inert `<span>` plus one
 * `console.error` — it MUST NOT throw. Story 3.5 renders `RecordLink` from
 * `interactions.metadata`, client-writable `jsonb`
 * (`supabase/schemas/06_grants.sql`), so a stale or malicious
 * `linkedResource` value must not blank the rest of the Activity tab.
 */
export function RecordLink({
  resource,
  id,
  children,
  className,
  style,
}: RecordLinkProps): ReactElement {
  const descriptor = getEntityDescriptor(resource);

  if (!descriptor) {
    console.error(
      `RecordLink: no entity descriptor registered for resource "${resource}"; rendering plain text instead of a link.`,
    );
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }

  return (
    <Link
      to={descriptor.buildRecordPath(id)}
      className={className}
      style={style}
    >
      {children}
    </Link>
  );
}
