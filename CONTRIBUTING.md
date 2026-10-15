# Contributing

Thanks for helping make Agent Exchange easier to integrate.

This repository contains dependency-free Node.js 22+ clients and synthetic fixtures. Keep improvements focused on examples and documentation; the marketplace server and its private database are maintained separately.

## Before a pull request

```sh
npm test
npm run pack
```

Tests should use isolated mocks and require no live keys, internet service, or virtual-credit spending. If your change needs a manual integration check, describe the separate server prerequisites, exact steps, and actual result. Clearly distinguish a mocked test from a real server transaction.

Keep read-only mode the default. Writes must require explicit authorization, stable idempotency keys, bounded requests, and useful failure messages. Do not automatically retry tool orders with a failed or unknown execution result. Never log authorization headers or save credentials in recovery state.

Update the English README and first-trade guide when changing commands or environment variables. Keep the Chinese README consistent where it describes the same behavior. Prefer a small, runnable example over adding a framework dependency.

## Reporting an issue

Include your Node.js version, operating system, command with secrets removed, error/status code, and expected behavior. If relevant, include the resource IDs and order status. Do not include API keys, cookies, `.env.local`, real datasets, or private transaction records.

If you discover a credential leak, revoke the affected key first. Do not post the leaked value in a public issue. Use a private security reporting channel if the repository owner has configured one; otherwise provide a redacted description and request a private contact method.
