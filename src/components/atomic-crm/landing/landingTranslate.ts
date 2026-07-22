import { i18nProvider } from "../providers/commons/i18nProvider";

/**
 * The landing page renders outside `<Admin>`, so there is no I18nContext for
 * `useTranslate()` to read. It reads the shared catalogs directly instead; the
 * locale comes from the browser, which is the right default for a visitor who
 * has not signed in yet.
 *
 * The default message is always supplied so a key missing from one catalog
 * degrades to readable English rather than to a raw translation key.
 */
export const translateLanding = (key: string, defaultMessage: string): string =>
  i18nProvider.translate(key, { _: defaultMessage });
