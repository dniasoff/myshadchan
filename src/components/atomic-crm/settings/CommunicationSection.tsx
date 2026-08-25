import type { ReactElement } from "react";
import { useGetOne, useNotify, useTranslate, useUpdate } from "ra-core";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";

import { useViewerRole } from "../entity360/useViewerRole";
import { hasVisibility } from "../entity360/visibility";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";
import { usePushSubscription } from "../threads/usePushSubscription";
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
 *
 * Review finding F1 (Story 7.2, now resolved): `thread_is_readable()` used
 * to not enforce `visibility` at all — Story 7.3 shipped that enforcement
 * (the private branch in `thread_is_readable()`, `02_functions.sql`,
 * proven live by 7.3's own falsifiable tests: a same-account non-participant
 * and a `single` participant are both refused a private thread's body).
 * "Private" is therefore a real, backend-enforced choice now — both radios
 * are selectable, with no client-side gate of its own beyond
 * `CAN_SET_DEFAULT_VISIBILITY` above.
 *
 * Story 7.5 (Task 7): the section also hosts the push opt-in
 * (`PushNotificationsItem` below) — device-level, keyed to the caller's own
 * membership (`push_subscriptions.member_id`), so it is NOT gated behind
 * `CAN_SET_DEFAULT_VISIBILITY`/`useViewerRole()` the way the household-wide
 * default posture is: a `single` cannot set the household's default, but
 * can absolutely opt their own device into push for the threads they are
 * already a participant of. The container (`<div>`/`SectionLabel`/
 * `ItemGroup`) therefore renders unconditionally; only the default-visibility
 * `Item` inside it is conditional on `canSetDefaultVisibility`.
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

  const canSetDefaultVisibility =
    !isRolePending &&
    hasVisibility(CAN_SET_DEFAULT_VISIBILITY, role) &&
    account != null;

  const handleChange = (value: string) => {
    if (!account) return;
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
        {canSetDefaultVisibility && account ? (
          <>
            <Item size="sm" className="flex-col items-stretch gap-3">
              <ItemContent className="flex-none">
                <ItemTitle className="font-normal">
                  {translate("crm.settings.communication.default_visibility", {
                    _: "New conversations",
                  })}
                </ItemTitle>
                <ItemDescription>
                  {translate(
                    "crm.settings.communication.default_visibility_hint",
                    { _: "Who can see a new conversation by default" },
                  )}
                </ItemDescription>
              </ItemContent>
              <RadioGroup
                value={account.default_thread_visibility}
                onValueChange={handleChange}
                disabled={isSaving}
                className="gap-2"
              >
                <div className="flex items-center gap-2">
                  {/* `aria-label` as well as the <Label htmlFor>: Radix renders
                   * this as `<button role="radio">`, and `htmlFor` names form
                   * controls only — never a button, so the accessible name
                   * resolved empty. Measured in a real browser, not read off
                   * the markup, which looks correct. */}
                  <RadioGroupItem
                    value="open"
                    id="communication-visibility-open"
                    aria-label={translate(
                      "crm.settings.communication.visibility_open",
                      { _: "Open — everyone in the household" },
                    )}
                  />
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
                  {/* `aria-label` as well as the <Label htmlFor>: Radix renders
                   * this as `<button role="radio">`, and `htmlFor` names form
                   * controls only — never a button, so the accessible name
                   * resolved empty. Measured in a real browser, not read off
                   * the markup, which looks correct. */}
                  <RadioGroupItem
                    value="private"
                    id="communication-visibility-private"
                    aria-label={translate(
                      "crm.settings.communication.visibility_private",
                      { _: "Private — only participants" },
                    )}
                  />
                  <Label
                    htmlFor="communication-visibility-private"
                    className="font-normal"
                  >
                    {translate(
                      "crm.settings.communication.visibility_private",
                      { _: "Private — only participants" },
                    )}
                  </Label>
                </div>
              </RadioGroup>
            </Item>
            <ItemSeparator />
          </>
        ) : null}
        <PushNotificationsItem />
      </ItemGroup>
    </div>
  );
};

/**
 * Story 7.5 (Task 7, AC-5, AC-12): the push opt-in's ONLY entry point —
 * `usePushSubscription.ts` was built and unit-tested with no caller
 * anywhere in `src/` before this. Renders the hook's four terminal states
 * explicitly (`.claude/rules/coding-style.md` forbids swallowing them):
 * `unsupported`/`demo` disable the button and explain why up front (the
 * hook itself only populates `errorMessage` from inside `subscribe()`, so a
 * disabled button that can never be clicked would otherwise show no reason
 * at all); `denied` explains itself proactively too (the browser will not
 * re-prompt, so making the caller click once just to learn that is a
 * needless round trip); `error` and a not-yet-clicked `idle` both leave the
 * button enabled so a transient failure (e.g. the `create` call) can be
 * retried.
 *
 * Honesty clause (this story's Dev Notes / Epic 12 gate G1): NONE of the
 * seven Cloudflare Workers has ever been deployed, so even a fully
 * `subscribed` device will not actually receive anything yet. Rather than
 * let "Enabled on this device" imply live delivery, a fixed disclaimer
 * renders regardless of `state` — this is the explicit choice this story's
 * dispatch prompt asked to be named, not an oversight.
 */
function PushNotificationsItem(): ReactElement {
  const translate = useTranslate();
  const { state, errorMessage, subscribe } = usePushSubscription();

  const isDisabled =
    state === "unsupported" || state === "demo" || state === "subscribing";

  const buttonLabel = (): string => {
    if (state === "subscribing") {
      return translate("crm.settings.communication.push.enabling", {
        _: "Enabling…",
      });
    }
    if (state === "subscribed") {
      return translate("crm.settings.communication.push.enabled", {
        _: "Enabled on this device",
      });
    }
    return translate("crm.settings.communication.push.enable", {
      _: "Enable on this device",
    });
  };

  // Proactive copy for the two states usePushSubscription() can only
  // explain from INSIDE subscribe() (errorMessage stays null until the
  // button is clicked) — see this function's header comment.
  const helperText = (): string | null => {
    if (errorMessage) return errorMessage;
    if (state === "unsupported") {
      return translate("crm.settings.communication.push.unsupported", {
        _: "This browser does not support push notifications (common on iOS unless the app is installed as a Home Screen app).",
      });
    }
    if (state === "demo") {
      return translate("crm.settings.communication.push.demo", {
        _: "Not available in this demo — there is no delivery behind it to enable.",
      });
    }
    if (state === "denied") {
      return translate("crm.settings.communication.push.denied_hint", {
        _: "Notifications are blocked for this site. Allow them from your browser's site settings, then try again.",
      });
    }
    return null;
  };
  const helper = helperText();

  return (
    <Item size="sm" className="flex-col items-stretch gap-3">
      <ItemContent className="flex-none">
        <ItemTitle className="font-normal">
          {translate("crm.settings.communication.push.title", {
            _: "Push notifications",
          })}
        </ItemTitle>
        <ItemDescription>
          {translate("crm.settings.communication.push.description", {
            _: "Get a notification on this device when someone sends a message in a discussion you're part of.",
          })}
        </ItemDescription>
      </ItemContent>
      <p className="text-xs text-muted-foreground">
        {translate("crm.settings.communication.push.delivery_notice", {
          _: "This only turns on this device's side. Delivery is not live yet, so you will not actually receive anything until it is switched on.",
        })}
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isDisabled}
          onClick={() => void subscribe()}
        >
          {buttonLabel()}
        </Button>
      </div>
      {helper ? (
        <p
          role={state === "error" ? "alert" : undefined}
          className="text-xs text-destructive"
        >
          {helper}
        </p>
      ) : null}
    </Item>
  );
}
