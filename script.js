'use strict';

/* ==========================================================================
   CICLUS — logica applicazione
   Organizzata attorno a un unico oggetto `state` per evitare variabili
   globali sparse, e a piccole funzioni pure dove possibile (calcoli di
   geometria, conversioni unità) separate dagli effetti collaterali (DOM).
   ========================================================================== */

const DIAL_MAX_SPEED = 60;      // km/h — fondo scala del quadrante
const DIAL_START_ANGLE = -135;  // gradi, 0° = verso l'alto, orario positivo
const DIAL_SWEEP = 270;         // gradi totali percorsi dal quadrante
const GAUGE_RADIUS = 100;       // deve combaciare con il raggio nell'SVG
const MIN_ACCURACY_FOR_DISTANCE = 30; // metri: oltre, il fix è troppo rumoroso
const MIN_SPEED_THRESHOLD = 0.8;      // km/h sotto cui consideriamo il ciclista fermo

const state = {
    tracking: false,
    paused: false,
    unit: localStorage.getItem('ciclus_unit') || 'km', // 'km' | 'mi'

    maxSpeed: 0,
    totalDistance: 0,       // km, sempre in km internamente; convertito solo in UI
    movingTime: 0,          // secondi effettivi di movimento/registrazione (esclude pausa)

    lastPosition: null,     // { latitude, longitude, timestamp }
    lastAcceptedSpeed: 0,

    startTime: null,
    pauseStartedAt: null,
    timerInterval: null,

    watchId: null,
    wakeLock: null,

    map: null,
    marker: null,
    headingEl: null,
};

/* ==========================================================================
   Riferimenti DOM
   ========================================================================== */
const el = {
    speedGaugeSvg: document.getElementById('speedGaugeSvg'),
    tickLayer: document.getElementById('tickLayer'),
    gaugeTrack: document.getElementById('gaugeTrack'),
    speedProgress: document.getElementById('speedProgress'),
    speedNeedle: document.getElementById('speedNeedle'),
    currentSpeed: document.getElementById('currentSpeed'),
    speedUnitLabel: document.getElementById('speedUnitLabel'),
    recIndicator: document.getElementById('recIndicator'),

    distance: document.getElementById('distance'),
    distUnitLabel: document.getElementById('distUnitLabel'),
    timer: document.getElementById('timer'),
    avgSpeed: document.getElementById('avgSpeed'),
    avgUnitLabel: document.getElementById('avgUnitLabel'),
    maxSpeed: document.getElementById('maxSpeed'),
    maxUnitLabel: document.getElementById('maxUnitLabel'),
    accuracy: document.getElementById('accuracy'),
    altitude: document.getElementById('altitude'),

    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    stopBtn: document.getElementById('stopBtn'),

    gpsDot: document.getElementById('gpsDot'),
    gpsText: document.getElementById('gpsText'),

    historyBtn: document.getElementById('historyBtn'),
    closeHistoryBtn: document.getElementById('closeHistoryBtn'),
    historyPanel: document.getElementById('historyPanel'),
    historyList: document.getElementById('historyList'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),

    settingsBtn: document.getElementById('settingsBtn'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    unitToggle: document.getElementById('unitToggle'),

    scrim: document.getElementById('scrim'),

    summaryModal: document.getElementById('summaryModal'),
    sumDistance: document.getElementById('sumDistance'),
    sumTime: document.getElementById('sumTime'),
    sumAvg: document.getElementById('sumAvg'),
    sumMax: document.getElementById('sumMax'),
    discardRideBtn: document.getElementById('discardRideBtn'),
    saveRideBtn: document.getElementById('saveRideBtn'),
};

let pendingRide = null; // dati dell'ultima corsa in attesa di salvataggio/scarto

/* ==========================================================================
   Avvio
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // L'inizializzazione della mappa dipende da una libreria esterna (CDN):
    // se non si carica (rete assente/bloccata) l'app deve restare comunque
    // utilizzabile per tachimetro, statistiche e cronologia.
    try {
        initMap();
    } catch (err) {
        console.warn('Mappa non disponibile:', err.message);
        setGpsStatus('poor', 'Mappa non disponibile');
    }
    buildGaugeTrackAndTicks();
    applyUnitToUI();
    bindEvents();
    renderHistory();
});

/* ==========================================================================
   Mappa (Leaflet)
   ========================================================================== */
function initMap() {
    const defaultPos = [45.4642, 9.1900]; // Milano, come fallback iniziale

    state.map = L.map('map', { zoomControl: false, attributionControl: true })
        .setView(defaultPos, 16);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(state.map);

    const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: '<div class="gps-dot-wrapper"><div class="gps-heading-cone" style="opacity:0"></div><div class="gps-dot"></div></div>',
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });

    state.marker = L.marker(defaultPos, { icon: customIcon }).addTo(state.map);
}

function updateMarkerHeading(headingDeg) {
    const wrapper = state.marker?.getElement()?.querySelector('.gps-dot-wrapper');
    const cone = state.marker?.getElement()?.querySelector('.gps-heading-cone');
    if (!wrapper || !cone) return;
    if (headingDeg === null || Number.isNaN(headingDeg)) {
        cone.style.opacity = '0';
        return;
    }
    cone.style.opacity = '1';
    wrapper.style.transform = `rotate(${headingDeg}deg)`;
}

/* ==========================================================================
   Quadrante — costruito a runtime così i tick, l'arco e la lancetta
   condividono sempre la stessa geometria (nessun numero duplicato a mano).
   ========================================================================== */
function polarPoint(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function buildGaugeTrackAndTicks() {
    const cx = 120, cy = 120;
    const circumference = 2 * Math.PI * GAUGE_RADIUS;
    const arcLength = circumference * (DIAL_SWEEP / 360);
    const dashArray = `${arcLength.toFixed(2)} ${circumference.toFixed(2)}`;

    [el.gaugeTrack, el.speedProgress].forEach(circle => {
        circle.setAttribute('stroke-dasharray', dashArray);
        circle.setAttribute('transform', `rotate(135 ${cx} ${cy})`);
    });
    el.speedProgress.style.strokeDashoffset = arcLength;
    el.speedProgress.dataset.arcLength = arcLength;

    const svgNS = 'http://www.w3.org/2000/svg';
    const majorStep = 10;
    const minorStep = 5;

    for (let v = 0; v <= DIAL_MAX_SPEED; v += minorStep) {
        const angle = DIAL_START_ANGLE + DIAL_SWEEP * (v / DIAL_MAX_SPEED);
        const isMajor = v % majorStep === 0;

        const outer = polarPoint(cx, cy, 88, angle);
        const inner = polarPoint(cx, cy, isMajor ? 78 : 82, angle);

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', outer.x.toFixed(2));
        line.setAttribute('y1', outer.y.toFixed(2));
        line.setAttribute('x2', inner.x.toFixed(2));
        line.setAttribute('y2', inner.y.toFixed(2));
        line.setAttribute('class', isMajor ? 'tick-major' : 'tick-minor');
        el.tickLayer.appendChild(line);

        if (isMajor) {
            const labelPos = polarPoint(cx, cy, 64, angle);
            const text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', labelPos.x.toFixed(2));
            text.setAttribute('y', labelPos.y.toFixed(2));
            text.setAttribute('class', 'tick-label');
            text.textContent = v;
            el.tickLayer.appendChild(text);
        }
    }
}

function updateGaugeVisual(speedKmh) {
    const displaySpeed = Math.min(speedKmh, DIAL_MAX_SPEED);
    const percentage = displaySpeed / DIAL_MAX_SPEED;
    const arcLength = parseFloat(el.speedProgress.dataset.arcLength);

    el.speedProgress.style.strokeDashoffset = arcLength - arcLength * percentage;
    el.speedNeedle.style.transform = `rotate(${DIAL_START_ANGLE + DIAL_SWEEP * percentage}deg)`;

    // La barra vira verso l'ambra oltre l'80% del fondo scala, per un colpo
    // d'occhio in più senza dover leggere il numero.
    el.speedProgress.style.stroke = percentage > 0.8 ? 'var(--warn)' : 'var(--accent)';
}

/* ==========================================================================
   Unità di misura
   ========================================================================== */
function kmToDisplayDistance(km) {
    return state.unit === 'km' ? km : km * 0.621371;
}

function kmhToDisplaySpeed(kmh) {
    return state.unit === 'km' ? kmh : kmh * 0.621371;
}

function applyUnitToUI() {
    const speedUnit = state.unit === 'km' ? 'km/h' : 'mph';
    const distUnit = state.unit === 'km' ? 'km' : 'mi';

    el.speedUnitLabel.textContent = speedUnit;
    el.avgUnitLabel.textContent = speedUnit;
    el.maxUnitLabel.textContent = speedUnit;
    el.distUnitLabel.textContent = distUnit;

    document.querySelectorAll('.segmented-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.unit === state.unit);
    });

    refreshStatDisplays();
}

function refreshStatDisplays() {
    el.distance.textContent = kmToDisplayDistance(state.totalDistance).toFixed(2);
    el.maxSpeed.textContent = kmhToDisplaySpeed(state.maxSpeed).toFixed(1);
    el.avgSpeed.textContent = kmhToDisplaySpeed(computeAverageSpeed()).toFixed(1);
}

function computeAverageSpeed() {
    if (state.movingTime <= 0) return 0;
    return state.totalDistance / (state.movingTime / 3600);
}

/* ==========================================================================
   Tracking GPS
   ========================================================================== */
function startTracking() {
    if (!navigator.geolocation) {
        setGpsStatus('poor', 'GPS non supportato');
        return;
    }

    resetRideStats();
    requestWakeLock();

    state.startTime = Date.now();
    state.timerInterval = setInterval(updateTimer, 1000);

    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 };
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, options);

    state.tracking = true;
    state.paused = false;
    setGpsStatus('live', 'Acquisizione…');
    el.recIndicator.classList.add('active');
    setControlsMode('tracking');
}

function pauseTracking() {
    state.paused = true;
    state.pauseStartedAt = Date.now();
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    setGpsStatus('weak', 'In pausa');
    setControlsMode('paused');
}

function resumeTracking() {
    state.paused = false;
    state.lastPosition = null; // evita di calcolare distanza sul salto durante la pausa
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 };
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, options);
    setGpsStatus('live', 'Acquisizione…');
    setControlsMode('tracking');
}

function stopTracking() {
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    clearInterval(state.timerInterval);
    releaseWakeLock();

    state.tracking = false;
    state.paused = false;
    state.lastPosition = null;
    el.recIndicator.classList.remove('active');
    setGpsStatus('idle', 'GPS in attesa');
    setControlsMode('idle');

    updateGaugeVisual(0);
    el.currentSpeed.textContent = '0.0';

    openRideSummary();
}

function resetRideStats() {
    state.maxSpeed = 0;
    state.totalDistance = 0;
    state.movingTime = 0;
    state.lastPosition = null;
    state.lastAcceptedSpeed = 0;
    refreshStatDisplays();
    el.timer.textContent = '00:00:00';
}

function onPosition(position) {
    const coords = position.coords;
    const currentLatLng = [coords.latitude, coords.longitude];

    if (state.map && state.marker) {
        state.map.panTo(currentLatLng, { animate: true, duration: 0.5 });
        state.marker.setLatLng(currentLatLng);
        updateMarkerHeading(typeof coords.heading === 'number' ? coords.heading : null);
    }

    updateGpsQuality(coords.accuracy);
    el.accuracy.textContent = coords.accuracy.toFixed(0);
    el.altitude.textContent = typeof coords.altitude === 'number' ? coords.altitude.toFixed(0) : '--';

    // Velocità: preferiamo quella fornita dal GPS; se assente (comune su
    // desktop o alcuni Android), la deriviamo dallo spostamento tra due fix.
    let speedKmh = typeof coords.speed === 'number' && coords.speed !== null
        ? coords.speed * 3.6
        : deriveSpeedFromFixes(coords, position.timestamp);

    if (speedKmh < MIN_SPEED_THRESHOLD) speedKmh = 0;
    state.lastAcceptedSpeed = speedKmh;

    el.currentSpeed.textContent = kmhToDisplaySpeed(speedKmh).toFixed(1);
    updateGaugeVisual(speedKmh);

    if (speedKmh > state.maxSpeed) {
        state.maxSpeed = speedKmh;
        el.maxSpeed.textContent = kmhToDisplaySpeed(state.maxSpeed).toFixed(1);
    }

    // Un fix troppo impreciso gonfia la distanza con rumore: lo usiamo per
    // orientare la mappa ma non per accumulare km.
    if (state.lastPosition && coords.accuracy <= MIN_ACCURACY_FOR_DISTANCE) {
        const dist = haversineDistanceKm(
            state.lastPosition.latitude, state.lastPosition.longitude,
            coords.latitude, coords.longitude
        );
        // Scarta anche micro-spostamenti dovuti al solo jitter del GPS da fermo.
        if (dist > 0.001) {
            state.totalDistance += dist;
            el.distance.textContent = kmToDisplayDistance(state.totalDistance).toFixed(2);
        }
    }

    if (coords.accuracy <= MIN_ACCURACY_FOR_DISTANCE) {
        state.lastPosition = { latitude: coords.latitude, longitude: coords.longitude, timestamp: position.timestamp };
    }

    el.avgSpeed.textContent = kmhToDisplaySpeed(computeAverageSpeed()).toFixed(1);
}

function deriveSpeedFromFixes(coords, timestamp) {
    if (!state.lastPosition) return 0;
    const dtHours = (timestamp - state.lastPosition.timestamp) / 3_600_000;
    if (dtHours <= 0) return state.lastAcceptedSpeed;
    const distKm = haversineDistanceKm(
        state.lastPosition.latitude, state.lastPosition.longitude,
        coords.latitude, coords.longitude
    );
    return distKm / dtHours;
}

function onPositionError(err) {
    console.warn(`Errore GPS (${err.code}): ${err.message}`);
    if (err.code === err.PERMISSION_DENIED) {
        setGpsStatus('poor', 'Permesso GPS negato');
        stopTracking();
    } else {
        setGpsStatus('weak', 'Segnale debole');
    }
}

function updateGpsQuality(accuracy) {
    if (accuracy <= 15) setGpsStatus('live', 'Segnale ottimo');
    else if (accuracy <= 35) setGpsStatus('weak', 'Segnale discreto');
    else setGpsStatus('poor', 'Segnale debole');
}

function setGpsStatus(level, text) {
    el.gpsDot.classList.remove('live', 'weak', 'poor');
    if (level !== 'idle') el.gpsDot.classList.add(level);
    el.gpsText.textContent = text;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/* ==========================================================================
   Timer (esclude il tempo trascorso in pausa)
   ========================================================================== */
function updateTimer() {
    if (state.paused) return;
    const elapsedMs = Date.now() - state.startTime;
    state.movingTime = elapsedMs / 1000;
    el.timer.textContent = formatDuration(elapsedMs);
    el.avgSpeed.textContent = kmhToDisplaySpeed(computeAverageSpeed()).toFixed(1);
}

function formatDuration(ms) {
    const date = new Date(ms);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

/* ==========================================================================
   Controlli — Inizia / Pausa / Termina
   ========================================================================== */
function setControlsMode(mode) {
    if (mode === 'idle') {
        el.startBtn.classList.remove('hidden');
        el.pauseBtn.classList.add('hidden');
        el.stopBtn.classList.add('hidden');
        el.startBtn.textContent = 'Inizia corsa';
    } else if (mode === 'tracking') {
        el.startBtn.classList.add('hidden');
        el.pauseBtn.classList.remove('hidden');
        el.stopBtn.classList.remove('hidden');
        el.pauseBtn.textContent = 'Pausa';
    } else if (mode === 'paused') {
        el.startBtn.classList.add('hidden');
        el.pauseBtn.classList.remove('hidden');
        el.stopBtn.classList.remove('hidden');
        el.pauseBtn.textContent = 'Riprendi';
    }
}

/* ==========================================================================
   Riepilogo e cronologia corse (localStorage)
   ========================================================================== */
const HISTORY_KEY = 'ciclus_rides';

function openRideSummary() {
    pendingRide = {
        date: new Date().toISOString(),
        distanceKm: state.totalDistance,
        movingTimeSec: state.movingTime,
        maxSpeedKmh: state.maxSpeed,
        avgSpeedKmh: computeAverageSpeed(),
    };

    el.sumDistance.textContent = `${kmToDisplayDistance(pendingRide.distanceKm).toFixed(2)} ${state.unit === 'km' ? 'km' : 'mi'}`;
    el.sumTime.textContent = formatDuration(pendingRide.movingTimeSec * 1000);
    el.sumAvg.textContent = `${kmhToDisplaySpeed(pendingRide.avgSpeedKmh).toFixed(1)} ${state.unit === 'km' ? 'km/h' : 'mph'}`;
    el.sumMax.textContent = `${kmhToDisplaySpeed(pendingRide.maxSpeedKmh).toFixed(1)} ${state.unit === 'km' ? 'km/h' : 'mph'}`;

    // Corse troppo brevi non vale la pena proporle per il salvataggio.
    if (pendingRide.distanceKm < 0.05 && pendingRide.movingTimeSec < 30) {
        pendingRide = null;
        return;
    }

    el.summaryModal.classList.add('open');
    el.summaryModal.setAttribute('aria-hidden', 'false');
}

function closeRideSummary() {
    el.summaryModal.classList.remove('open');
    el.summaryModal.setAttribute('aria-hidden', 'true');
    pendingRide = null;
}

function saveRide() {
    if (!pendingRide) return closeRideSummary();
    const rides = loadRides();
    rides.unshift(pendingRide);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rides.slice(0, 100)));
    renderHistory();
    closeRideSummary();
}

function loadRides() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
        return [];
    }
}

function renderHistory() {
    const rides = loadRides();
    if (rides.length === 0) {
        el.historyList.innerHTML = '<p class="empty-state">Nessuna corsa salvata ancora. Le corse completate compariranno qui.</p>';
        return;
    }

    el.historyList.innerHTML = rides.map((ride, index) => {
        const dateLabel = new Date(ride.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const dist = kmToDisplayDistance(ride.distanceKm).toFixed(2);
        const distUnit = state.unit === 'km' ? 'km' : 'mi';
        const time = formatDuration(ride.movingTimeSec * 1000);
        const avg = kmhToDisplaySpeed(ride.avgSpeedKmh).toFixed(1);
        return `
            <div class="history-item">
                <div class="history-item-main">
                    <span class="history-date">${dateLabel}</span>
                    <span class="history-metrics">${dist} ${distUnit}</span>
                    <span class="history-sub">${time} · media ${avg} ${state.unit === 'km' ? 'km/h' : 'mph'}</span>
                </div>
                <button class="history-delete" data-index="${index}" aria-label="Elimina corsa">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7h12Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
            </div>`;
    }).join('');

    el.historyList.querySelectorAll('.history-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const rides = loadRides();
            rides.splice(Number(btn.dataset.index), 1);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(rides));
            renderHistory();
        });
    });
}

/* ==========================================================================
   Pannelli (sheet) e modali
   ========================================================================== */
function openSheet(panel) {
    el.scrim.classList.add('visible');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
}

function closeSheet(panel) {
    el.scrim.classList.remove('visible');
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
}

/* ==========================================================================
   Wake Lock — evita che lo schermo si spenga durante la corsa
   ========================================================================== */
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            state.wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn(`WakeLock non disponibile: ${err.message}`);
    }
}

function releaseWakeLock() {
    if (state.wakeLock) {
        state.wakeLock.release().then(() => { state.wakeLock = null; });
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.tracking && !state.paused && !state.wakeLock) {
        requestWakeLock();
    }
});

/* ==========================================================================
   Collegamento eventi
   ========================================================================== */
function bindEvents() {
    el.startBtn.addEventListener('click', startTracking);

    el.pauseBtn.addEventListener('click', () => {
        if (state.paused) resumeTracking();
        else pauseTracking();
    });

    el.stopBtn.addEventListener('click', stopTracking);

    el.historyBtn.addEventListener('click', () => { renderHistory(); openSheet(el.historyPanel); });
    el.closeHistoryBtn.addEventListener('click', () => closeSheet(el.historyPanel));
    el.clearHistoryBtn.addEventListener('click', () => {
        localStorage.removeItem(HISTORY_KEY);
        renderHistory();
    });

    el.settingsBtn.addEventListener('click', () => openSheet(el.settingsPanel));
    el.closeSettingsBtn.addEventListener('click', () => closeSheet(el.settingsPanel));

    el.unitToggle.querySelectorAll('.segmented-option').forEach(btn => {
        btn.addEventListener('click', () => {
            state.unit = btn.dataset.unit;
            localStorage.setItem('ciclus_unit', state.unit);
            applyUnitToUI();
        });
    });

    el.scrim.addEventListener('click', () => {
        closeSheet(el.historyPanel);
        closeSheet(el.settingsPanel);
    });

    el.discardRideBtn.addEventListener('click', closeRideSummary);
    el.saveRideBtn.addEventListener('click', saveRide);
}