import { AppManifest } from './types';

const CARDS_START = '<!-- PANORAMA_APP_CARDS_START -->';
const CARDS_END = '<!-- PANORAMA_APP_CARDS_END -->';
const PROBES_START = '/* PANORAMA_APP_PROBES_START */';
const PROBES_END = '/* PANORAMA_APP_PROBES_END */';

const ICON_SVGS: Record<string, string> = {
  Droplet: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>',
  PenLine: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
  Shield: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
  Activity: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
  ShoppingBasket: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 11-1 9"></path><path d="m19 11-4-7"></path><path d="M2 11h20"></path><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"></path><path d="M4.5 15.5h15"></path><path d="m5 11 4-7"></path><path d="m9 11 1 9"></path></svg>',
  Layers: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
};

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderPortalHtml(
  existingHtml: string,
  apps: AppManifest[],
  mode: 'local' | 'remote'
): string {
  const filtered = [...apps]
    .filter((a) => (mode === 'remote' ? a.sre.exposeInRemotePortal : true))
    .sort((a, b) => a.portalOrder - b.portalOrder || a.port - b.port);

  const indent = mode === 'local' ? '          ' : '      ';
  const linkAttrs = mode === 'local' ? ' target="_blank" rel="noopener noreferrer"' : '';

  const cardsBlock = filtered
    .map((app) => {
      const svg = ICON_SVGS[app.icon] || ICON_SVGS.Layers;
      const theme = `${app.themeColor}-theme`;
      return [
        `${indent}<!-- ${escapeHtml(app.portalTitle)} -->`,
        `${indent}<article class="app-card">`,
        `${indent}  <div class="app-card-top">`,
        `${indent}    <div class="app-card-header">`,
        `${indent}      <div class="app-icon ${theme}">${svg}</div>`,
        `${indent}      <div class="app-status running" id="status-${app.slug}"><span class="status-dot"></span>Checking...</div>`,
        `${indent}    </div>`,
        `${indent}    <h3 class="app-card-title">${escapeHtml(app.portalTitle)}</h3>`,
        `${indent}    <div class="app-deployed-info" id="deploy-${app.slug}"></div>`,
        `${indent}    <p class="app-card-desc">${escapeHtml(app.description)}</p>`,
        `${indent}  </div>`,
        `${indent}  <a href="${app.basePath}"${linkAttrs} class="app-card-btn ${theme}">`,
        `${indent}    Open Application`,
        `${indent}    <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`,
        `${indent}  </a>`,
        `${indent}</article>`,
      ].join('\n');
    })
    .join('\n\n');

  const probesBlock = filtered
    .map((app) => `      { id: '${app.slug}', path: '${app.sre.healthEndpoint}' }`)
    .join(',\n');

  if (!existingHtml.includes(CARDS_START) || !existingHtml.includes(PROBES_START)) {
    throw new Error(`Missing deterministic portal markers in ${mode} HTML template.`);
  }

  let updated = existingHtml.replace(
    new RegExp(`${CARDS_START}[\\s\\S]*?${CARDS_END}`),
    `${CARDS_START}\n${cardsBlock}\n${indent}${CARDS_END}`
  );

  updated = updated.replace(
    new RegExp(`\\/\\* PANORAMA_APP_PROBES_START \\*\\/[\\s\\S]*?\\/\\* PANORAMA_APP_PROBES_END \\*\\/`),
    `${PROBES_START}\n${probesBlock}\n      ${PROBES_END}`
  );

  return updated;
}
