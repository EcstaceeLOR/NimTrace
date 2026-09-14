# Nimiq Pay wallet adapter

All Nimiq Pay integration lives in `apps/web/src/lib/nimiq`. Feature code uses
`NimiqPayWalletAdapter` instead of importing the Mini App SDK directly. The
adapter is pinned to `@nimiq/mini-app-sdk` 0.1.0 and supports:

- account connection through `listAccounts()`;
- readable message signing through `sign()`;
- integer-Luna tagged payments through `sendBasicTransactionWithData()`;
- consensus and current-block checks;
- optional, consented device identifiers; and
- encoded `nimiqpay://miniapp` fallback links.

The public application never initializes the provider during page render. A
wallet call happens only after an explicit user action. Outside Nimiq Pay, the
same public content remains available and the wallet action offers a deep link
back to the current HTTP or HTTPS route.

## Outcomes

Every operation returns a discriminated outcome instead of leaking SDK-specific
errors into feature code:

- `success` contains the normalized provider value;
- `cancelled` means the user declined the native dialog and nothing should be
  treated as failed, signed, or paid; and
- `error` contains a stable code, safe message, and retryable flag.

| Code | Meaning |
| --- | --- |
| `PROVIDER_MISSING` | The action was opened outside Nimiq Pay. |
| `REQUEST_TIMEOUT` | Provider injection or a wallet request exceeded its bound. |
| `INVALID_TRANSACTION` | Nimiq Pay rejected transaction parameters. |
| `NETWORK_FAILURE` | The provider could not reach the network. |
| `CONSENSUS_UNAVAILABLE` | The wallet is not synchronized yet. |
| `CONFIRMATION_DELAYED` | Submission succeeded but independent confirmation is pending. |
| `INVALID_PROVIDER_RESPONSE` | The provider returned a malformed value. |
| `INVALID_REQUEST` | NimTrace attempted an unsafe or incomplete request. |
| `UNKNOWN` | The provider returned an unrecognized failure. |

`USER_CANCELLED` is exposed only on the `cancelled` outcome. It must not be
reported as an application failure.

## Safety rules

- Amounts and optional fees are safe integer Luna values; no floating point NIM
  value crosses the adapter boundary.
- Recipient, amount, data tag, fee, and validity height are passed to the SDK
  exactly as supplied by the server-controlled workflow.
- A returned transaction identifier means submitted, not confirmed. The API and
  RPC verifier remain authoritative for confirmation.
- A device identifier is optional, identifies a device rather than a wallet,
  and is requested only with a user-visible reason. Outside the host it resolves
  to `null`.
- Raw provider errors are not displayed directly because they can vary between
  SDK and Nimiq Pay versions.

## Test commands

```bash
npm run typecheck --workspace @nimtrace/web
npm run test:unit --workspace @nimtrace/web
```

On Windows machines where process creation is unusually slow, the same suite can
be run serially:

```bash
node_modules/.bin/vitest run --config apps/web/vitest.config.ts --pool=threads --maxWorkers=1
```
