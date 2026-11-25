// 안정판 올리기: 지금 main의 최신 커밋을 '안정판'으로 지정한다.
// 사용법: npm run release   (그다음 git push)
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
if (sh('git status --porcelain')) {
  console.error('커밋하지 않은 변경이 있습니다. 먼저 커밋하세요.');
  process.exit(1);
}
const sha = sh('git rev-parse HEAD');
writeFileSync('STABLE_VERSION', sha + '\n');
sh('git add STABLE_VERSION');
sh(`git commit -m "안정판 지정: ${sha.slice(0, 7)}"`);
console.log(`안정판을 ${sha.slice(0, 7)} 으로 지정했습니다. git push 하면 배포됩니다.`);
