import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import adapter from "../api/index.mjs";

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);
const routeParameter = "__factory_triage_path";

// Model the configured rewrite, including ordinary query-string forwarding.
// The deployed smoke test additionally verifies Vercel's routing behavior.
function rewrittenRequest(path, method = "GET") {
  const source = new URL(path, "https://factory.vercel.test");
  const route = config.routes[0];
  assert.equal(route.src, "/(.*)");
  const match = source.pathname.match(new RegExp(`^${route.src}$`));
  assert.ok(match);
  const destination = new URL(
    route.dest.replace("$1", () => match[1]),
    source.origin,
  );
  for (const [key, value] of source.searchParams)
    destination.searchParams.append(key, value);
  return new Request(destination, { method });
}

test("Vercel configuration routes every request to the function before filesystem serving", () => {
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, ".vercel-public");
  assert.notEqual(config.outputDirectory, "dist");
  assert.notEqual(config.outputDirectory, "dist-client");
  assert.deepEqual(Object.keys(config.functions), ["api/index.mjs"]);
  assert.equal(
    config.functions["api/index.mjs"].includeFiles,
    "dist/server/index.js",
  );
  assert.deepEqual(config.routes, [
    { src: "/(.*)", dest: "/api/index?__factory_triage_path=/$1" },
  ]);
  assert.equal(config.rewrites, undefined);
  assert.ok(!config.routes.some((route) => route.handle === "filesystem"));
});

test("Vercel adapter preserves root, job paths, queries, CSV, and HEAD", async () => {
  const root = await adapter.fetch(rewrittenRequest("/?status=all"));
  assert.equal(root.status, 200);
  assert.match(root.headers.get("Content-Type"), /text\/html/);
  assert.equal(root.headers.get("WWW-Authenticate"), null);
  const overview = await (
    await adapter.fetch(rewrittenRequest("/api/overview?status=blocked"))
  ).json();
  assert.equal(overview.stats.jobs, 9);
  assert.ok(overview.jobs.every((job) => job.blocked));
  const scoped = await (
    await adapter.fetch(
      rewrittenRequest(
        "/api/overview?status=completed&customer=cust_helix&search=job_",
      ),
    )
  ).json();
  assert.ok(scoped.jobs.length > 0);
  assert.ok(
    scoped.jobs.every(
      (job) => job.completedAt && job.customerId === "cust_helix",
    ),
  );
  const job = await (
    await adapter.fetch(rewrittenRequest("/api/jobs/job_0220"))
  ).json();
  assert.equal(job.job.id, "job_0220");
  assert.equal(job.job.blockReason, "missing_tool");
  const csv = await adapter.fetch(
    rewrittenRequest("/api/export?status=blocked"),
  );
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("Content-Type"), /text\/csv/);
  assert.equal((await csv.text()).split("\r\n").length - 1, 9);
  const head = await adapter.fetch(rewrittenRequest("/", "HEAD"));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Cache-Control"), "no-store");
});

test("Vercel application endpoints are public and source files remain unavailable", async () => {
  for (const path of [
    "/",
    "/favicon.svg",
    "/api/health",
    "/api/overview",
    "/api/jobs/job_0220",
    "/api/export",
  ]) {
    const response = await adapter.fetch(rewrittenRequest(path));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("WWW-Authenticate"), null, path);
  }
  for (const path of [
    "/dist/server/index.js",
    "/data/manufacturing_events.jsonl",
    "/.generated/data.json",
    "/assets/app.js",
    "/deployment.txt",
  ]) {
    assert.equal(
      (await adapter.fetch(rewrittenRequest(path))).status,
      404,
      path,
    );
  }
  assert.equal(
    (await adapter.fetch(rewrittenRequest("/api/overview", "POST"))).status,
    405,
  );
});

test("ambiguous or invalid rewrite paths return 404 and cannot change origin", async () => {
  const invalid = new URL("https://factory.vercel.test/api/index");
  invalid.searchParams.set(routeParameter, "//other.example/api/overview");
  assert.equal((await adapter.fetch(new Request(invalid))).status, 404);
  const duplicate = new URL("https://factory.vercel.test/api/index");
  duplicate.searchParams.append(routeParameter, "/");
  duplicate.searchParams.append(routeParameter, "/api/overview");
  assert.equal((await adapter.fetch(new Request(duplicate))).status, 404);
});
