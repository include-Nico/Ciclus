// Variabili Globali Mappa
let map, marker;
let watchId = null;
let wakeLock = null;
let isTracking = false;

// Variabili metriche
let maxSpeed = 0;
let totalDistance = 0; 
let lastPosition = null;

// Variabili Timer
let startTime;
let timerInterval;

// --- 1. Inizializzazione Mappa (Leaflet Open-Source) ---
function initMap() {
    // Coordinate iniziali di default (Milano)
    const defaultPos = [45.4642, 9.1900];

    // Crea l'oggetto mappa e rimuove i tasti + e - di default per pulizia estetica
    map = L.map('map', {
        zoomControl: false
    }).setView(defaultPos, 16);

    // Carica il layer cartografico Dark Matter di CartoDB (Grintoso e scuro)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);

    // Genera il marker personalizzato tramite una classe CSS
    const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: '<div class="gps-dot"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    marker = L.marker(defaultPos, { icon: customIcon }).addTo(map);
}

// Avvia l'inizializzazione appena il DOM è pronto
document.addEventListener('DOMContentLoaded', initMap);

// --- 2. Gestione Geolocation e Logica di Tracciamento ---
const startBtn = document.getElementById('startBtn');

startBtn.addEventListener('click', () => {
    if (!isTracking) {
        startTracking();
    } else {
        stopTracking();
    }
});

function startTracking() {
    if (!navigator.geolocation) {
        alert("Il tuo dispositivo non supporta la geolocalizzazione GPS.");
        return;
    }

    // Richiede l'attivazione del blocco spegnimento schermo
    requestWakeLock();

    // Avvio Cronometro
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);

    const options = {
        enableHighAccuracy: true, // Forza l'uso del GPS hardware rispetto al Wi-Fi
        maximumAge: 0,
        timeout: 5000
    };

    watchId = navigator.geolocation.watchPosition(successPosition, errorPosition, options);
    
    isTracking = true;
    startBtn.innerText = "TERMINA CORSA";
    startBtn.style.background = "rgba(231, 76, 60, 0.4)";
    startBtn.style.borderColor = "rgba(231, 76, 60, 0.6)";
}

function stopTracking() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
    clearInterval(timerInterval);
    releaseWakeLock();
    
    isTracking = false;
    startBtn.innerText = "INIZIA CORSA";
    startBtn.style.background = "rgba(255, 255, 255, 0.08)";
    startBtn.style.borderColor = "rgba(255, 255, 255, 0.15)";
    lastPosition = null; 
}

function successPosition(position) {
    const coords = position.coords;
    const currentLatLng = [coords.latitude, coords.longitude];
    
    // Aggiorna posizione mappa e sposta il marker in modo fluido
    map.panTo(currentLatLng);
    marker.setLatLng(currentLatLng);

    // Gestione Velocità (m/s -> km/h)
    let speedKmh = coords.speed ? (coords.speed * 3.6) : 0;
    
    // Filtro per prevenire sfarfallio del GPS da fermi
    if (speedKmh < 1.0) speedKmh = 0; 

    document.getElementById('currentSpeed').innerText = speedKmh.toFixed(1);
    
    if (speedKmh > maxSpeed) {
        maxSpeed = speedKmh;
        document.getElementById('maxSpeed').innerText = maxSpeed.toFixed(1);
    }

    // Mostra la precisione del segnale satellitare
    document.getElementById('accuracy').innerText = coords.accuracy.toFixed(0);

    // Calcolo della distanza progressiva
    if (lastPosition) {
        const dist = calculateHaversine(
            lastPosition.latitude, lastPosition.longitude,
            coords.latitude, coords.longitude
        );
        totalDistance += dist;
        document.getElementById('distance').innerText = totalDistance.toFixed(2);
    }
    lastPosition = coords;
}

function errorPosition(err) {
    console.warn(`Errore GPS (${err.code}): ${err.message}`);
}

// --- 3. Formula di Haversine (Calcolo Distanza Geometrica) ---
function calculateHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// --- 4. Gestione Timer di Sessione ---
function updateTimer() {
    const diff = Date.now() - startTime;
    const date = new Date(diff);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    document.getElementById('timer').innerText = `${hh}:${mm}:${ss}`;
}

// --- 5. WakeLock API (Schermo Sempre Attivo) ---
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn(`WakeLock non disponibile: ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => { wakeLock = null; });
    }
}