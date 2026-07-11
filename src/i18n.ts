export async function initI18n(lang: string): Promise<void> {
  try {
    const response = await fetch(`/locales/${lang}.json`);
    const translations = await response.json();

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      if (key && translations[key]) {
        element.textContent = translations[key];
      }
    });
  } catch (error) {
    console.error('Errore nel caricamento delle traduzioni:', error);
  }
}