let map, marker;
let watchId = null;
let wakeLock = null;
let isTracking = false;

let maxSpeed = 0;
let totalDistance = 0; 
let lastPosition = null;

let startTime;
let timerInterval;

// Riferimenti agli elementi SVG del tachimetro
const speedGaugeProgress = document.getElementById('speedProgress');
const speedNeedle = document.getElementById('speedNeedle');
const DIAL_MAX_SPEED = 60; // Il tachimetro segna fino a 60 km/h prima di fermarsi a fondo scala

function initMap() {
    const defaultPos = [45.4642, 9.1900];

    map = L.map('map', { zoomControl: false }).setView(defaultPos, 16);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);

    const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: '<div class="gps-dot"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    marker = L.marker(defaultPos, { icon: customIcon }).addTo(map);
}

document.addEventListener('DOMContentLoaded', initMap);

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
        alert("Il tuo dispositivo non supporta il GPS.");
        return;
    }

    requestWakeLock();
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);

    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 };
    watchId = navigator.geolocation.watchPosition(successPosition, errorPosition, options);
    
    isTracking = true;
    startBtn.innerText = "TERMINA CORSA";
    startBtn.style.background = "rgba(231, 76, 60, 0.3)";
    startBtn.style.borderColor = "rgba(231, 76, 60, 0.5)";
}

function stopTracking() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    clearInterval(timerInterval);
    releaseWakeLock();
    
    isTracking = false;
    startBtn.innerText = "INIZIA CORSA";
    startBtn.style.background = "rgba(255, 255, 255, 0.08)";
    startBtn.style.borderColor = "rgba(255, 255, 255, 0.15)";
    lastPosition = null; 
    
    // Riporta il tachimetro a 0 in modo fluido quando ti fermi
    updateAnalogDial(0);
    document.getElementById('currentSpeed').innerText = "0.0";
}

function successPosition(position) {
    const coords = position.coords;
    const currentLatLng = [coords.latitude, coords.longitude];
    
    map.panTo(currentLatLng);
    marker.setLatLng(currentLatLng);

    let speedKmh = coords.speed ? (coords.speed * 3.6) : 0;
    if (speedKmh < 1.0) speedKmh = 0; 

    // Aggiorna Numero Digitale Centrale
    document.getElementById('currentSpeed').innerText = speedKmh.toFixed(1);
    
    // --- NUOVO: Aggiorna Quadrante Analogico ---
    updateAnalogDial(speedKmh);

    if (speedKmh > maxSpeed) {
        maxSpeed = speedKmh;
        document.getElementById('maxSpeed').innerText = maxSpeed.toFixed(1);
    }

    document.getElementById('accuracy').innerText = coords.accuracy.toFixed(0);

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

// Funzione dedicata all'aggiornamento grafico del tachimetro
function updateAnalogDial(speedKmh) {
    // Limitiamo la velocità visualizzata sul quadrante al massimo (60)
    let displaySpeed = Math.min(speedKmh, DIAL_MAX_SPEED);
    
    // Calcoliamo la percentuale di riempimento del quadrante (da 0.0 a 1.0)
    let speedPercentage = displaySpeed / DIAL_MAX_SPEED;

    // 1. Aggiorna la barra circolare azzurra
    // stroke-dasharray totale è 330. Iniziamo con un offset di 330 (vuoto) e andiamo a 0 (pieno).
    let dashOffset = 330 - (330 * speedPercentage);
    speedGaugeProgress.style.strokeDashoffset = dashOffset;

    // 2. Aggiorna la rotazione della lancetta rossa
    // La lancetta parte da -135 gradi (min) e arriva a +135 gradi (max). Escursione totale: 270 gradi.
    let needleRotation = -135 + (270 * speedPercentage);
    speedNeedle.style.transform = `rotate(${needleRotation}deg)`;
}

function errorPosition(err) {
    console.warn(`Errore GPS (${err.code}): ${err.message}`);
}

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

function updateTimer() {
    const diff = Date.now() - startTime;
    const date = new Date(diff);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    document.getElementById('timer').innerText = `${hh}:${mm}:${ss}`;
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
        console.warn(`WakeLock non disponibile: ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
}