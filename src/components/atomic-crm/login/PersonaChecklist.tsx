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
 * `AgeAffirmation.tsx`'s checkbox-row styling on the same auth surface.
 *
 * The "at least one ticked" rule is deliberately NOT enforced here — it is
 * the caller's to enforce. Onboarding blocks continuing on zero; 2.5
 * legitimately allows unticking down to zero (persona removal).
 */
export const PersonaChecklist = ({
  value,
  onChange,
  className,
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
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 text-start font-normal text-foreground shadow-sm transition-colors duration-[160ms] hover:bg-secondary/50"
        >
          <Checkbox
            id={`persona-checkbox-${persona}`}
            checked={value.includes(persona)}
            onCheckedChange={(checked) => toggle(persona, checked === true)}
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
