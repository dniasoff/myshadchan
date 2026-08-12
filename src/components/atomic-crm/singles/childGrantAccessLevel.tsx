import type { ComponentType } from "react";
import { Eye, MessageSquare, Pencil } from "lucide-react";

import type { ChildGrantAccessLevel } from "../types";

/**
 * Single source of truth for how a child grant's access tier is described
 * to a human, everywhere it appears: `ProposeGrantDialog`'s radio options
 * (what the proposer offers), `GrantListItem`'s badge/edit select (what the
 * grant currently is), and `GrantAccept`'s consent screen (what the
 * acceptor is about to agree to). Kept in one file so those three moments
 * can never quietly drift out of sync with each other.
 */
export const ACCESS_LEVEL_ORDER: ChildGrantAccessLevel[] = [
  "read",
  "comment",
  "edit",
];

export const ACCESS_LEVEL_LABELS: Record<ChildGrantAccessLevel, string> = {
  read: "Can view",
  comment: "Can view and comment",
  edit: "Can view and edit",
};

export const ACCESS_LEVEL_DESCRIPTIONS: Record<ChildGrantAccessLevel, string> =
  {
    read: "They can see this single's shared record, but not add anything.",
    comment:
      "They can also add their own commentary. They still can't see your household's private notes.",
    edit: "They can also make changes to specific parts of the record.",
  };

export const ACCESS_LEVEL_ICONS: Record<
  ChildGrantAccessLevel,
  ComponentType<{ className?: string }>
> = {
  read: Eye,
  comment: MessageSquare,
  edit: Pencil,
};
