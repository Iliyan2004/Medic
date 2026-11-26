// Import real health facilities for Pakistan from the Healthsites.io / OpenStreetMap dataset.
// Source: https://data.humdata.org/dataset/pakistan-healthsites  (GeoJSON, ODbL licence)
// Usage:  node server/import-healthsites.js data/healthsites/pakistan.geojson
//
// Imported places are marked source='osm' and verified=0: they are community-mapped, not licence-checked.
// Re-running updates existing rows (matched on osm_id) and never touches Sehatyab-verified facilities.
// Licence: ODbL — keep the "© OpenStreetMap contributors" attribution (shown on every map), and if this
// database is ever shared publicly, the facility table must be shared under ODbL too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, helpers } from './db.js';
import { isLatLng } from './lib/validate.js';

const TYPE = {
  hospital: 'hospital', clinic: 'clinic', doctors: 'clinic', doctor: 'clinic', dentist: 'clinic', physiotherapist: 'clinic',
  optometrist: 'clinic', rehabilitation: 'clinic', alternative: 'clinic', laboratory: 'lab', pharmacy: 'pharmacy', blood_donation: 'blood_bank',
};
const SERVICE = { dentist: 'Dental', physiotherapist: 'Physiotherapy', optometrist: 'Eye care', rehabilitation: 'Rehabilitation', alternative: 'Traditional medicine', laboratory: 'Lab tests', blood_donation: 'Blood donation' };

// City centroids used to place each facility (nearest within 35 km, else "Other").
import { nearestCity } from './lib/places.js';

const clean = (s, n = 120) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export function importHealthsites(db, geojson) {
  const h = helpers(db);
  const feats = Array.isArray(geojson?.features) ? geojson.features : [];
  let added = 0, updated = 0, skipped = 0;
  const upsert = db.prepare(`INSERT INTO facilities (name, type, sector, lat, lng, city, province, address, phone, services, emergency, beds_total, verified, source, osm_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,'osm',?)
    ON CONFLICT(osm_id) WHERE osm_id IS NOT NULL DO UPDATE SET name=excluded.name, type=excluded.type, lat=excluded.lat, lng=excluded.lng,
      city=excluded.city, province=excluded.province, address=excluded.address, phone=excluded.phone, services=excluded.services`);
  h.tx(() => {
    for (const f of feats) {
      const p = f?.properties || {};
      const type = TYPE[p.amenity] || TYPE[p.healthcare];
      const [lng, lat] = f?.geometry?.type === 'Point' ? f.geometry.coordinates.map(Number) : [];
      const name = clean(p.name);
      if (!type || !name || !isLatLng(lat, lng) || !p.osm_id) { skipped++; continue; }
      // Coordinates beat the free-text addr:city (which is sometimes wrong in OSM); use it only outside known cities.
      const near = nearestCity(lat, lng);
      const loc = near.city !== 'Other' ? near : { city: clean(p.addr_city, 40) || 'Other', province: null };
      const services = [SERVICE[p.amenity], clean(p.speciality, 60)].filter(Boolean);
      const sector = /government|public/i.test(p.operator_type) ? 'public' : /ngo|charit|non.?profit|community/i.test(p.operator_type) ? 'ngo' : 'private';
      const osmId = `${p.osm_type || 'node'}/${p.osm_id}`;
      const existed = h.get('SELECT 1 FROM facilities WHERE osm_id = ?', osmId);
      upsert.run(name, type, sector, lat, lng, loc.city, loc.province, clean([p.addr_housenumber, p.addr_street].filter(Boolean).join(' ')) || null,
        null, JSON.stringify(services), /yes/i.test(p.emergency) ? 1 : 0, Number.parseInt(p.beds, 10) || 0, osmId);
      if (existed) updated++; else added++;
    }
  });
  return { added, updated, skipped, total: feats.length };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const file = process.argv[2] || path.join(ROOT, 'data', 'healthsites', 'pakistan.geojson');
  const dbFile = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'sehatyab.db');
  const db = openDb(dbFile);
  const r = importHealthsites(db, JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(`Healthsites import: ${r.added} added, ${r.updated} updated, ${r.skipped} skipped (of ${r.total}). © OpenStreetMap contributors, ODbL.`);
}
