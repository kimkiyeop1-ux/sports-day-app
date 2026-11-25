// 사용법: npm run check-config -- configs/파일이름.json
// (TypeScript 검사기를 vite-node 없이 쓰기 위해 vitest로 실행)
import { execSync } from 'node:child_process';
const file = process.argv[2] ?? 'configs/sample-2026.json';
execSync(`npx vitest run src/config/check-file.test.ts`, { stdio: 'inherit', env: { ...process.env, CONFIG_FILE: file } });
