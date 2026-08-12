'use client'

import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import academyEnglish from '../locales/academy-en.json'
import { loadDateLocale } from './format'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { common: academyEnglish } },
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'cookie', 'querystring', 'navigator'],
      caches: ['localStorage', 'cookie'],
      lookupLocalStorage: 'i18nextLng',
      lookupCookie: 'i18next',
    },
    react: { useSuspense: false },
  })

export const initialLocaleReady = loadDateLocale(i18n.language).then(() => undefined)

export async function changeLanguage(lng: string) {
  await loadDateLocale(lng)
  return i18n.changeLanguage(lng)
}

export default i18n
