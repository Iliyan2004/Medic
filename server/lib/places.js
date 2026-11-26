// Major Pakistani cities: name, centroid, province. Used to place facilities (OSM import) and to aggregate
// health-geography statistics by city. Centroids are approximate city centres.
import { haversineKm } from './geo.js';

export const CITIES = [
  ['Karachi', 24.8607, 67.0011, 'Sindh'], ['Lahore', 31.5204, 74.3587, 'Punjab'], ['Islamabad', 33.6844, 73.0479, 'Islamabad'],
  ['Rawalpindi', 33.5651, 73.0169, 'Punjab'], ['Faisalabad', 31.4504, 73.135, 'Punjab'], ['Multan', 30.1575, 71.5249, 'Punjab'],
  ['Peshawar', 34.0151, 71.5249, 'Khyber Pakhtunkhwa'], ['Quetta', 30.1798, 66.975, 'Balochistan'], ['Hyderabad', 25.396, 68.3578, 'Sindh'],
  ['Gujranwala', 32.1877, 74.1945, 'Punjab'], ['Sialkot', 32.4945, 74.5229, 'Punjab'], ['Bahawalpur', 29.3956, 71.6836, 'Punjab'],
  ['Sargodha', 32.0836, 72.6711, 'Punjab'], ['Sukkur', 27.7052, 68.8574, 'Sindh'], ['Larkana', 27.559, 68.2264, 'Sindh'],
  ['Abbottabad', 34.1688, 73.2215, 'Khyber Pakhtunkhwa'], ['Mardan', 34.1986, 72.0404, 'Khyber Pakhtunkhwa'], ['Swat', 34.7717, 72.3602, 'Khyber Pakhtunkhwa'],
  ['Gilgit', 35.9208, 74.3089, 'Gilgit-Baltistan'], ['Muzaffarabad', 34.37, 73.4711, 'AJK'], ['Gwadar', 25.1264, 62.3225, 'Balochistan'],
  ['Dera Ismail Khan', 31.8314, 70.9019, 'Khyber Pakhtunkhwa'], ['Sahiwal', 30.6682, 73.1114, 'Punjab'], ['Mirpur Khas', 25.5276, 69.0111, 'Sindh'],
  ['Nawabshah', 26.2442, 68.41, 'Sindh'], ['Jhelum', 32.9425, 73.7257, 'Punjab'], ['Rahim Yar Khan', 28.4202, 70.2952, 'Punjab'],
];
export const CITY = Object.fromEntries(CITIES.map(([n, lat, lng, province]) => [n, { name: n, lat, lng, province }]));

export function nearestCity(lat, lng, maxKm = 35) {
  let best = null, d = Infinity;
  for (const c of CITIES) { const k = haversineKm({ lat, lng }, { lat: c[1], lng: c[2] }); if (k < d) { d = k; best = c; } }
  return d <= maxKm ? { city: best[0], province: best[3] } : { city: 'Other', province: null };
}
