import { useGetOne, useNotify, useTranslate, useUpdate } from "ra-core";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";

import { useViewerRole } from "../entity360/useViewerRole";
import { hasVisibility } from "../entity360/visibility";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";
import type { Account, MemberRole, ThreadVisibility } from "../types";
import { SectionLabel } from "./SectionLabel";

/** Every `MemberRole` except `single` — the shipped "Accounts writable by
 * non-single members" RLS policy (05_policies.sql) already denies every
 * `accounts` write to that role (Story 7.2 Dev Notes, "Who may change the
 * default posture"), so this list is the exact complement, not a new
 * authority decision. */
const CAN_SET_DEFAULT_VISIBILITY: MemberRole[] = [
  "parent_admin",
  "helper",
  "self_manager",
  "shadchan",
];

/**
 * Story 7.2 (AC-5): a household's own default for a NEW thread's
 * `visibility` when `create_thread()` is called without an explicit
 * `p_visibility` (AD-22; FR96/FR99) — an open/private radio bound directly
 * to `accounts.default_thread_visibility` through a plain
 * `dataProvider.update("accounts", …)`. No RPC: this is a column write,
 * grant-covered by `06_grants.sql` (Task 2), not a mutation with its own
 * business rule. Never rewrites an existing thread — only what
 * `create_thread()` resolves to the *next* time `p_visibility` is omitted.
 *
 * Gated on `useViewerRole()`, not a client-side guess at household
 * ownership: `single` is excluded because every `accounts` write is
 * already denied to that role at the RLS layer, and an enabled control
 * whose save always fails with `42501` is a worse outcome than an absent
 * one. Renders nothing while the role is still resolving (`isPending`) or
 * before the account row itself has loaded, for the same reason — never an
 * enabled control bound to data it does not have yet.
 */
export const CommunicationSection = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const { role, isPending: isRolePending } = useViewerRole();
  const { data: contexts } = useMyContexts();
  const activeContext = pickActiveContext(contexts);
  const { data: account, refetch } = useGetOne<Account>("accounts", {
    id: activeContext?.account_id,
  });
  const [update, { isPending: isSaving }] = useUpdate();

  if (isRolePending || !hasVisibility(CAN_SET_DEFAULT_VISIBILITY, role)) {
    return null;
  }
  if (!account) return null;

  const handleChange = (value: string) => {
    const visibility = value as ThreadVisibility;
    if (visibility === account.default_thread_visibility) return;

    update(
      "accounts",
      {
        id: account.id,
        data: { default_thread_visibility: visibility },
        previousData: { id: account.id },
      },
      {
        onSuccess: () => refetch(),
        onError: () => {
          notify("crm.settings.communication.save_error", {
            type: "error",
            messageArgs: { _: "Couldn't save that. Try again." },
          });
        },
      },
    );
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.communication.title", {
          _: "Communication",
        })}
      </SectionLabel>
      <ItemGroup className="rounded-lg border overflow-hidden">
        <Item size="sm" className="flex-col items-stretch gap-3">
          <ItemContent className="flex-none">
            <ItemTitle className="font-normal">
              {translate("crm.settings.communication.default_visibility", {
                _: "New conversations",
              })}
            </ItemTitle>
            <ItemDescription>
              {translate("crm.settings.communication.default_visibility_hint", {
                _: "Who can see a new conversation by default",
              })}
            </ItemDescription>
          </ItemContent>
          <RadioGroup
            value={account.default_thread_visibility}
            onValueChange={handleChange}
            disabled={isSaving}
            className="gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="open" id="communication-visibility-open" />
              <Label
                htmlFor="communication-visibility-open"
                className="font-normal"
              >
                {translate("crm.settings.communication.visibility_open", {
                  _: "Open — everyone in the household",
                })}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="private"
                id="communication-visibility-private"
              />
              <Label
                htmlFor="communication-visibility-private"
                className="font-normal"
              >
                {translate("crm.settings.communication.visibility_private", {
                  _: "Private — only participants",
                })}
              </Label>
            </div>
          </RadioGroup>
        </Item>
      </ItemGroup>
    </div>
  );
};
