import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import {
  type Identifier,
  useDataProvider,
  useNotify,
  useTranslate,
} from "ra-core";
import { useNavigate } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { CrmDataProvider } from "../providers/types";
import { useMyContexts } from "../root/useMyContexts";
import type { MyContext } from "../types";

/**
 * Switches which context (household vs. shadchanus) is active (Story 2.4,
 * AD-19) — a different axis entirely from `SingleSwitcherPill`'s "which
 * single's pipeline am I viewing." Renders an empty fragment for a login
 * with fewer than 2 contexts (AC-1): no pill, no disabled control, no
 * visual trace. Mounted twice — `layout/TopBar.tsx` for desktop,
 * `settings/SettingsPageMobile.tsx` for mobile (AC-7) — the same component
 * both places, never a second implementation.
 */
export const ContextSwitcher = () => {
  const { data: contexts, isError: contextsErrored } = useMyContexts();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const translate = useTranslate();
  const notify = useNotify();
  const [switching, setSwitching] = useState(false);
  const notifiedLoadError = useRef(false);

  useEffect(() => {
    // Review finding #4: getMyContexts() is fail-loud (dataProvider.ts's own
    // comment: "a swallowed error here would read as 'only one context' and
    // silently hide the switcher"). Collapsing a rejected query into the
    // same empty-fragment render as "fewer than 2 contexts" (AC-1) would
    // defeat that on the very next line, so a load failure gets its own
    // toast — once per failure, not on every re-render while it persists.
    if (contextsErrored && !notifiedLoadError.current) {
      notifiedLoadError.current = true;
      notify("crm.context_switcher.load_error", {
        type: "error",
        messageArgs: { _: "Couldn't load your contexts." },
      });
    }
    if (!contextsErrored) {
      notifiedLoadError.current = false;
    }
  }, [contextsErrored, notify]);

  if (!contexts || contexts.length < 2) {
    return <></>;
  }

  const active = contexts.find((context) => context.is_active) ?? contexts[0];

  const kindLabel = (kind: MyContext["kind"]) =>
    kind === "household"
      ? translate("crm.context_switcher.kind_household", { _: "Household" })
      : translate("crm.context_switcher.kind_shadchanus", {
          _: "Shadchanus",
        });

  const contextLabel = (context: MyContext) =>
    translate("crm.context_switcher.label", {
      name: context.name,
      kind: kindLabel(context.kind),
      _: "%{name} · %{kind}",
    });

  const handleSelect = async (accountId: Identifier) => {
    // Review finding #9: re-selecting the already-active context is a
    // destructive no-op otherwise — a full invalidateQueries() + navigate("/")
    // that kicks the user off whatever page they're on for nothing.
    if (String(accountId) === String(active.account_id)) {
      return;
    }
    setSwitching(true);
    try {
      // AD-19: set_active_context() (via switchActiveContext) is the only
      // validated way to switch — it raises if the caller has no live
      // active membership of accountId, so a failed switch surfaces here
      // rather than silently leaving the old context active.
      await dataProvider.switchActiveContext(accountId);
      // AC-3: a context switch invalidates EVERYTHING, not a scoped
      // queryKey — every screen's data belongs to the account that just
      // changed underneath it.
      await queryClient.invalidateQueries();
      // AD-24: records live at URLs; a record from the context just left
      // no longer resolves for this login, so leave nothing open behind.
      navigate("/");
    } catch {
      // Review finding #3: always the dedicated i18n key (AD-18/AC-8) —
      // never the raw Error.message. Both providers throw a plain `Error`
      // (Supabase's own generic wrapper, or FakeRest's developer-facing
      // "no active membership of account N"), so branching on
      // `instanceof Error` here never reached the translate() fallback and
      // left `crm.context_switcher.switch_error` dead in both catalogues.
      notify("crm.context_switcher.switch_error", {
        type: "error",
        messageArgs: { _: "Couldn't switch context. Try again." },
      });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={switching}
          aria-label={translate("crm.context_switcher.trigger_label", {
            context: contextLabel(active),
            _: "Switch context: %{context}",
          })}
          className="inline-flex h-9 items-center gap-2 rounded-full border
            border-border bg-secondary px-3 text-sm font-semibold
            text-foreground outline-none transition-colors duration-[160ms]
            hover:bg-secondary/80 disabled:cursor-not-allowed
            disabled:opacity-70
            focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span>{contextLabel(active)}</span>
          <ChevronDown
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {contexts.map((context) => (
          <DropdownMenuItem
            key={context.account_id}
            onSelect={() => handleSelect(context.account_id)}
          >
            {contextLabel(context)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
