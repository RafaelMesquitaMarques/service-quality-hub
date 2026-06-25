import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import fr from './fr.json'
import en from './en.json'

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false }
})

// Garder <html lang> aligné sur la langue de l'app : aide le navigateur à ne pas
// proposer de traduire (la traduction auto casse le rendu React -> écran blanc).
const applyHtmlLang = (lng) => {
  if (typeof document !== 'undefined' && lng) document.documentElement.lang = lng
}
applyHtmlLang(i18n.language)
i18n.on('languageChanged', applyHtmlLang)

export default i18n
