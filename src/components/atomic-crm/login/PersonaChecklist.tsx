import { useTranslate } from "ra-core";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Persona } from "../types";

export interface PersonaChecklistProps {
  /** The persona(s) currently ticked. */
  value: Persona[];
  /** Called with the full next selection whenever a box is (un)ticked. */
  onChange: (next: Persona[]) => void;
  className?: string;
  /** Disables every checkbox — Settings (2.5) sets this while a toggle's
   * add_persona()/remove_persona() call is in flight, so a second click
   * can't race the first. Onboarding never passes it. */
  disabled?: boolean;
}

const PERSONA_OPTIONS: Array<{
  persona: Persona;
  key: string;
  fallback: string;
}> = [
  {
    persona: "single",
    key: "crm.auth.onboarding.persona_single",
    fallback: "I'm looking for a shidduch for myself",
  },
  {
    persona: "parent",
    key: "crm.auth.onboarding.persona_parent",
    fallback: "I'm looking for a shidduch for my children",
  },
  {
    persona: "shadchan",
    key: "crm.auth.onboarding.persona_shadchan",
    fallback: "I'm a matchmaker (shadchan)",
  },
];

/**
 * The three-checkbox persona multi-select
 * (personas-and-contexts.md:9-18) — a plain controlled checkbox group with
 * no onboarding-specific behaviour (no wizard steps, no `addPersona` calls)
 * baked in, so Story 2.5's Settings "add/remove a persona" affordance can
 * import this exact file rather than re-implementing it. Follows
 * the checkbox-row styling this auth surface already uses.
 *
 * The "at least one ticked" rule is deliberately NOT enforced here — it is
 * the caller's to enforce. Onboarding blocks continuing on zero; 2.5
 * legitimately allows unticking down to zero (persona removal).
 */
export const PersonaChecklist = ({
  value,
  onChange,
  className,
  disabled = false,
}: PersonaChecklistProps) => {
  const translate = useTranslate();

  const toggle = (persona: Persona, checked: boolean) => {
    onChange(
      checked ? [...value, persona] : value.filter((p) => p !== persona),
    );
  };

  return (
    <div className={cn("space-y-3", className)}>
      {PERSONA_OPTIONS.map(({ persona, key, fallback }) => (
        <Label
          key={persona}
          htmlFor={`persona-checkbox-${persona}`}
          className={cn(
            "flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-start font-normal text-foreground shadow-sm transition-colors duration-[160ms]",
            disabled ? "opacity-60" : "cursor-pointer hover:bg-secondary/50",
          )}
        >
          {/* `aria-label` as well as the wrapping <Label>. Radix renders this
           * as `<button role="checkbox">`, and neither `htmlFor` nor a
           * wrapping <label> names a button — both associate with form
           * controls only. Without this the accessible name resolved empty
           * in a real browser, so a screen reader announced three identical
           * "checkbox, unchecked" rows here. The <Label> still earns its
           * place: it makes the whole card a tap target. */}
          <Checkbox
            id={`persona-checkbox-${persona}`}
            aria-label={translate(key, { _: fallback })}
            checked={value.includes(persona)}
            onCheckedChange={(checked) => toggle(persona, checked === true)}
            disabled={disabled}
            className="mt-0.5"
          />
          <span className="text-sm font-medium">
            {translate(key, { _: fallback })}
          </span>
        </Label>
      ))}
    </div>
  );
};
