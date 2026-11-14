import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';

// Preserve the existing Sites artifact. Vercel serves the same application
// through api/index.mjs, with no public HTML, assets, source, or data files.
// Vercel rejects an entirely empty output folder, so it receives one fixed,
// harmless marker. The catch-all route runs before filesystem serving.
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
mkdirSync('.vercel-public', { recursive: true });
if (readdirSync('.vercel-public').some(name => name !== 'deployment.txt')) {
  throw new Error('The Vercel static output may contain only deployment.txt. Remove unexpected files from .vercel-public before deploying.');
}
writeFileSync('.vercel-public/deployment.txt', 'Factory Triage deployment marker. All application requests are handled by the authenticated function.\n');
console.log('Vercel build ready: authenticated Node function; static output contains only a harmless deployment marker.');
