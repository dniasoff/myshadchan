import type { ReactElement } from "react";
import type { RaRecord } from "ra-core";

import { EntityAvatar } from "./EntityAvatar";

export interface DefaultIdentityHeaderProps<T extends RaRecord = RaRecord> {
  record: T;
  avatar?: (record: T) => { seed: string | null };
  title?: (record: T) => string;
  meta?: (record: T) => (string | null | undefined)[];
}

/**
 * The avatar/title/meta composition `EntityShow` falls back to when a
 * descriptor declares no `identityHeader` component (Epic 3 API contract
 * §2 — "Default composition. Used ONLY when `identityHeader` is absent").
 * Every field is independently optional and absent-safe: a descriptor
 * supplying none of them still renders (an unlabelled avatar chip), which
 * is the concrete degrade case AC 9 proves — a minimal descriptor must not
 * throw.
 */
export function DefaultIdentityHeader<T extends RaRecord = RaRecord>({
  record,
  avatar,
  title,
  meta,
}: DefaultIdentityHeaderProps<T>): ReactElement {
  const seed = avatar?.(record).seed ?? null;
  const resolvedTitle = title?.(record);
  const metaLine = meta?.(record)
    .filter((entry): entry is string => Boolean(entry))
    .join(" · ");

  return (
    <div className="flex items-center gap-4">
      <EntityAvatar seed={seed} monogramSource={resolvedTitle} />
      <div className="flex min-w-0 flex-col">
        {resolvedTitle ? (
          <h1 className="truncate text-xl font-semibold">{resolvedTitle}</h1>
        ) : null}
        {metaLine ? (
          <p className="truncate text-sm text-muted-foreground">{metaLine}</p>
        ) : null}
      </div>
    </div>
  );
}
