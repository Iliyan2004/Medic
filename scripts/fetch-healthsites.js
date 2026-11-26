// Downloads the open Pakistan health-facility dataset (Healthsites.io / OpenStreetMap, ODbL) into
// <DATA_DIR>/healthsites/pakistan.geojson. The server imports it automatically on start.
// Used by hosted builds (data/ is never committed). Never fails the build: the app works without it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'healthsites');
const file = path.join(dir, 'pakistan.geojson');
const URL_ = 'https://data.humdata.org/dataset/60389a73-e09b-43c4-a22c-2ef6b3e5eb52/resource/39db6580-69ac-43da-97d0-cc44b6b5e232/download/pakistan.geojson';

try {
  if (fs.existsSync(file)) { console.log('Healthsites data already present.'); process.exit(0); }
  const r = await fetch(URL_, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  const n = JSON.parse(text).features?.length || 0;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`Downloaded ${n} facilities from Healthsites.io (© OpenStreetMap contributors, ODbL).`);
} catch (e) {
  console.warn(`Could not download Healthsites data (${e.message}). The map will show demo facilities only.`);
}
