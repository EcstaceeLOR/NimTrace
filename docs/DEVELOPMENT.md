# NimTrace development

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- Nimiq Pay on a phone for testing the injected wallet provider

## Install

```bash
npm ci
```

No secret is required for the foundation. Future local-only configuration belongs
in ignored `.dev.vars` or `.env.local` files; commit only documented placeholders
in `.env.example`.

## Run locally

Start the Worker API:

```bash
npm run dev:api
```

It listens on `http://localhost:8787`; its public health endpoint is
`http://localhost:8787/api/health`.

In a second terminal, start the web app:

```bash
npm run dev:web
```

Vite listens on every interface at port `5173` and proxies `/api` to the local
Worker. The browser URL is `http://localhost:5173`.

## Load the local app in Nimiq Pay

Nimiq Pay injects the wallet provider only inside its mini-app WebView. To test on
a physical phone:

1. Put the development computer and phone on the same trusted Wi-Fi network.
2. Start both local processes above.
3. Find the computer's LAN IPv4 address, such as `192.168.1.20`.
4. Confirm `http://<LAN-IP>:5173` opens from the phone's normal browser.
5. In Nimiq Pay, open the Mini Apps area and use its development/custom URL entry
   to load `http://<LAN-IP>:5173`.
6. Use the Nimiq Pay WebView—not a desktop browser—to verify provider injection,
   account approval, signatures, and transactions as those capabilities land.

Never tunnel or expose a development server that contains production secrets.
For HTTPS-only device policies, use a trusted development tunnel and allow only
the exact generated origin.

## Quality commands

```bash
npm run db:migrate:local
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The local migration and first four quality commands run in CI. End-to-end tests are configured separately so
local developers can install and choose a Playwright browser explicitly.
