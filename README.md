# Factory Triage

A manufacturing operations desk: find overdue and blocked jobs, inspect their lifecycle, and trace every issue to source events. Built from the supplied synthetic manufacturing log; this is a historical snapshot, not a live factory feed.

Production: https://factory-triage-psi.vercel.app (public; no login required).

Vercel project: https://vercel.com/yotta-robotics/factory-triage. The private GitHub repository is connected for automatic deployments. The earlier Sites deployment remains available at https://factory-triage-helicon.tanbud16.chatgpt.site.

## Run locally

Requires Node.js **24.x**, matching `package.json` and the Vercel runtime.

```sh
npm ci
npm run ingest
npm run dev
```

Open `http://localhost:4173`. The application, job evidence, API, and CSV exports are public; no username or password is required.

```sh
npm test
npm run typecheck
npm run build
```

The build produces a portable Worker at `dist/server/index.js`. Vercel serves the public application through its Node adapter. The raw source log and server bundle are not served as static assets. See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting details.

Source repository: https://github.com/pmeraga/factory-triage (private; owned by `pmeraga`).

## Deploy on Vercel

The GitHub repository `pmeraga/factory-triage` is connected to the Vercel project for automatic deployments from commits. The repository's custom build settings are in `vercel.json`, with Node.js **24.x** and build command `npm run vercel-build`.

The Vercel application is public and requires no authentication environment variables.

The custom build regenerates the server dataset, builds the embedded frontend and Worker, and prepares `.vercel-public` with only a fixed, harmless `deployment.txt` marker because Vercel requires a nonempty output directory. The build rejects any other files in that directory. A catch-all route runs before filesystem serving and sends every request, including requests for the marker, to `api/index.mjs`, which forwards them to the same Worker's public `fetch` handler. **Do not publish `dist`, `dist-client`, the raw log, or the generated dataset as static assets:** the server bundle contains the manufacturing data. Vercel serves the application through the function, including its HTML and exports.

## Stack and decisions

- **React 19, TypeScript, Vite, Lucide:** responsive queue, job investigation, quality review, and metric definitions.
- **Node.js ingestion:** deterministic, dependency-free normalization of `data/manufacturing_events.jsonl` into a generated dataset.
- **TypeScript Worker API, esbuild:** frontend and server data ship in one deployment artifact. Summaries and source-event evidence are served through read-only API routes.
- **Snapshot model:** at 19,519 source rows and 312 jobs, a reproducible build-time model is enough. A separate database, ingestion service, and deployment pipeline would add moving parts without improving this use case. The initially considered Python/DuckDB service was replaced to fit the supported Worker hosting runtime.
- **Evidence before prediction:** the queue uses recorded due dates, priorities, and block transitions. It does not estimate completion dates or claim causal root causes.

## API

All endpoints are public and read-only.

| Endpoint | Result |
| --- | --- |
| `GET /api/overview` | Job summaries, delivery/quality aggregates, trends, filter options, and data-quality issues |
| `GET /api/jobs/:id` | One job, its normalized source events, and block intervals |
| `GET /api/export` | CSV of the filtered jobs |

Overview and export accept `search`, `customer`, `material`, `machine`, `facility`, and `status` (`all`, `open`, `overdue`, `blocked`, `completed`). Source events and generation rules are preserved in the repository. See [DATA_NOTES.md](DATA_NOTES.md) for metric definitions and reconciliation policy.

## Two-minute demo

1. Open the attention queue and filter to blocked jobs. Search for `job_0220`: it has a recorded `missing_tool` block and no matching unblock.
2. Open the job timeline and inspect the original block event. Its July 17 due date is before the snapshot clock.
3. Switch to all jobs and inspect `job_0080`, an on-time completion with 168 good units and 14 scrap units.
4. Open quality and data, then inspect `job_0068`: inspections report 21 failed units while the completion summary records 22 scrap units. The discrepancy stays visible.
5. Export a filtered job cohort as CSV.

## Scope

This prototype supports investigation of the supplied snapshot. It has no live ingestion, scheduling optimizer, write-back workflow, forecast model, or OEE calculation. “Open” means no completion event was observed, which may also reflect an incomplete extract. Incremental commits record the scaffold, data modeling, product implementation, and verification work.
