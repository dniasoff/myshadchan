import { i18nProvider } from "../providers/commons/i18nProvider";

/**
 * `SharedProfilePage.tsx` renders outside `<Admin>` (`App.tsx` mounts it
 * before `<LandingGate>`/`<CRM>`, alongside Story 9.4's `/find` branch), so
 * there is no `I18nContext` for `useTranslate()` to read. Mirrors
 * `landing/landingTranslate.ts` and `listings/publicSearchTranslate.ts`
 * exactly, as a third small file rather than a shared export — each pre-CRM
 * page's own story owns its own copy (9.4's own Dev Notes explain why: the
 * two one-liners could be unified later without changing any call site).
 *
 * The default message is always supplied so a key missing from one
 * catalogue degrades to readable English rather than to a raw translation
 * key.
 */
export const translateSharedProfile = (
  key: string,
  defaultMessage: string,
  options: Record<string, unknown> = {},
): string => i18nProvider.translate(key, { ...options, _: defaultMessage });
