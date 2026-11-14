# Factory Triage

A manufacturing operations desk: find overdue and blocked jobs, inspect their lifecycle, and trace every issue to source events. Built from the supplied synthetic manufacturing log; this is a historical snapshot, not a live factory feed.

Deployment: https://factory-triage-helicon.tanbud16.chatgpt.site (HTTP Basic credentials supplied separately).

## Run locally

Requires Node.js 22 or later.

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

The build produces a deployable Worker at `dist/server/index.js`. `.openai/hosting.json` identifies its Sites project. Sites publication stores the pushed source commit and deployment artifact. The deployment is available to anyone with the supplied HTTP Basic credentials; ChatGPT sign-in is not required. Every route, including HTML, API, icons, and CSV exports, is protected by the Worker.

Source repository: https://github.com/pmeraga/factory-triage (private; owned by `pmeraga`).

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
