import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { execSync } from 'child_process';

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

const buildStamp = `${commitHash}${commitDate ? ` (${commitDate})` : ''}`;
const buildNumber = `${commitDate || new Date().toISOString().slice(0, 10).replace(/-/g, '')}.${commitHash}`;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  define: {
    __APP_VERSION__: JSON.stringify('1.0.0'),
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
