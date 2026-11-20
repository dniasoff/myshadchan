import type { Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import { createShadchanInline } from "../shidduchim/createShadchanInline";

export type SuggestedByFormValues = {
  suggested_by_name?: unknown;
  suggested_by_phone?: unknown;
  make_person_shadchan?: unknown;
  shadchan_id?: unknown;
};

const PHONE_PATTERN = /^[0-9+()\s-]*$/;

export function validateSuggestedByPhone(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return PHONE_PATTERN.test(value)
    ? undefined
    : "Use digits, spaces, +, dashes, or parentheses for a phone number";
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function identifierValue(value: unknown): Identifier | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

/** Resolve the optional promotion only when the user explicitly ticks it. */
export async function resolveSuggestedByValues(
  dataProvider: CrmDataProvider,
  values: SuggestedByFormValues,
): Promise<{
  suggestedByName: string | null;
  suggestedByPhone: string | null;
  shadchanId: Identifier | null;
}> {
  const suggestedByName = textValue(values.suggested_by_name);
  const suggestedByPhone = textValue(values.suggested_by_phone);
  const selectedShadchanId = identifierValue(values.shadchan_id);

  if (values.make_person_shadchan === true && selectedShadchanId == null) {
    if (!suggestedByName) {
      throw new Error("Enter a name before making this person a shadchan");
    }
    const createShadchan = createShadchanInline(dataProvider);
    if (!createShadchan) {
      throw new Error("Couldn't create this shadchan");
    }
    const shadchan = await createShadchan(suggestedByName);
    if (shadchan?.id == null) {
      throw new Error("Couldn't create this shadchan");
    }
    return {
      suggestedByName,
      suggestedByPhone,
      shadchanId: shadchan.id,
    };
  }

  return {
    suggestedByName,
    suggestedByPhone,
    shadchanId: selectedShadchanId,
  };
}

/** Keep the field's initial value consistent with the existing Inbox sender. */
export function suggestedByDefaultName(
  value: string | null | undefined,
): string {
  return value?.trim() ?? "";
}
