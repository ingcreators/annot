// Tiny i18n: dictionary lookup keyed by stable string ids, with
// en + ja columns. No ICU MessageFormat — the example app doesn't
// need plurals or gender. Locale state is in-memory only;
// reloading the page resets to "en" (paper-show fidelity).

export type Locale = "en" | "ja";

const LOCALES: ReadonlyArray<Locale> = ["en", "ja"];

type DictEntry = Record<Locale, string>;

const DICT: Record<string, DictEntry> = {
  // App shell.
  "app.title": { en: "Workflow App", ja: "ワークフローアプリ" },
  "app.lang.label": { en: "Language", ja: "言語" },
  "app.lang.en": { en: "English", ja: "英語" },
  "app.lang.ja": { en: "Japanese", ja: "日本語" },
  "app.signOut": { en: "Sign out", ja: "サインアウト" },

  // Placeholder screen (Phase 1 only).
  "placeholder.heading": { en: "TODO screen", ja: "TODO 画面" },
  "placeholder.body": {
    en: "This screen will be implemented in a later phase.",
    ja: "この画面は後のフェーズで実装されます。",
  },
  "placeholder.routeLabel": { en: "Current route:", ja: "現在のルート:" },

  // Login (placeholder copy — full impl arrives in Phase 2).
  "login.heading": { en: "Sign in", ja: "サインイン" },

  // Menu (placeholder).
  "menu.heading": { en: "Menu", ja: "メニュー" },

  // Generic.
  "common.back": { en: "Back", ja: "戻る" },
};

let currentLocale: Locale = "en";
const listeners = new Set<() => void>();

export function t(key: string): string {
  const entry = DICT[key];
  if (!entry) {
    return key;
  }
  return entry[currentLocale] ?? entry.en ?? key;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(next: Locale): void {
  if (!LOCALES.includes(next) || next === currentLocale) {
    return;
  }
  currentLocale = next;
  document.documentElement.lang = next;
  for (const fn of listeners) {
    fn();
  }
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function availableLocales(): ReadonlyArray<Locale> {
  return LOCALES;
}
