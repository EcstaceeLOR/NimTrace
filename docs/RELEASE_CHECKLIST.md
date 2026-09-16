# Release and monitoring checklist

## Before submission

- [x] Public MIT repository and clean tracked-secret scan
- [x] Production Worker, static Mini App, D1 migrations, HTTPS, and health check
- [x] Same-origin CORS, security headers, RPC fallback, and fixed image fallback
- [x] CI lint, typecheck, migrations, unit/integration tests, and builds
- [ ] Two-phone Nimiq Pay payment/transfer/background-resume run
- [ ] 60–90 second demo video uploaded and linked
- [ ] Skool and public social posts published and linked
- [ ] 25 legitimate wallet opens and 10 tester feedback records completed
- [ ] Clean Nimiq Pay installation opens the submitted production URL

Do not check an external item without evidence. Never substitute a fake success
screen, bot traffic, or repeated opens for the required real-world result.

## Post-submission owner

Repository owner `EcstaceeLOR` owns monitoring through judging: check
`/api/health`, the public verification route, Cloudflare Worker errors, D1
availability, and RPC degradation at least twice daily. Roll back to the prior
Worker version if a release breaks authentication, payment verification, or
passport reads. Record incident time, affected flow, Worker version, mitigation,
and recovery in a GitHub issue without posting wallet addresses or signatures.
