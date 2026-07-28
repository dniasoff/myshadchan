import { afterEach, describe, expect, it, vi } from "vitest";
import { getInitialLocale, i18nProvider } from "./i18nProvider";
import { englishCrmMessages } from "./englishCrmMessages";
import { frenchCrmMessages } from "./frenchCrmMessages";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("i18nProvider", () => {
  it("registers en and fr locales", () => {
    expect(i18nProvider.getLocales?.()).toEqual([
      { locale: "en", name: "English" },
      { locale: "fr", name: "Français" },
    ]);
  });

  it("translates the language key in french", async () => {
    await i18nProvider.changeLocale("fr");

    expect(i18nProvider.translate("crm.language")).toBe("Langue");
  });

  it("falls back to english for unknown locales", async () => {
    await i18nProvider.changeLocale("es");

    expect(i18nProvider.translate("crm.language")).toBe("Language");
  });

  it("translates recently added fr crm keys", async () => {
    await i18nProvider.changeLocale("fr");

    expect(i18nProvider.translate("crm.settings.title")).toBe("Paramètres");
  });

  it("uses browser french locale when available", () => {
    vi.stubGlobal("navigator", {
      language: "fr-FR",
      languages: ["fr-FR", "en-US"],
    });

    expect(getInitialLocale()).toBe("fr");
  });

  it("falls back to english when browser locale is unsupported", () => {
    vi.stubGlobal("navigator", {
      language: "es-ES",
      languages: ["es-ES", "pt-BR"],
    });

    expect(getInitialLocale()).toBe("en");
  });

  it("resolves the members resource name in english and french", async () => {
    await i18nProvider.changeLocale("en");
    expect(
      i18nProvider.translate("resources.members.name", { smart_count: 2 }),
    ).toBe("Users");

    await i18nProvider.changeLocale("fr");
    expect(
      i18nProvider.translate("resources.members.name", { smart_count: 2 }),
    ).toBe("Utilisateurs");
  });

  it("carries no retired sales catalogue block", () => {
    expect("sales" in englishCrmMessages.resources).toBe(false);
    expect("sales" in frenchCrmMessages.resources).toBe(false);
  });
});
