export function registerSW(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registrato con successo:', registration.scope);
        })
        .catch((error) => {
          console.error('Registrazione Service Worker fallita:', error);
        });
    });
  }
}