import type { Identifier } from "ra-core";

import type { InboxItem } from "../types";

/** The approved time in which an Inbox deletion can be undone. */
export const INBOX_DELETE_UNDO_MS = 10_000;

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
