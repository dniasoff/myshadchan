import type { Identifier } from "ra-core";

export type SuggestedByFormValues = {
  suggested_by_name?: unknown;
  suggested_by_phone?: unknown;
  shadchan_id?: unknown;
};

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

export function validateSuggestedByName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 200) return "Use 200 characters or fewer for a name";
  if (hasControlCharacter(trimmed)) {
    return "Use ordinary characters for a name";
  }
  return undefined;
}

export function validateSuggestedByPhone(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 40) {
    return "Use 40 characters or fewer for a phone number";
  }
  if (hasControlCharacter(trimmed)) {
    return "Use ordinary characters for a phone number";
  }
  return undefined;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function identifierValue(value: unknown): Identifier | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

export async function resolveSuggestedByValues(
  values: SuggestedByFormValues,
): Promise<{
  suggestedByName: string | null;
  suggestedByPhone: string | null;
  shadchanId: Identifier | null;
}> {
  const suggestedByName = textValue(values.suggested_by_name);
  const suggestedByPhone = textValue(values.suggested_by_phone);
  const selectedShadchanId = identifierValue(values.shadchan_id);

  return {
    suggestedByName,
    suggestedByPhone,
    shadchanId: selectedShadchanId,
  };
}

/** Keep a persisted phone value display-friendly while making its link safe. */
export function suggestedByPhoneHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}
