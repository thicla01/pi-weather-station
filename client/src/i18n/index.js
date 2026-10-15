import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import { syncDocumentLang } from "./documentLang";

const SUPPORTED_LANGUAGES = ["en", "fr", "es"];
const FALLBACK_LANGUAGE = "en";

// Declare the rendered language on <html> (see documentLang.js). Registered
// before init so it also catches the language picked at startup.
i18n.on("languageChanged", (lng) => {
  syncDocumentLang(
    typeof document === "undefined" ? null : document,
    i18n.resolvedLanguage || lng,
    SUPPORTED_LANGUAGES,
    FALLBACK_LANGUAGE
  );
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      es: { translation: es },
    },
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    load: "languageOnly",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "i18nextLng",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
