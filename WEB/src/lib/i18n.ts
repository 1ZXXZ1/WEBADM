import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ru from '../locales/ru.json';
import en from '../locales/en.json';

const savedLang = typeof window !== 'undefined' ? localStorage.getItem('samba-lang') || 'ru' : 'ru';

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'ru',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
