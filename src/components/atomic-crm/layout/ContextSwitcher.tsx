import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { CrmDataProvider } from "../providers/types";
import { useMyContexts } from "../root/useMyContexts";
import type { MyContext } from "../types";

type Translate = ReturnType<typeof useTranslate>;

const kindLabel = (kind: MyContext["kind"], translate: Translate) =>
  kind === "household"
    ? translate("crm.context_switcher.kind_household", { _: "Household" })
    : translate("crm.context_switcher.kind_shadchanus", {
        _: "Shadchanus",
      });

const contextLabel = (context: MyContext, translate: Translate) =>
  translate("crm.context_switcher.label", {
    name: context.name,
    kind: kindLabel(context.kind, translate),
    demo: context.is_demo
      ? ` · ${translate("crm.context_switcher.demo_label", { _: "Preview" })}`
      : "",
    _: "%{name} · %{kind}%{demo}",
  });

/**
 * The per-context `<DropdownMenuItem>` rows shared by both render surfaces
 * (Story 4.4): the desktop pill's own `DropdownMenuContent` below, and the
 * mobile bottom nav's "More" menu (`layout/MobileNavigation.tsx`). One data
 * source (`useMyContexts()`'s query cache), one switch path
 * (`switchActiveContext` + invalidate-everything + navigate-home), two
 * render surfaces — never a second implementation of the switch itself.
 * Renders nothing for a login with fewer than 2 contexts (AC-1 semantics,
 * preserved): no rows, no visual trace.
 *
 * Each row is "name + kind + active check" per Task 4 — the active context
 * gets a trailing `<Check>`, matching `ThemeMenuItems`'s own indicator
 * treatment, so a 2+ context user can tell which one is live from the rows
 * alone (the desktop pill's trigger already names it; the mobile "More" menu
 * has no trigger, so the rows are the only place this can show).
 *
 * `withSectionLabel` makes the component own its section's chrome — a
 * `DropdownMenuLabel` plus a trailing `DropdownMenuSeparator`, emitted only
 * when there are rows to bracket — for mounting inside a menu that also
 * holds unrelated items (mobile's "More" menu, between the nav items and
 * `ThemeMenuItems`). Without it, callers get bare rows: the desktop pill's
 * `DropdownMenuContent` holds nothing else, so a label and self-supplied
 * separator would be section chrome with nothing to divide.
 */
export const ContextMenuItems = ({
  withSectionLabel = false,
}: {
  withSectionLabel?: boolean;
} = {}) => {
  const { data: contexts } = useMyContexts();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const translate = useTranslate();
  const notify = useNotify();

  if (!contexts || contexts.length < 2) {
    return null;
  }

  const active = contexts.find((context) => context.is_active) ?? contexts[0];

  const handleSelect = async (accountId: Identifier) => {
    // Review finding #9: re-selecting the already-active context is a
    // destructive no-op otherwise — a full invalidateQueries() + navigate("/")
    // that kicks the user off whatever page they're on for nothing.
    if (String(accountId) === String(active.account_id)) {
      return;
    }
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
      // never the raw Error.message.
      notify("crm.context_switcher.switch_error", {
        type: "error",
        messageArgs: { _: "Couldn't switch context. Try again." },
      });
    }
  };

  const rows = (
    <>
      {contexts.map((context) => (
        <DropdownMenuItem
          key={context.account_id}
          onSelect={() => handleSelect(context.account_id)}
        >
          {contextLabel(context, translate)}
          {context.account_id === active.account_id ? (
            <Check className="ms-auto size-4" aria-hidden="true" />
          ) : null}
        </DropdownMenuItem>
      ))}
    </>
  );

  if (!withSectionLabel) {
    return rows;
  }

  return (
    <>
      <DropdownMenuLabel>
        {translate("crm.context_switcher.section_title", { _: "Context" })}
      </DropdownMenuLabel>
      {rows}
      <DropdownMenuSeparator />
    </>
  );
};

/**
 * Desktop pill: switches which context (household vs. shadchanus) is active
 * (Story 2.4, AD-19) — a different axis entirely from `SingleSwitcherPill`'s
 * "which single's pipeline am I viewing." Renders an empty fragment for a
 * login with fewer than 2 contexts (AC-1): no pill, no disabled control, no
 * visual trace. Mounted in `layout/TopBar.tsx` only — mobile reaches the
 * same context list through `ContextMenuItems` above, inlined into
 * `layout/MobileNavigation.tsx`'s "More" menu (Story 4.4 NFR-14; replaces an
 * interim `settings/SettingsPageMobile.tsx` mount 2.4 used before mobile had
 * a persistent chrome slot for this).
 */
export const ContextSwitcher = () => {
  const { data: contexts, isError: contextsErrored } = useMyContexts();
  const translate = useTranslate();
  const notify = useNotify();
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={translate("crm.context_switcher.trigger_label", {
            context: contextLabel(active, translate),
            _: "Switch context: %{context}",
          })}
          className="inline-flex h-9 items-center gap-2 rounded-full border
            border-border bg-secondary px-3 text-sm font-semibold
            text-foreground outline-none transition-colors duration-[160ms]
            hover:bg-secondary/80
            focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span>{contextLabel(active, translate)}</span>
          <ChevronDown
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <ContextMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
