import { afterEach, describe, expect, it, vi } from "vitest";
import { getInitialLocale, i18nProvider } from "./i18nProvider";
import { englishCrmMessages } from "./englishCrmMessages";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("i18nProvider", () => {
  it("registers en locale only", () => {
    expect(i18nProvider.getLocales?.()).toEqual([
      { locale: "en", name: "English" },
    ]);
  });

  it("translates the language key in english", async () => {
    await i18nProvider.changeLocale("en");

    expect(i18nProvider.translate("crm.language")).toBe("Language");
  });

  it("falls back to english for unknown locales", async () => {
    await i18nProvider.changeLocale("es");

    expect(i18nProvider.translate("crm.language")).toBe("Language");
  });

  it("translates recently added en crm keys", async () => {
    await i18nProvider.changeLocale("en");

    expect(i18nProvider.translate("crm.settings.title")).toBe("Settings");
  });

  it("always returns english locale", () => {
    vi.stubGlobal("navigator", {
      language: "fr-FR",
      languages: ["fr-FR", "en-US"],
    });

    expect(getInitialLocale()).toBe("en");
  });

  it("falls back to english when browser locale is unsupported", () => {
    vi.stubGlobal("navigator", {
      language: "es-ES",
      languages: ["es-ES", "pt-BR"],
    });

    expect(getInitialLocale()).toBe("en");
  });

  it("resolves the members resource name in english", async () => {
    await i18nProvider.changeLocale("en");
    expect(
      i18nProvider.translate("resources.members.name", { smart_count: 2 }),
    ).toBe("Users");
  });

  it("carries no retired sales catalogue block", () => {
    expect("sales" in englishCrmMessages.resources).toBe(false);
  });
});
