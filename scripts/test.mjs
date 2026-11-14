import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
const files = readdirSync('tests').filter(f => f.endsWith('.test.mjs')).map(f => 'tests/' + f);
execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
