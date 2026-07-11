import './style.css';
import { initI18n } from './i18n';
import { initPlayer } from './player';
import { registerSW } from './sw-register';

document.addEventListener('DOMContentLoaded', () => {
  // Inizializza lingua (es. 'it' o 'en')
  initI18n('it'); 
  
  // Avvia la logica del player musicale
  initPlayer();
  
  // Registra il Service Worker per l'uso offline
  registerSW();
});