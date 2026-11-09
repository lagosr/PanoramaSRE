import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

let commitHash = 'unknown';
let commitDate = '';

try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  commitDate = execSync('git log -1 --format=%cd --date=format:"%Y%m%d.%H%M"').toString().trim();
} catch (e) {
  // Fallback if git is not in PATH or not available
  commitHash = 'dev';
  commitDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

let pkgVersion = '1.2.0';
try {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'));
  if (pkg.version) pkgVersion = pkg.version;
} catch (e) {
  // Fallback
}

const buildStamp = `${commitHash}${commitDate ? ` (${commitDate})` : ''}`;
const buildNumber = `${commitDate || new Date().toISOString().slice(0, 10).replace(/-/g, '')}.${commitHash}`;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __BUILD_HASH__: JSON.stringify(commitHash),
    __BUILD_DATE__: JSON.stringify(commitDate),
    __BUILD_STAMP__: JSON.stringify(buildStamp),
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  }
});
