# Vercel deployment

- Production: https://factory-triage-psi.vercel.app
- Project: https://vercel.com/yotta-robotics/factory-triage
- Git repository: https://github.com/pmeraga/factory-triage
- Production branch: `main`
- Runtime: Node.js 24.x
- Build: `npm run vercel-build`

Production and Preview have `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` configured as sensitive runtime variables. Credentials are supplied separately. The API adapter forwards every request to the existing authentication gate; neither the source dataset nor the generated server bundle is served as a static file.

Vercel requires a nonempty static output directory. The build writes only a harmless `deployment.txt` marker to `.vercel-public` and rejects other files. The catch-all route runs before filesystem handling, so the marker also passes through authentication.

Git deployments require a commit author with project access. This checkout uses the authorized `pmeraga` GitHub account's noreply email in repository-local Git configuration. Other repositories' Git settings are unchanged.

Verification: 16 automated tests, TypeScript, the Vercel provider build, and authenticated/unauthenticated production API checks passed. The live checks also verify that source and data file paths cannot be downloaded.
