import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let commitHash = 'unknown';
let commitDate = '';

try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  commitDate = execSync('git log -1 --format=%cd --date=format:"%Y%m%d.%H%M"').toString().trim();
} catch (e) {
  commitHash = 'dev';
  commitDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

const buildIdentifier = commitDate ? `Build ${commitDate}` : `Build ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

let pkgVersion = '1.2.1';
try {
  const pkgContent = readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8');
  const pkg = JSON.parse(pkgContent);
  if (pkg.version) pkgVersion = pkg.version;
} catch (e) {}

const fullTitle = `PanoramaSRE Control Plane v${pkgVersion} (${buildIdentifier})`;

const tauriConfPath = path.resolve(__dirname, '../src-tauri/tauri.conf.json');
try {
  const content = readFileSync(tauriConfPath, 'utf-8');
  const json = JSON.parse(content);
  json.version = pkgVersion;
  if (json.app?.windows?.[0]) {
    json.app.windows[0].title = fullTitle;
    writeFileSync(tauriConfPath, JSON.stringify(json, null, 2) + '\n', 'utf-8');
    console.log(`[sync-build-info] Updated window title to: "${fullTitle}" and version to: "${pkgVersion}"`);
  }
} catch (err) {
  console.error('[sync-build-info] Failed to update tauri.conf.json:', err);
}
