# Factory Triage

A manufacturing operations desk: find overdue and blocked jobs, inspect their lifecycle, and trace every issue to source events. Built from the supplied synthetic manufacturing log; this is a historical snapshot, not a live factory feed.

Production: https://factory-triage-psi.vercel.app (HTTP Basic credentials supplied separately).

Vercel project: https://vercel.com/yotta-robotics/factory-triage. The private GitHub repository is connected for automatic deployments. The earlier Sites deployment remains available at https://factory-triage-helicon.tanbud16.chatgpt.site.

## Run locally

Requires Node.js **24.x**, matching `package.json` and the Vercel runtime.

```sh
npm ci
cp .env.example .env
# Set BASIC_AUTH_USERNAME and a strong BASIC_AUTH_PASSWORD in .env.
npm run ingest
npm run dev
```

Open `http://localhost:4173` and enter the credentials from `.env`. With both variables configured, HTTP Basic protects the application, API, and CSV exports. Keep `.env` out of Git. Production credentials are runtime secrets, never values embedded in the browser bundle.

For local UI development only, the loopback Node adapter allows access without credentials when no auth variables are configured and prints an explicit notice. Run `npm run dev -- --strict-auth` to refuse that development bypass. The deployed Worker has no development bypass and fails closed with HTTP 503 when required secrets are missing.

```sh
npm test
npm run typecheck
npm run build
```

The build produces a deployable Worker at `dist/server/index.js`. Every route, including HTML, API, icons, and CSV exports, is protected by its HTTP Basic gate. The current Sites deployment is available with the supplied credentials; ChatGPT sign-in is not required. `.openai/hosting.json` retains that project's deployment identity and history.

Source repository: https://github.com/pmeraga/factory-triage (private; owned by `pmeraga`).

## Deploy on Vercel

The GitHub repository `pmeraga/factory-triage` is connected to the Vercel project for automatic deployments from commits. The repository's custom build settings are in `vercel.json`, with Node.js **24.x** and build command `npm run vercel-build`.

Set `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` as runtime secrets for **both Production and Preview**, then deploy or redeploy. Reuse the credentials supplied separately for the existing deployment. Do not put their values in Git, build arguments, or `VITE_` variables. Missing credentials fail closed with HTTP 503.

The custom build regenerates the server dataset, builds the embedded frontend and Worker, and prepares `.vercel-public` with only a fixed, harmless `deployment.txt` marker because Vercel requires a nonempty output directory. The build rejects any other files in that directory. A catch-all route runs before filesystem serving and sends every request, including requests for the marker, to `api/index.mjs`, which forwards them to the same Worker's `fetch` handler and authentication gate. **Do not publish `dist`, `dist-client`, the raw log, or the generated dataset as static assets:** the server bundle contains the manufacturing data. Vercel serves the application through the function, including its HTML and exports.

## Stack and decisions

- **React 19, TypeScript, Vite, Lucide:** responsive queue, job investigation, quality review, and metric definitions.
- **Node.js ingestion:** deterministic, dependency-free normalization of `data/manufacturing_events.jsonl` into a generated dataset.
- **TypeScript Worker API, esbuild:** frontend and server data ship in one deployment artifact. Raw events are returned only through authenticated API routes.
- **Snapshot model:** at 19,519 source rows and 312 jobs, a reproducible build-time model is enough. A separate database, ingestion service, and deployment pipeline would add moving parts without improving this use case. The initially considered Python/DuckDB service was replaced to fit the supported Worker hosting runtime.
- **Evidence before prediction:** the queue uses recorded due dates, priorities, and block transitions. It does not estimate completion dates or claim causal root causes.

## API

All endpoints require HTTP Basic authentication.

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
