import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildDataset } from '../src/domain.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(root, process.argv[2] ?? 'data/manufacturing_events.jsonl');
const output = resolve(root, process.argv[3] ?? '.generated/data.json');
const source = await readFile(input, 'utf8');
const rows = [];
for (const [index, line] of source.split(/\r?\n/).entries()) {
  if (!line.trim()) continue;
  try { rows.push(JSON.parse(line)); }
  catch (error) { throw new Error(`Invalid JSON at ${input}:${index + 1}: ${error.message}`); }
}
const dataset = buildDataset(rows);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(dataset));
console.log(`Ingested ${dataset.dataQuality.rawEvents.toLocaleString()} rows → ${dataset.dataQuality.uniqueEvents.toLocaleString()} events / ${dataset.jobs.length} jobs as of ${dataset.asOf}`);
console.log(`Removed ${dataset.dataQuality.exactDuplicates} exact duplicates; retained ${dataset.dataQuality.conflictingIds.length} conflicts with variants; ${dataset.stats.qualityMismatchJobs} quality reconciliation flags.`);
