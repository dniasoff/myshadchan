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

const INBOX_ATTACHMENT_UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");

/**
 * G1 — browser uploads: `{account}/inbox/{item}/{uuid-v4}{extension}`.
 * G2 — email ingest: `{account}/{uuid-v4}{extension}`. The worker preserves
 * extension case and accepts one to ten ASCII letters/digits, or no extension.
 * Retired/unknown path shapes fail closed rather than guessing ownership.
 */
const inboxAttachmentPathRegex = (accountId: Identifier) => {
  const account = escapeRegExp(String(accountId));
  const extension = "(?:\\.[A-Za-z0-9]{1,10})?";
  return [
    new RegExp(
      `^${account}/inbox/[0-9]+/${INBOX_ATTACHMENT_UUID_V4}${extension}$`,
    ),
    new RegExp(`^${account}/${INBOX_ATTACHMENT_UUID_V4}${extension}$`),
  ];
};

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
  return inboxAttachmentPathRegex(accountId).some((regex) => regex.test(path));
}

export function isInboxAttachmentOwnedByItem(
  path: unknown,
  accountId: Identifier,
  itemId: Identifier,
): path is string {
  if (!isInboxAttachmentPurgePath(path, accountId)) return false;
  return (
    path.startsWith(`${accountId}/inbox/${itemId}/`) ||
    !path.startsWith(`${accountId}/inbox/`)
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
    if (
      isInboxAttachmentOwnedByItem(path, accountId, item.id) &&
      !sharedPaths.has(path)
    ) {
      paths.add(path);
    }
  }

  return [...paths];
}
