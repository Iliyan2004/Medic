// Lazy map loader shared by Map, Emergency and Dispatch screens. Nothing map-related
// downloads until a map is actually shown, and never in low-data mode.
// Tiles: Mapbox (light/dark to match the theme) when a public token is configured, else OpenStreetMap.
// Leaflet stays the renderer: ~40 KB, raster tiles are GPU-composited and kept in the browser's memory cache.
import { api } from '../app.js';

let L = null;
let cfg = null;
export async function loadLeaflet() {
  if (L) return L;
  if (!document.querySelector('link[data-leaflet]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/vendor/leaflet/leaflet.css'; link.dataset.leaflet = '1';
    document.head.append(link);
  }
  L = await import('/vendor/leaflet/leaflet-src.esm.js');
  return L;
}
// Fetched once per session and kept in memory.
async function config() {
  if (!cfg) cfg = api('/config').catch(() => ({ mapboxToken: null }));
  return cfg;
}

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export async function makeMap(el, center = [30.3753, 69.3451], zoom = 5) {
  const [L, { mapboxToken }] = await Promise.all([loadLeaflet(), config()]);
  const map = L.map(el, { preferCanvas: true, zoomControl: true }).setView(center, zoom);
  if (mapboxToken) {
    const style = dark() ? 'dark-v11' : 'streets-v12';
    // 512px tiles + zoomOffset -1 = half the tile requests; @2x only on high-density screens.
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/{z}/{x}/{y}${devicePixelRatio > 1 ? '@2x' : ''}?access_token=${mapboxToken}`, {
      tileSize: 512, zoomOffset: -1, maxZoom: 19, detectRetina: false, updateWhenIdle: true, keepBuffer: 2,
      referrerPolicy: 'origin', // lets Mapbox URL restrictions work despite the site-wide no-referrer policy
      attribution: '© <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
  } else {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, updateWhenIdle: true, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
  }
  return { L, map };
}

export const COLORS = {
  hospital: '#e11d48', clinic: '#0d9488', bhu: '#16a34a', rhc: '#65a30d', lab: '#7c3aed', pharmacy: '#0284c7',
  blood_bank: '#be123c', camp: '#ea580c', ambulance: '#2563eb', patient: '#111827',
};

// Routes are cached in memory (RAM) so the 5-second tracking refresh doesn't refetch the same path.
const routeCache = new Map();
const key = (a, b) => `${a.lat.toFixed(3)},${a.lng.toFixed(3)}>${b.lat.toFixed(3)},${b.lng.toFixed(3)}`;

// Road route: Mapbox Directions with live traffic when configured, else the public OSRM server;
// falls back to a straight line.
export async function route(from, to) {
  const k = key(from, to);
  if (routeCache.has(k)) return routeCache.get(k);
  const { mapboxToken } = await config();
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = mapboxToken
    ? `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?overview=simplified&geometries=geojson&access_token=${mapboxToken}`
    : `https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson`;
  let out = { points: [[from.lat, from.lng], [to.lat, to.lng]], road: false };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'origin' });
    clearTimeout(timer);
    const j = await r.json();
    if (j.routes?.[0]) out = { points: j.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]), km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60, road: true };
  } catch { /* fall back */ }
  if (routeCache.size > 50) routeCache.delete(routeCache.keys().next().value);
  routeCache.set(k, out);
  return out;
}
