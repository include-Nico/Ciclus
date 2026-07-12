'use strict';

/* ==========================================================================
   CICLUS — logica applicazione
   ========================================================================== */
const DIAL_MAX_SPEED = 60;      
const DIAL_START_ANGLE = -135;  
const DIAL_SWEEP = 270;         
const GAUGE_RADIUS = 100;       
const MIN_ACCURACY_FOR_DISTANCE = 30; 
const MIN_SPEED_THRESHOLD = 0.8;      
const TAPPA_PROXIMITY_RADIUS = 0.03; // 30 metri per triggerare il passaggio

const state = {
    tracking: false,
    paused: false,
    unit: localStorage.getItem('ciclus_unit') || 'km',
    mapTheme: localStorage.getItem('ciclus_theme') || 'dark',
    mapRotate: localStorage.getItem('ciclus_rotate') || 'on',
    mapZoom: parseInt(localStorage.getItem('ciclus_zoom')) || 18,
    
    // Struttura Tappa aggiornata: { id, name, emoji, lat, lng, bestTime, history: [{ date, time }] }
    tappe: JSON.parse(localStorage.getItem('ciclus_tappe')) || [],
    tappeRaggiunteCorrenti: [], 

    maxSpeed: 0,
    totalDistance: 0,       
    movingTime: 0,          

    lastPosition: null,     
    lastAcceptedSpeed: 0,
    lastBearing: null,      

    startTime: null,
    pauseStartedAt: null,
    timerInterval: null,
    watchId: null,
    wakeLock: null,

    map: null,
    tileLayer: null,
    marker: null,
};

/* ==========================================================================
   Riferimenti DOM
   ========================================================================== */
const el = {
    mapContainer: document.getElementById('map-container'),
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
    mapThemeToggle: document.getElementById('mapThemeToggle'),
    mapRotateToggle: document.getElementById('mapRotateToggle'),
    mapZoomSlider: document.getElementById('mapZoomSlider'),
    zoomLevelDisplay: document.getElementById('zoomLevelDisplay'),

    tappeBtn: document.getElementById('tappeBtn'),
    closeTappeBtn: document.getElementById('closeTappeBtn'),
    tappePanel: document.getElementById('tappePanel'),
    triggerAddTappaBtn: document.getElementById('triggerAddTappaBtn'),
    tappeList: document.getElementById('tappeList'),

    // Nuovo Modale Tappe
    addTappaModal: document.getElementById('addTappaModal'),
    tappaNameInput: document.getElementById('tappaNameInput'),
    emojiPicker: document.getElementById('emojiPicker'),
    cancelAddTappaBtn: document.getElementById('cancelAddTappaBtn'),
    confirmAddTappaBtn: document.getElementById('confirmAddTappaBtn'),

    scrim: document.getElementById('scrim'),

    summaryModal: document.getElementById('summaryModal'),
    sumDistance: document.getElementById('sumDistance'),
    sumTime: document.getElementById('sumTime'),
    sumAvg: document.getElementById('sumAvg'),
    sumMax: document.getElementById('sumMax'),
    discardRideBtn: document.getElementById('discardRideBtn'),
    saveRideBtn: document.getElementById('saveRideBtn'),
};

let pendingRide = null; 
let selectedEmoji = '📍';

/* ==========================================================================
   Avvio
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    try { initMap(); } catch (err) { console.warn('Mappa non disponibile:', err.message); setGpsStatus('poor', 'Mappa offline'); }
    buildGaugeTrackAndTicks();
    applySettingsToUI();
    bindEvents();
    renderHistory();
    renderTappe();
});

/* ==========================================================================
   Mappa
   ========================================================================== */
function initMap() {
    const defaultPos = [45.5180, 9.1940]; 
    state.map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 22 }).setView(defaultPos, state.mapZoom);
    updateMapThemeLayer();

    const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: '<div class="gps-marker-halo"></div><div class="gps-marker"><div class="gps-triangle"></div></div>',
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });

    state.marker = L.marker(defaultPos, { icon: customIcon }).addTo(state.map);
    renderTappeMarkers();
    setTimeout(() => { if(state.map) state.map.invalidateSize(); }, 200);
}

function updateMapThemeLayer() {
    if (state.tileLayer) state.map.removeLayer(state.tileLayer);
    const activeUrl = state.mapTheme === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    state.tileLayer = L.tileLayer(activeUrl, { maxZoom: 22, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(state.map);
}

function updateMarkerHeading(headingDeg) {
    if (headingDeg === null || Number.isNaN(headingDeg)) return;
    if (state.mapRotate === 'on') {
        el.mapContainer.style.transform = `rotate(${-headingDeg}deg)`;
        const arrow = state.marker?.getElement()?.querySelector('.gps-marker');
        if (arrow) arrow.style.transform = `rotate(0deg)`;
    } else {
        el.mapContainer.style.transform = `rotate(0deg)`;
        const arrow = state.marker?.getElement()?.querySelector('.gps-marker');
        if (arrow) arrow.style.transform = `rotate(${headingDeg}deg)`;
    }
}

function applySettingsToUI() {
    const speedUnit = state.unit === 'km' ? 'km/h' : 'mph';
    const distUnit = state.unit === 'km' ? 'km' : 'mi';
    el.speedUnitLabel.textContent = speedUnit;
    el.avgUnitLabel.textContent = speedUnit;
    el.maxUnitLabel.textContent = speedUnit;
    el.distUnitLabel.textContent = distUnit;
    el.unitToggle.querySelectorAll('.segmented-option').forEach(btn => btn.classList.toggle('active', btn.dataset.unit === state.unit));
    el.mapThemeToggle.querySelectorAll('.segmented-option').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === state.mapTheme));
    el.mapRotateToggle.querySelectorAll('.segmented-option').forEach(btn => btn.classList.toggle('active', btn.dataset.rotate === state.mapRotate));
    if(state.mapRotate === 'off' && state.lastBearing !== null) updateMarkerHeading(state.lastBearing);
    el.mapZoomSlider.value = state.mapZoom;
    el.zoomLevelDisplay.textContent = state.mapZoom;
    if(state.map) state.map.setZoom(state.mapZoom);
    refreshStatDisplays();
}

/* ==========================================================================
   Gestione Tappe, Emojis e Cronologia Tempi
   ========================================================================== */
function openAddTappaModal() {
    if (!state.lastPosition) { alert("Attendi il fix del GPS per salvare una tappa."); return; }
    closeSheet(el.tappePanel); // Chiudi il pannello sottostante per focus
    el.tappaNameInput.value = '';
    
    // Resetta selezione emoji
    el.emojiPicker.querySelectorAll('.emoji-option').forEach(btn => btn.classList.remove('active'));
    el.emojiPicker.querySelector('[data-emoji="📍"]').classList.add('active');
    selectedEmoji = '📍';

    el.addTappaModal.classList.add('open');
    el.addTappaModal.setAttribute('aria-hidden', 'false');
}

function closeAddTappaModal() {
    el.addTappaModal.classList.remove('open');
    el.addTappaModal.setAttribute('aria-hidden', 'true');
}

function confirmAddTappa() {
    const name = el.tappaNameInput.value.trim() || "Tappa " + (state.tappe.length + 1);
    
    const newTappa = {
        id: Date.now(),
        name: name,
        emoji: selectedEmoji,
        lat: state.lastPosition.latitude,
        lng: state.lastPosition.longitude,
        bestTime: null,
        history: [] // Memorizza i vari passaggi: { date, time }
    };

    state.tappe.push(newTappa);
    localStorage.setItem('ciclus_tappe', JSON.stringify(state.tappe));
    
    closeAddTappaModal();
    renderTappe();
    renderTappeMarkers();
    openSheet(el.tappePanel); // Riapre il pannello per farti vedere il salvataggio
}

function renderTappe() {
    if (state.tappe.length === 0) {
        el.tappeList.innerHTML = '<p class="empty-state">Nessuna tappa salvata. Aggiungi tappe per registrare i tempi di passaggio storici.</p>';
        return;
    }

    el.tappeList.innerHTML = state.tappe.map((tappa, index) => {
        const timeLabel = tappa.bestTime ? formatDuration(tappa.bestTime * 1000) : '--:--:--';
        let lastPassLabel = "Mai transitato";
        
        if(tappa.history && tappa.history.length > 0) {
            const lastRec = tappa.history[tappa.history.length - 1];
            const dateStr = new Date(lastRec.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
            lastPassLabel = `Ultimo: ${formatDuration(lastRec.time * 1000)} il ${dateStr}`;
        }

        return `
            <div class="history-item">
                <div class="history-item-main">
                    <span class="history-metrics" style="font-family: var(--font-ui);">${tappa.emoji} ${tappa.name}</span>
                    <span class="history-sub" style="color: var(--accent);">Record Assoluto: ${timeLabel}</span>
                    <span class="history-sub" style="font-size: 0.65rem;">${lastPassLabel}</span>
                </div>
                <button class="history-delete" data-index="${index}" aria-label="Elimina tappa">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7h12Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
            </div>`;
    }).join('');

    el.tappeList.querySelectorAll('.history-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            state.tappe.splice(Number(btn.dataset.index), 1);
            localStorage.setItem('ciclus_tappe', JSON.stringify(state.tappe));
            renderTappe();
            renderTappeMarkers();
        });
    });
}

let tappeLayerGroup = null;
function renderTappeMarkers() {
    if(!state.map) return;
    if(tappeLayerGroup) state.map.removeLayer(tappeLayerGroup);
    tappeLayerGroup = L.layerGroup().addTo(state.map);
    
    state.tappe.forEach(tappa => {
        // Usa il DOM custom per iniettare l'emoji direttamente sulla mappa
        const emojiIcon = L.divIcon({
            html: `<div class="emoji-map-marker">${tappa.emoji || '📍'}</div>`,
            className: 'custom-emoji-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 30] // L'ancora è alla base dell'emoji
        });

        L.marker([tappa.lat, tappa.lng], { icon: emojiIcon })
         .bindPopup(`<b>${tappa.emoji} ${tappa.name}</b><br>Record: ${tappa.bestTime ? formatDuration(tappa.bestTime * 1000) : '--:--'}`)
         .addTo(tappeLayerGroup);
    });
}

function checkTappeProximity(currentLat, currentLng) {
    if (!state.tracking || state.paused || state.movingTime < 10) return;

    state.tappe.forEach(tappa => {
        if (state.tappeRaggiunteCorrenti.includes(tappa.id)) return;

        const distKm = haversineDistanceKm(currentLat, currentLng, tappa.lat, tappa.lng);
        if (distKm <= TAPPA_PROXIMITY_RADIUS) {
            state.tappeRaggiunteCorrenti.push(tappa.id);
            
            // Registra nel log storico
            if(!tappa.history) tappa.history = [];
            tappa.history.push({ date: Date.now(), time: state.movingTime });

            // Calcola il nuovo record assoluto esaminando l'history
            const minTime = Math.min(...tappa.history.map(h => h.time));
            tappa.bestTime = minTime;

            localStorage.setItem('ciclus_tappe', JSON.stringify(state.tappe));
            renderTappe();
            console.log(`Registrato passaggio su ${tappa.name}: ${formatDuration(state.movingTime*1000)}`);
        }
    });
}

/* ==========================================================================
   Tachimetro e Visual Data
   ========================================================================== */
function polarPoint(cx, cy, r, angleDeg) { const rad = (angleDeg * Math.PI) / 180; return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }; }
function buildGaugeTrackAndTicks() {
    const cx = 120, cy = 120, circumference = 2 * Math.PI * GAUGE_RADIUS, arcLength = circumference * (DIAL_SWEEP / 360), dashArray = `${arcLength.toFixed(2)} ${circumference.toFixed(2)}`;
    [el.gaugeTrack, el.speedProgress].forEach(circle => { circle.setAttribute('stroke-dasharray', dashArray); circle.setAttribute('transform', `rotate(135 ${cx} ${cy})`); });
    el.speedProgress.style.strokeDashoffset = arcLength; el.speedProgress.dataset.arcLength = arcLength;
    const svgNS = 'http://www.w3.org/2000/svg';
    for (let v = 0; v <= DIAL_MAX_SPEED; v += 5) {
        const angle = DIAL_START_ANGLE + DIAL_SWEEP * (v / DIAL_MAX_SPEED), isMajor = v % 10 === 0, outer = polarPoint(cx, cy, 88, angle), inner = polarPoint(cx, cy, isMajor ? 78 : 82, angle);
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', outer.x.toFixed(2)); line.setAttribute('y1', outer.y.toFixed(2)); line.setAttribute('x2', inner.x.toFixed(2)); line.setAttribute('y2', inner.y.toFixed(2));
        line.setAttribute('class', isMajor ? 'tick-major' : 'tick-minor'); el.tickLayer.appendChild(line);
        if (isMajor) {
            const labelPos = polarPoint(cx, cy, 64, angle), text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', labelPos.x.toFixed(2)); text.setAttribute('y', labelPos.y.toFixed(2)); text.setAttribute('class', 'tick-label'); text.textContent = v;
            el.tickLayer.appendChild(text);
        }
    }
}

function updateGaugeVisual(speedKmh) {
    const displaySpeed = Math.min(speedKmh, DIAL_MAX_SPEED), percentage = displaySpeed / DIAL_MAX_SPEED, arcLength = parseFloat(el.speedProgress.dataset.arcLength);
    el.speedProgress.style.strokeDashoffset = arcLength - arcLength * percentage;
    el.speedNeedle.style.transform = `rotate(${DIAL_START_ANGLE + DIAL_SWEEP * percentage}deg)`;
    el.speedProgress.style.stroke = percentage > 0.8 ? 'var(--warn)' : 'var(--accent)';
}

function kmToDisplayDistance(km) { return state.unit === 'km' ? km : km * 0.621371; }
function kmhToDisplaySpeed(kmh) { return state.unit === 'km' ? kmh : kmh * 0.621371; }
function refreshStatDisplays() {
    el.distance.textContent = kmToDisplayDistance(state.totalDistance).toFixed(2);
    el.maxSpeed.textContent = kmhToDisplaySpeed(state.maxSpeed).toFixed(1);
    el.avgSpeed.textContent = kmhToDisplaySpeed(computeAverageSpeed()).toFixed(1);
}
function computeAverageSpeed() { if (state.movingTime <= 0) return 0; return state.totalDistance / (state.movingTime / 3600); }

/* ==========================================================================
   Tracking Core
   ========================================================================== */
function startTracking() {
    if (!navigator.geolocation) { setGpsStatus('poor', 'GPS non supportato'); return; }
    resetRideStats(); requestWakeLock(); state.tappeRaggiunteCorrenti = []; 
    state.startTime = Date.now(); state.timerInterval = setInterval(updateTimer, 1000);
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
    state.tracking = true; state.paused = false; setGpsStatus('live', 'Acquisizione…'); el.recIndicator.classList.add('active'); setControlsMode('tracking');
}

function pauseTracking() {
    state.paused = true; state.pauseStartedAt = Date.now();
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null; setGpsStatus('weak', 'In pausa'); setControlsMode('paused');
}

function resumeTracking() {
    state.paused = false; state.lastPosition = null; 
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
    setGpsStatus('live', 'Acquisizione…'); setControlsMode('tracking');
}

function stopTracking() {
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null; clearInterval(state.timerInterval); releaseWakeLock();
    state.tracking = false; state.paused = false; state.lastPosition = null;
    el.recIndicator.classList.remove('active'); setGpsStatus('idle', 'GPS in attesa'); setControlsMode('idle');
    updateGaugeVisual(0); el.currentSpeed.textContent = '0.0'; openRideSummary();
}

function resetRideStats() {
    state.maxSpeed = 0; state.totalDistance = 0; state.movingTime = 0; state.lastPosition = null; state.lastAcceptedSpeed = 0; state.lastBearing = null;
    refreshStatDisplays(); el.timer.textContent = '00:00:00';
}

function onPosition(position) {
    const coords = position.coords, currentLatLng = [coords.latitude, coords.longitude];
    let heading = typeof coords.heading === 'number' && !Number.isNaN(coords.heading) ? coords.heading : null;
    if (heading === null && state.lastPosition) {
        const movedKm = haversineDistanceKm(state.lastPosition.latitude, state.lastPosition.longitude, coords.latitude, coords.longitude);
        if (movedKm > 0.003) heading = computeBearingDeg(state.lastPosition.latitude, state.lastPosition.longitude, coords.latitude, coords.longitude);
    }
    if (heading !== null) { state.lastBearing = heading; updateMarkerHeading(heading); }
    if (state.map && state.marker) { state.map.panTo(currentLatLng, { animate: true, duration: 0.5 }); state.marker.setLatLng(currentLatLng); }
    updateGpsQuality(coords.accuracy); el.accuracy.textContent = coords.accuracy.toFixed(0); el.altitude.textContent = typeof coords.altitude === 'number' ? coords.altitude.toFixed(0) : '--';
    let speedKmh = typeof coords.speed === 'number' && coords.speed !== null ? coords.speed * 3.6 : deriveSpeedFromFixes(coords, position.timestamp);
    if (speedKmh < MIN_SPEED_THRESHOLD) speedKmh = 0;
    state.lastAcceptedSpeed = speedKmh; el.currentSpeed.textContent = kmhToDisplaySpeed(speedKmh).toFixed(1); updateGaugeVisual(speedKmh);
    if (speedKmh > state.maxSpeed) { state.maxSpeed = speedKmh; el.maxSpeed.textContent = kmhToDisplaySpeed(state.maxSpeed).toFixed(1); }
    if (state.lastPosition && coords.accuracy <= MIN_ACCURACY_FOR_DISTANCE) {
        const dist = haversineDistanceKm(state.lastPosition.latitude, state.lastPosition.longitude, coords.latitude, coords.longitude);
        if (dist > 0.001) { state.totalDistance += dist; el.distance.textContent = kmToDisplayDistance(state.totalDistance).toFixed(2); }
    }
    if (coords.accuracy <= MIN_ACCURACY_FOR_DISTANCE) {
        state.lastPosition = { latitude: coords.latitude, longitude: coords.longitude, timestamp: position.timestamp };
        checkTappeProximity(coords.latitude, coords.longitude);
    }
    el.avgSpeed.textContent = kmhToDisplaySpeed(computeAverageSpeed()).toFixed(1);
}

function deriveSpeedFromFixes(coords, timestamp) {
    if (!state.lastPosition) return 0;
    const dtHours = (timestamp - state.lastPosition.timestamp) / 3_600_000;
    if (dtHours <= 0) return state.lastAcceptedSpeed;
    return haversineDistanceKm(state.lastPosition.latitude, state.lastPosition.longitude, coords.latitude, coords.longitude) / dtHours;
}

function onPositionError(err) {
    if (err.code === err.PERMISSION_DENIED) { setGpsStatus('poor', 'Permesso negato'); stopTracking(); } 
    else setGpsStatus('weak', 'Segnale debole');
}

function updateGpsQuality(accuracy) {
    if (accuracy <= 15) setGpsStatus('live', 'Segnale ottimo'); else if (accuracy <= 35) setGpsStatus('weak', 'Segnale discreto'); else setGpsStatus('poor', 'Segnale debole');
}
function setGpsStatus(level, text) {
    el.gpsDot.classList.remove('live', 'weak', 'poor'); if (level !== 'idle') el.gpsDot.classList.add(level); el.gpsText.textContent = text;
}
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function computeBearingDeg(lat1, lon1, lat2, lon2) {
    const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180, Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function updateTimer() {
    if (state.paused) return;
    const elapsedMs = Date.now() - state.startTime; state.movingTime = elapsedMs / 1000;
    el.timer.textContent = formatDuration(elapsedMs); el.avgSpeed.textContent = kmhToDisplaySpeed(computeAverageSpeed()).toFixed(1);
}
function formatDuration(ms) {
    const date = new Date(ms), hh = String(date.getUTCHours()).padStart(2, '0'), mm = String(date.getUTCMinutes()).padStart(2, '0'), ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function setControlsMode(mode) {
    if (mode === 'idle') { el.startBtn.classList.remove('hidden'); el.pauseBtn.classList.add('hidden'); el.stopBtn.classList.add('hidden'); }
    else if (mode === 'tracking') { el.startBtn.classList.add('hidden'); el.pauseBtn.classList.remove('hidden'); el.stopBtn.classList.remove('hidden'); el.pauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>`; }
    else if (mode === 'paused') { el.startBtn.classList.add('hidden'); el.pauseBtn.classList.remove('hidden'); el.stopBtn.classList.remove('hidden'); el.pauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M7 5.5v13l11-6.5-11-6.5Z" fill="currentColor"/></svg>`; }
}

const HISTORY_KEY = 'ciclus_rides';
function openRideSummary() {
    pendingRide = { date: new Date().toISOString(), distanceKm: state.totalDistance, movingTimeSec: state.movingTime, maxSpeedKmh: state.maxSpeed, avgSpeedKmh: computeAverageSpeed() };
    el.sumDistance.textContent = `${kmToDisplayDistance(pendingRide.distanceKm).toFixed(2)} ${state.unit === 'km' ? 'km' : 'mi'}`; el.sumTime.textContent = formatDuration(pendingRide.movingTimeSec * 1000); el.sumAvg.textContent = `${kmhToDisplaySpeed(pendingRide.avgSpeedKmh).toFixed(1)} ${state.unit === 'km' ? 'km/h' : 'mph'}`; el.sumMax.textContent = `${kmhToDisplaySpeed(pendingRide.maxSpeedKmh).toFixed(1)} ${state.unit === 'km' ? 'km/h' : 'mph'}`;
    if (pendingRide.distanceKm < 0.05 && pendingRide.movingTimeSec < 30) { pendingRide = null; return; }
    el.summaryModal.classList.add('open'); el.summaryModal.setAttribute('aria-hidden', 'false');
}
function closeRideSummary() { el.summaryModal.classList.remove('open'); el.summaryModal.setAttribute('aria-hidden', 'true'); pendingRide = null; }
function saveRide() {
    if (!pendingRide) return closeRideSummary(); const rides = loadRides(); rides.unshift(pendingRide); localStorage.setItem(HISTORY_KEY, JSON.stringify(rides.slice(0, 100))); renderHistory(); closeRideSummary();
}
function loadRides() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; } }
function renderHistory() {
    const rides = loadRides(); if (rides.length === 0) { el.historyList.innerHTML = '<p class="empty-state">Nessuna corsa salvata ancora.</p>'; return; }
    el.historyList.innerHTML = rides.map((ride, index) => {
        const dateLabel = new Date(ride.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), dist = kmToDisplayDistance(ride.distanceKm).toFixed(2), distUnit = state.unit === 'km' ? 'km' : 'mi', time = formatDuration(ride.movingTimeSec * 1000), avg = kmhToDisplaySpeed(ride.avgSpeedKmh).toFixed(1);
        return `<div class="history-item"><div class="history-item-main"><span class="history-date">${dateLabel}</span><span class="history-metrics">${dist} ${distUnit}</span><span class="history-sub">${time} · media ${avg} ${state.unit === 'km' ? 'km/h' : 'mph'}</span></div><button class="history-delete" data-index="${index}"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7h12Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;
    }).join('');
    el.historyList.querySelectorAll('.history-delete').forEach(btn => { btn.addEventListener('click', () => { const rides = loadRides(); rides.splice(Number(btn.dataset.index), 1); localStorage.setItem(HISTORY_KEY, JSON.stringify(rides)); renderHistory(); }); });
}

function openSheet(panel) { el.scrim.classList.add('visible'); panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); }
function closeSheet(panel) { el.scrim.classList.remove('visible'); panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
async function requestWakeLock() { try { if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen'); } catch (err) { console.warn(`WakeLock non disponibile: ${err.message}`); } }
function releaseWakeLock() { if (state.wakeLock) state.wakeLock.release().then(() => { state.wakeLock = null; }); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.tracking && !state.paused && !state.wakeLock) requestWakeLock(); });

/* ==========================================================================
   Collegamento Eventi 
   ========================================================================== */
function bindEvents() {
    el.startBtn.addEventListener('click', startTracking);
    el.pauseBtn.addEventListener('click', () => { state.paused ? resumeTracking() : pauseTracking(); });
    el.stopBtn.addEventListener('click', stopTracking);

    el.historyBtn.addEventListener('click', () => { renderHistory(); openSheet(el.historyPanel); });
    el.closeHistoryBtn.addEventListener('click', () => closeSheet(el.historyPanel));
    el.clearHistoryBtn.addEventListener('click', () => { localStorage.removeItem(HISTORY_KEY); renderHistory(); });

    el.tappeBtn.addEventListener('click', () => { renderTappe(); openSheet(el.tappePanel); });
    el.closeTappeBtn.addEventListener('click', () => closeSheet(el.tappePanel));
    
    // Innesco Modale Tappe
    el.triggerAddTappaBtn.addEventListener('click', openAddTappaModal);
    el.cancelAddTappaBtn.addEventListener('click', closeAddTappaModal);
    el.confirmAddTappaBtn.addEventListener('click', confirmAddTappa);

    // Selezione Emoji Picker
    el.emojiPicker.querySelectorAll('.emoji-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            el.emojiPicker.querySelectorAll('.emoji-option').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectedEmoji = e.currentTarget.dataset.emoji;
        });
    });

    el.settingsBtn.addEventListener('click', () => openSheet(el.settingsPanel));
    el.closeSettingsBtn.addEventListener('click', () => closeSheet(el.settingsPanel));

    el.unitToggle.querySelectorAll('.segmented-option').forEach(btn => { btn.addEventListener('click', () => { state.unit = btn.dataset.unit; localStorage.setItem('ciclus_unit', state.unit); applySettingsToUI(); }); });
    el.mapThemeToggle.querySelectorAll('.segmented-option').forEach(btn => { btn.addEventListener('click', () => { state.mapTheme = btn.dataset.theme; localStorage.setItem('ciclus_theme', state.mapTheme); updateMapThemeLayer(); applySettingsToUI(); }); });
    el.mapRotateToggle.querySelectorAll('.segmented-option').forEach(btn => { btn.addEventListener('click', () => { state.mapRotate = btn.dataset.rotate; localStorage.setItem('ciclus_rotate', state.mapRotate); applySettingsToUI(); }); });
    el.mapZoomSlider.addEventListener('input', (e) => { state.mapZoom = parseInt(e.target.value); localStorage.setItem('ciclus_zoom', state.mapZoom); applySettingsToUI(); });

    el.scrim.addEventListener('click', () => { closeSheet(el.historyPanel); closeSheet(el.settingsPanel); closeSheet(el.tappePanel); });
    el.discardRideBtn.addEventListener('click', closeRideSummary); el.saveRideBtn.addEventListener('click', saveRide);
}