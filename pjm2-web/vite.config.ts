import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Production build: preload the (content-hashed) high-priority asset packs from game.html so
 *  they download in parallel with the JS bundle and the mesh pack, before any script runs
 *  (docs/LOAD_OPTIMIZATION_PLAN.md). Run `npm run build:packs` first; absent packs = no-op. */
function preloadPacks(): Plugin {
  return {
    name: 'pjm2-preload-packs',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      if (!ctx.filename.endsWith('game.html')) return html;
      const mf = resolve(__dirname, 'public/assets/packs/manifest.json');
      if (!existsSync(mf)) return html;
      const m = JSON.parse(readFileSync(mf, 'utf8')) as { packs: Record<string, { file: string; priority: string }> };
      const tags = Object.values(m.packs).filter((p) => p.priority === 'high')
        .map((p) => `<link rel="preload" as="fetch" crossorigin href="/assets/packs/${p.file}.gz" />`).join('\n    ');
      return html.replace('</head>', `    ${tags}\n  </head>`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preloadPacks()],
  // Reachable from other machines on the LAN (dev + preview).
  server: { host: '0.0.0.0', port: 5199, strictPort: true },
  preview: { host: '0.0.0.0', port: 5199, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'game.html'),
        stageSelect: resolve(__dirname, 'stage-select.html'),
        stage: resolve(__dirname, 'stage.html'),
        characters: resolve(__dirname, 'characters.html'),
        uiLab: resolve(__dirname, 'ui-lab.html'),
      },
    },
  },
});
