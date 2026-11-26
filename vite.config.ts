import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** 빌드 결과 파일 목록으로 서비스 워커(sw.js)를 만든다(오프라인에서도 앱이 열리도록) */
function serviceWorker(): Plugin {
  return {
    name: 'sportsday-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const publicFiles = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = [...new Set([...publicFiles, ...built])];
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const src = readFileSync('scripts/sw-template.js', 'utf8').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// base './' : GitHub Pages 하위 경로(/sports-day-app/)에서도 동작하도록 상대 경로 사용
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  build: { chunkSizeWarningLimit: 1000 },
  test: { include: ['src/**/*.test.ts'] },
} as any);
