# Factory Triage

Find overdue and blocked manufacturing jobs, inspect their timelines, and trace issues to source events. Includes delivery and quality summaries, data-quality checks, and filtered CSV exports.

[Open the application](https://factory-triage-psi.vercel.app) · [Source repository](https://github.com/pmeraga/factory-triage)

The application is public and read-only; no login is required. Its synthetic dataset contains 19,519 rows across 312 jobs, with a fixed snapshot clock of August 13, 2026.

## Run locally

Requires Node.js **24.x**.

```sh
npm ci
npm run ingest
npm run dev
```

Open `http://localhost:4173`. To verify and build:

```sh
npm test
npm run typecheck
npm run build
```

## Stack and decisions

- **React 19, TypeScript, Vite, Lucide:** responsive attention queue, job investigation, and quality review.
- **Node.js ingestion:** deterministic normalization of the original JSONL file; repeatable build-time projections suit this small snapshot without a separate database.
- **Fetch API service, esbuild, Vercel Node.js:** one bundled application serves the UI and read-only API. Source files and the server bundle are not published as static assets.
- **Traceable metrics:** block/unblock transitions determine blocked state; completion summaries determine finished-job quality. Exact duplicates are removed, conflicting quantities stay unresolved, and inspection discrepancies remain visible.

The API provides `GET /api/overview`, `GET /api/jobs/:id`, and `GET /api/export`. Overview and export accept search, customer, material, machine, facility, and status filters.

## Data and deployment

This is a historical snapshot. “Open” means no completion event was observed. Recorded exceptions support investigation; they do not establish root causes or predict completion dates. See [DATA_NOTES.md](DATA_NOTES.md) for definitions, reconciliation rules, and limitations.

Vercel deploys from the repository's `main` branch. See [DEPLOYMENT.md](DEPLOYMENT.md) for build and routing details.

For a quick walkthrough, inspect the unresolved missing-tool block on `job_0220`, compare the on-time completion on `job_0080`, then open the quality discrepancy on `job_0068`.
