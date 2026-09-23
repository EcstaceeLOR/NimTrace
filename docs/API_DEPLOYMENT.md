# Production API deployment

NimTrace production uses two independently deployed surfaces:

- `https://nimtrace.vercel.app` — React/Vite frontend on Vercel.
- `https://nimtrace-api.nimtrace.workers.dev` — Hono API on Cloudflare Workers with D1 and R2 bindings.

`vercel.json` proxies `/api/*` from the frontend domain to the Worker. Deploying Vercel **does not deploy the Worker**. Any change under `apps/api/**` or a contract change consumed by the API must therefore be deployed to Cloudflare as well.

## One-command local deployment

From the repository root, authenticated with Wrangler:

```bash
npm ci
npm run deploy:api
```

The Worker name and production D1/R2 bindings come from `apps/api/wrangler.jsonc`.

## GitHub Actions deployment

The repository includes **Deploy API Worker** (`.github/workflows/deploy-api.yml`). Configure these repository/environment secrets once:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Then run **Actions → Deploy API Worker → Run workflow** from `main`.

The workflow typechecks and tests the API before deployment. It deploys the current Git commit SHA as the Worker `APP_VERSION` and verifies `/api/health` reports the same SHA afterward. This prevents a newer frontend from silently running against an older API.

## Release rule

For any release that changes catalogue state, checkout, payment verification, passports, D1 queries, or R2 behavior:

1. Merge only after CI is green.
2. Deploy the Cloudflare Worker from the same `main` commit.
3. Verify `https://nimtrace-api.nimtrace.workers.dev/api/health` reports that commit SHA as `version`.
4. Deploy or refresh the Vercel frontend if frontend code changed.
5. Run the two-device checkout smoke test.

A Vercel-only deploy is insufficient for backend changes.
