import { i18nProvider } from "../providers/commons/i18nProvider";

/**
 * Story 9.4's public search page renders outside `<Admin>` (`App.tsx`
 * mounts it before `<LandingGate>`/`<CRM>`, Task 1), so there is no
 * `I18nContext` for `useTranslate()` to read. Mirrors
 * `landing/landingTranslate.ts` exactly, as a second small file rather than
 * a shared export — this story's own declared file set is what owns this
 * page (see its Dev Notes), and the two one-liners could be unified into a
 * single generic helper later without changing either call site.
 *
 * The default message is always supplied so a key missing from one catalog
 * degrades to readable English rather than to a raw translation key.
 */
export const translatePublicSearch = (
  key: string,
  defaultMessage: string,
): string => i18nProvider.translate(key, { _: defaultMessage });
