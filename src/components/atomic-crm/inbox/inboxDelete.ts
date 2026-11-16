import type { Identifier } from "ra-core";

import type { InboxItem } from "../types";

export type InboxDeleteResult = {
  /** True when at least one private object remains in the durable queue. */
  purgePending: boolean;
};

export type InboxAttachmentPurge = {
  id: Identifier;
  account_id?: Identifier;
  storage_path: string;
};

/** The approved time in which an Inbox deletion can be undone. */
export const INBOX_DELETE_UNDO_MS = 10_000;

/** The only object-key shape the Inbox purge client is allowed to pass to
 * Storage. The server is authoritative; this is a second bucket/path guard
 * so a malformed queue row can never turn into a broad cleanup request. */
export function isInboxAttachmentPurgePath(
  path: unknown,
  accountId: Identifier,
): path is string {
  if (typeof path !== "string") return false;
  if (/%(?:2e|2f|5c|25)/i.test(path)) return false;
  const hasControlCharacter = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (hasControlCharacter || path.includes("\\")) {
    return false;
  }
  const prefix = `${accountId}/inbox/`;
  if (!path.startsWith(prefix)) return false;
  const segments = path.slice(prefix.length).split("/");
  return (
    segments.length >= 2 &&
    /^\d+$/.test(segments[0]) &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    )
  );
}

export function hasValidInboxAttachmentPaths(
  item: Pick<InboxItem, "attachments">,
  accountId: Identifier,
): boolean {
  if (item.attachments == null) return true;
  return (
    Array.isArray(item.attachments) &&
    item.attachments.every((attachment) =>
      isInboxAttachmentPurgePath(attachment?.path, accountId),
    )
  );
}

const DELETABLE_INBOX_STATUSES = new Set<InboxItem["status"]>([
  "unresolved",
  "held",
  "dismissed",
]);

export function canDeleteInboxItem(
  item: Pick<InboxItem, "status" | "resolution_attempt_id">,
): boolean {
  return (
    DELETABLE_INBOX_STATUSES.has(item.status) &&
    item.resolution_attempt_id == null
  );
}

/**
 * Return only private objects owned by this Inbox row. The account id is
 * resolved by the provider from the active server-side context; callers do
 * not supply storage paths.
 *
 * A path can be present in more than one Inbox row in old data or during a
 * concurrent capture. Such an object remains shared and is deliberately not
 * returned for removal.
 */
export function getRemovableInboxAttachmentPaths(
  item: Pick<InboxItem, "id" | "attachments">,
  accountId: Identifier,
  otherItems: Array<Pick<InboxItem, "id" | "attachments">>,
): string[] {
  const prefix = `${accountId}/inbox/${item.id}/`;
  const sharedPaths = new Set(
    otherItems.flatMap(
      (otherItem) =>
        otherItem.attachments?.flatMap((attachment) =>
          typeof attachment.path === "string" ? [attachment.path] : [],
        ) ?? [],
    ),
  );
  const paths = new Set<string>();

  for (const attachment of item.attachments ?? []) {
    const path = attachment.path;
    const relativePath =
      typeof path === "string" && path.startsWith(prefix)
        ? path.slice(prefix.length)
        : "";
    const safeRelativePath =
      relativePath.length > 0 &&
      relativePath
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        );
    if (
      typeof path === "string" &&
      safeRelativePath &&
      !sharedPaths.has(path)
    ) {
      paths.add(path);
    }
  }

  return [...paths];
}
