import { useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { PersonaChecklist } from "../login/PersonaChecklist";
import type { CrmDataProvider } from "../providers/types";
import { MY_PERSONAS_QUERY_KEY, useMyPersonas } from "../root/useMyPersonas";
import type { Persona } from "../types";
import { SectionLabel } from "./SectionLabel";

/**
 * Maps `remove_persona()`'s guard messages (2.5 AC-5; review finding #1's
 * added guard) to a specific, translated error key — never raw Postgres
 * text in the UI. Order matters: check the more specific "ask your
 * household admin" phrase before the generic "cannot remove parent" one,
 * since both mention removal.
 */
const removalErrorCopy = (
  message: string,
): { key: string; fallback: string } => {
  if (message.includes("ask your household admin")) {
    return {
      key: "crm.settings.persona_remove_error_ask_admin",
      fallback:
        "This record is managed by your household admin — ask them to make this change.",
    };
  }
  if (message.includes("cannot remove your only persona")) {
    return {
      key: "crm.settings.persona_remove_error_only_persona",
      fallback: "You can't remove your only persona. Add another first.",
    };
  }
  if (message.includes("cannot remove your last active membership")) {
    return {
      key: "crm.settings.persona_remove_error_last_access",
      fallback:
        "You're the only one who can still reach this account's records — add another member before removing this.",
    };
  }
  if (message.includes("cannot remove parent")) {
    return {
      key: "crm.settings.persona_remove_error_parent_guard",
      fallback:
        "Another admin needs to manage your household's other singles before you can remove this.",
    };
  }
  return {
    key: "crm.settings.persona_remove_error_generic",
    fallback: "Couldn't remove that. Try again.",
  };
};

/**
 * Settings' "add or remove a persona at any time" affordance (2.5 AC-1):
 * reuses Story 2.3's `PersonaChecklist` as-is, pre-checked from
 * `useMyPersonas()`. Each toggle calls `addPersona()`/`removePersona()`
 * immediately and is its own committed action — no batch save button,
 * matching `PreferencesSection`'s commit-on-change Select/ToggleGroup and
 * `tasks/Task.tsx:57-61,88-93`'s commit-on-change Checkbox.
 *
 * On failure the checkbox is left in its pre-toggle state "for free": `value`
 * is derived straight from the still-unchanged `useMyPersonas()` cache (it is
 * only invalidated on success), so there is no separate revert to write.
 */
export const PersonasSection = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: personas } = useMyPersonas();
  const [isPending, setIsPending] = useState(false);

  const value = useMemo(
    () => (personas ?? []).map((p) => p.persona),
    [personas],
  );

  const handleChange = async (next: Persona[]) => {
    const added = next.find((p) => !value.includes(p));
    const removed = value.find((p) => !next.includes(p));
    // PersonaChecklist only ever toggles one box per click, so exactly one
    // of the two is ever set.
    const persona = added ?? removed;
    if (!persona) return;

    setIsPending(true);
    try {
      if (added) {
        await dataProvider.addPersona(persona);
        // add_persona() never switches the caller's active context (Story
        // 2.2's Dev Notes) — a scoped invalidation is enough.
        await queryClient.invalidateQueries({
          queryKey: MY_PERSONAS_QUERY_KEY,
        });
      } else {
        await dataProvider.removePersona(persona);
        // Review finding #5: removing `shadchan` or `parent` can archive
        // the membership backing the caller's active context, moving or
        // NULLing member_state.active_account_id server-side (AC-7) — the
        // scope of every other cached query, not just my_personas(). A
        // `single` removal only ever archives a `singles` row, never
        // account_members, so it can never touch the active context and a
        // scoped invalidation stays correct there. This mirrors
        // ContextSwitcher's own handler for the identical event ("a context
        // switch invalidates EVERYTHING, not a scoped queryKey").
        if (persona === "single") {
          await queryClient.invalidateQueries({
            queryKey: MY_PERSONAS_QUERY_KEY,
          });
        } else {
          await queryClient.invalidateQueries();
          navigate("/");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const { key, fallback } = added
        ? {
            key: "crm.settings.persona_add_error",
            fallback: "Couldn't set that up. Try again.",
          }
        : removalErrorCopy(message);
      notify(key, { type: "error", messageArgs: { _: fallback } });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.personas_title", { _: "Personas" })}
      </SectionLabel>
      <div className="rounded-lg border p-4">
        <PersonaChecklist
          value={value}
          onChange={handleChange}
          disabled={isPending}
        />
      </div>
    </div>
  );
};
