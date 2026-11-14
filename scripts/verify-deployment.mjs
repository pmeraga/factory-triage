import assert from "node:assert/strict";

const url = process.argv[2];
if (!url)
  throw new Error(
    "Usage: node scripts/verify-deployment.mjs https://your-site.example",
  );
const origin = new URL(url).origin;
const get = (path) =>
  fetch(origin + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
const checks = [];
for (const path of [
  "/",
  "/api/overview",
  "/api/jobs/job_0220",
  "/api/export",
  "/favicon.svg",
  "/api/health",
]) {
  const response = await get(path);
  assert.equal(response.status, 200, `Public route ${path}`);
  assert.equal(response.headers.get("www-authenticate"), null);
  checks.push({ route: path, status: response.status });
}
assert.match(await (await get("/")).text(), /Factory Triage/);
const overview = await (await get("/api/overview")).json();
assert.equal(overview.stats.jobs, 312);
assert.equal(overview.stats.overdueOpen, 26);
assert.equal(overview.stats.blockedOpen, 9);
assert.equal(overview.dataQuality.conflictingIds.length, 5);
const detail = await (await get("/api/jobs/job_0220")).json();
assert.equal(detail.job.blockReason, "missing_tool");
const csv = await get("/api/export?status=blocked");
assert.equal(csv.status, 200);
assert.equal((await csv.text()).split("\r\n").length - 1, 9);
for (const path of [
  "/deployment.txt",
  "/dist/server/index.js",
  "/data/manufacturing_events.jsonl",
  "/.generated/data.json",
]) {
  assert.equal((await get(path)).status, 404, `Source file path ${path}`);
}
console.log(
  JSON.stringify(
    {
      url: origin,
      status: "verified",
      access: "public",
      checks,
      blockedCsvJobs: 9,
      stats: overview.stats,
    },
    null,
    2,
  ),
);
