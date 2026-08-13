'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Locale = 'en' | 'lt';

const LOCALE_STORAGE_KEY = 'omnia_locale';

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Navigation
    'nav.dashboard': 'PACS',
    'nav.patients': 'Patients',
    'nav.reports': 'Reports',
    'nav.followup': 'Follow-up',
    'nav.analytics': 'Analytics',
    'nav.team': 'Team',
    'nav.archive': 'Archive',
    'nav.labs': 'Labs',
    'nav.comms': 'Comms',
    'nav.settings': 'Settings',
    'nav.compare': 'Compare',
    'nav.signout': 'Sign Out',

    // Dashboard
    'dashboard.title': 'Clinical Dashboard',
    'dashboard.search': 'Search patients...',
    'dashboard.new_patient': 'New Patient',
    'dashboard.no_patients': 'No patients yet',
    'dashboard.filter_all': 'All',
    'dashboard.filter_stat': 'STAT',
    'dashboard.filter_ct': 'CT',
    'dashboard.filter_mri': 'MRI',

    // PACS Viewer
    'pacs.upload_study': 'Upload Study',
    'pacs.upload_batch': 'Upload Batch (ZIP)',
    'pacs.window_level': 'Window / Level',
    'pacs.analyzing': 'Analyzing',
    'pacs.analysis_complete': 'Analysis complete',
    'pacs.analysis_failed': 'Analysis failed',
    'pacs.upload': 'Upload',
    'pacs.analyze': 'Analyze',

    // User
    'user.login': 'Login',
    'user.register': 'Register',
    'user.email': 'Email',
    'user.password': 'Password',
    'user.name': 'Name',
    'user.role': 'Role',
    'user.clinic': 'Clinic',
    'user.logout': 'Sign Out',

    // Common
    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.confirm': 'Confirm',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.done': 'Done',

    // Errors
    'error.connection_failed': 'Connection failed',
    'error.timeout': 'Request timed out',
    'error.unknown': 'An unknown error occurred',
    'error.analysis_failed': 'Analysis failed',

    // Bottom bar
    'bar.version': 'Omnia Clinical',
    'bar.backend': 'Backend',
    'bar.model': 'Model',
    'bar.aria': 'Aria Neural',
    'bar.debug': 'Debug',

    // Settings
    'settings.theme': 'Theme',
    'settings.language': 'Language',
    'settings.clear_data': 'Clear All Data',
    'settings.danger_zone': 'Danger Zone',

    // Page titles
    'page.dashboard': 'Clinical Dashboard',
    'page.reports': 'Aria Radiology Reports',
    'page.patients': 'Patient Management',
    'page.followup': 'Follow-up Schedule',
    'page.analytics': 'Analytics Dashboard',
    'page.labs': 'Labs',
    'page.settings': 'Settings',

    // Actions
    'action.add_patient': 'Add Patient',
    'action.new_patient': 'New Patient',
    'action.upload': 'Upload',
    'action.analyze': 'Analyze',
    'action.generate_report': 'Generate Aria Report',
    'action.retry': 'Retry',
  },

  lt: {
    // Navigation
    'nav.dashboard': 'Darbalaukis',
    'nav.patients': 'Pacientai',
    'nav.reports': 'Ataskaitos',
    'nav.followup': 'Stebėsena',
    'nav.analytics': 'Analitika',
    'nav.team': 'Komanda',
    'nav.archive': 'Archyvas',
    'nav.labs': 'Laboratorija',
    'nav.comms': 'Prisijungimai',
    'nav.settings': 'Nustatymai',
    'nav.compare': 'Palyginti',
    'nav.signout': 'Atsijungti',

    // Dashboard
    'dashboard.title': 'Klinikinė darbalaukis',
    'dashboard.search': 'Ieškoti pacientų...',
    'dashboard.new_patient': 'Naujas pacientas',
    'dashboard.no_pacientų': 'Kol kas nėra pacientų',
    'dashboard.filter_all': 'Visi',
    'dashboard.filter_stat': 'SKUBU',
    'dashboard.filter_ct': 'KT',
    'dashboard.filter_mri': 'MRT',

    // PACS Viewer
    'pacs.upload_study': 'Įkelti tyrimą',
    'pacs.upload_batch': 'Įkelti paketą (ZIP)',
    'pacs.window_level': 'Langas / Lygis',
    'pacs.analyzing': 'Analizuojama',
    'pacs.analysis_complete': 'Analizė baigta',
    'pacs.analysis_failed': 'Analizė nepavyko',
    'pacs.upload': 'Įkelti',
    'pacs.analyze': 'Analizuoti',

    // User
    'user.login': 'Prisijungti',
    'user.register': 'Registruotis',
    'user.email': 'El. paštas',
    'user.password': 'Slaptažodis',
    'user.name': 'Vardas Pavardė',
    'user.role': 'Rolė',
    'user.clinic': 'Klinika',
    'user.logout': 'Atsijungti',

    // Common
    'common.loading': 'Kraunama...',
    'common.save': 'Išsaugoti',
    'common.cancel': 'Atšaukti',
    'common.delete': 'Ištrinti',
    'common.confirm': 'Patvirtinti',
    'common.back': 'Atgal',
    'common.next': 'Toliau',
    'common.done': 'Atlikta',

    // Errors
    'error.connection_failed': 'Prisijungimas nepavyko',
    'error.timeout': 'Užklausos laikas baigėsi',
    'error.unknown': 'Įvyko nežinoma klaida',
    'error.analysis_failed': 'Analizė nepavyko',

    // Bottom bar
    'bar.version': 'Omnia Clinical',
    'bar.backend': 'Serveris',
    'bar.model': 'Modelis',
    'bar.aria': 'Aria Neural',
    'bar.debug': 'Derinimas',

    // Settings
    'settings.theme': 'Tema',
    'settings.language': 'Kalba',
    'settings.clear_data': 'Išvalyti visus duomenis',
    'settings.danger_zone': 'Pavojaus zona',

    // Page titles
    'page.dashboard': 'Klinikinė darbalaukis',
    'page.reports': 'Aria radiologijos ataskaitos',
    'page.patients': 'Pacientų valdymas',
    'page.followup': 'Stebėsenos grafikas',
    'page.analytics': 'Analitikos darbalaukis',
    'page.labs': 'Laboratorija',
    'page.settings': 'Nustatymai',

    // Actions
    'action.add_patient': 'Pridėti pacientą',
    'action.new_patient': 'Naujas pacientas',
    'action.upload': 'Įkelti',
    'action.analyze': 'Analizuoti',
    'action.generate_report': 'Generuoti Aria ataskaitą',
    'action.retry': 'Bandyti dar kartą',
  },
};

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'en',
  setLocale: () => {},
  t: (key: string) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY) as Locale | null;
    if (saved === 'en' || saved === 'lt') {
      setLocaleState(saved);
    } else {
      // Detect browser language
      const browserLang = navigator.language?.startsWith('lt') ? 'lt' : 'en';
      setLocaleState(browserLang);
    }
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(LOCALE_STORAGE_KEY, l);
    // Dispatch event so other components can react
    window.dispatchEvent(new CustomEvent('localechange', { detail: l }));
  };

  const t = (key: string): string => {
    return translations[locale]?.[key] || translations['en']?.[key] || key;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
