import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker from "../dist/server/index.js";

const request = (path, method = "GET") =>
  new Request("https://factory.test" + path, { method });

test("HTML, APIs, exports, and icons are public without credentials", async () => {
  for (const path of [
    "/",
    "/api/overview",
    "/api/jobs/job_0220",
    "/api/export",
    "/favicon.svg",
    "/api/health",
  ]) {
    const response = await worker.fetch(request(path));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("WWW-Authenticate"), null);
  }
  const staleAuthorization = new Request("https://factory.test/", {
    headers: { Authorization: "Basic stale-credentials" },
  });
  assert.equal((await worker.fetch(staleAuthorization)).status, 200);
});
test("server bundles and source files are not served as public assets", async () => {
  for (const path of [
    "/dist/server/index.js",
    "/data/manufacturing_events.jsonl",
    "/.generated/data.json",
    "/deployment.txt",
  ]) {
    assert.equal((await worker.fetch(request(path))).status, 404, path);
  }
});
test("overview and job detail expose reconciled data and original evidence", async () => {
  const response = await worker.fetch(request("/api/overview"));
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.equal(overview.stats.jobs, 312);
  assert.equal(overview.stats.overdueOpen, 26);
  assert.equal(overview.stats.blockedOpen, 9);
  assert.equal(overview.stats.completed, 281);
  assert.equal(overview.stats.totalGood, 78555);
  assert.equal(overview.stats.totalScrap, 7613);
  assert.equal(overview.dataQuality.conflictingIds.length, 5);
  assert.ok(
    !("eventsByJob" in overview),
    "Overview should not return all raw events",
  );
  const detail = await (
    await worker.fetch(request("/api/jobs/job_0220"))
  ).json();
  assert.equal(detail.job.blockReason, "missing_tool");
  assert.ok(detail.events.some((e) => e.event_type === "job_blocked"));
  assert.ok(detail.blockIntervals.some((i) => !i.end));
});
test("filters and CSV export agree; empty cohorts retain null rates", async () => {
  const overview = await (
    await worker.fetch(request("/api/overview?status=blocked"))
  ).json();
  assert.equal(overview.jobs.length, 9);
  assert.ok(overview.jobs.every((j) => j.blocked));
  const csv = await (
    await worker.fetch(request("/api/export?status=blocked"))
  ).text();
  assert.equal(csv.split("\r\n").length - 1, overview.jobs.length);
  const empty = await (
    await worker.fetch(request("/api/overview?search=no-such-job-abc"))
  ).json();
  assert.equal(empty.jobs.length, 0);
  assert.equal(empty.stats.onTimeRate, null);
  assert.equal(empty.stats.scrapRate, null);
});
test("unknown jobs, unsupported methods, and HEAD have correct HTTP behavior", async () => {
  for (const path of ["/api/jobs/%", "/api/jobs/%ZZ", "/api/jobs/%E0%A4"]) {
    assert.equal((await worker.fetch(request(path))).status, 400, path);
  }
  assert.equal(
    (await worker.fetch(request("/api/jobs/not-a-job"))).status,
    404,
  );
  assert.equal(
    (await worker.fetch(request("/api/overview", "POST"))).status,
    405,
  );
  const head = await worker.fetch(request("/", "HEAD"));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Cache-Control"), "no-store");
});
test("deployment preserves the compiled client bundle when embedding HTML", async () => {
  const viteIndex = readFileSync(
    new URL("../dist-client/index.html", import.meta.url),
    "utf8",
  );
  const scriptPath = viteIndex.match(/<script\b[^>]*src="([^"]+)"/)[1];
  const compiledClient = readFileSync(
    new URL("../dist-client" + scriptPath, import.meta.url),
    "utf8",
  );
  const html = await (await worker.fetch(request("/"))).text();
  const embeddedClient = html.match(
    /<script type="module">([\s\S]*?)<\/script>/,
  )[1];
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(
    hash(embeddedClient),
    hash(compiledClient.replace(/<\/script/gi, "<\\/script")),
  );
  assert.ok(!html.includes("/src/main.tsx"));
});
