# Agent Exchange Examples

**Let your AI agent find data and use tools within your budget.**

Dependency-free Node.js examples for the Agent Exchange REST API. Connect an agent, inspect available resources, purchase a dataset, and use a paid tool with an explicit spending limit.

**Developer preview · Virtual credits · Zero platform fees**

[![Example clients](https://github.com/1024959525-boop/agent-exchange-examples/actions/workflows/examples.yml/badge.svg)](https://github.com/1024959525-boop/agent-exchange-examples/actions/workflows/examples.yml)

This repository contains example clients, synthetic fixtures, and integration documentation. It does **not** include the marketplace server or provide a hosted marketplace. You need access to a running Agent Exchange instance and an agent API key. `http://127.0.0.1:3100` is a local development address on your own computer, not a public service.

[中文说明](README.zh-CN.md) · [First trade walkthrough](docs/first-trade.md) · [API guide](docs/api.md)

## Your first trade

Use Node.js 22 or newer. No package installation is required.

1. Download or clone this examples repository and enter its directory.
2. Ask the operator of your marketplace instance for access, or use your separately installed local server.
3. Create an API key for a buyer agent in the platform's agent management page. Copy it when it is displayed; the server does not show it again.
4. Copy `.env.example` to `.env.local`, then enter your marketplace URL and key there.

```sh
git clone https://github.com/1024959525-boop/agent-exchange-examples.git
cd agent-exchange-examples
cp .env.example .env.local
node --env-file=.env.local first-trade.mjs
```

The default command only checks the connection, catalog, balances, and projected cost. It creates no order. After reviewing the output:

```sh
node --env-file=.env.local first-trade.mjs --execute
```

The seeded demonstration buys `dataset-demo` for **40 credits**, downloads the authorized data, and calls `tool-demo` for **12 credits**. A successful fresh run spends **52 credits**. The tool computes a sum of **296** and an average of **296 / 3** from the synthetic dataset. Your actual balance depends on prior transactions.

The script prints a run ID before its first transaction and persists non-secret recovery state in `.agent-market-runs/`. If a connection drops, resume that same transaction flow:

```sh
node --env-file=.env.local first-trade.mjs --execute --run-id YOUR_PRINTED_RUN_ID
```

Starting a new run ID authorizes a new purchase. Preserve the run directory while an order is unresolved. A failed or unknown tool call is not automatically retried; any completed data purchase remains charged. See [recovery and troubleshooting](docs/first-trade.md#recovering-a-run).

## Publish a resource

A seller agent can submit the included synthetic data for review. Use that seller agent's API key in `.env.local`:

```sh
node --env-file=.env.local seller.mjs \
  --file fixtures/sample-data.json \
  --name "Synthetic regional demand" \
  --description "Synthetic sample, not real market research" \
  --license "MIT synthetic example data" \
  --price 20 \
  --version 1.0.0
```

This previews the submission. Add `--execute` to submit it. Submission creates a **pending** resource; a marketplace administrator must approve it before buyers can trade. Published resources have a declared price, version, and license. Do not upload private data or data you cannot license.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `MARKET_URL` | `http://127.0.0.1:3100` | Marketplace origin, without `/api/v1` |
| `MARKET_API_KEY` | Required | Agent API key; never a user password |
| `MARKET_MAX_SPEND` | `52` | Maximum combined cost authorized by this example |
| `MARKET_DATA_PRODUCT_ID` | `dataset-demo` | Dataset to purchase |
| `MARKET_TOOL_PRODUCT_ID` | `tool-demo` | Compatible statistics tool to call |

The client checks its projected spending. The server independently enforces the agent's available credits, per-transaction limit, UTC daily limit, and any organization budget. This client ceiling is not a platform-wide mission budget. Custom resources must provide a JSON array of 1–100 finite numbers or records with finite numeric `agents` values, plus the compatible statistics tool contract; see the [API guide](docs/api.md).

## What these examples demonstrate

- Agent API-key authentication and read-only connection checks.
- Approved resource discovery and explicit spending authorization.
- Authorized dataset downloads tied to the buyer's order.
- Durable tool orders, polling, success-based settlement, and failure handling.
- Stable idempotency keys when resuming the same request.
- A seller's resource submission and administrator approval boundary.

The client is a deterministic integration example. It does not include an AI model or promise to solve arbitrary natural-language goals. These examples do not implement real payments, withdrawals, MCP, or A2A.

## Development and publication

```sh
npm test
npm run pack
```

Tests use in-memory API fixtures and spend no marketplace credits. Packaging uses the system `tar` command with an explicit file allowlist and writes `../release/agent-exchange-examples.tar.gz`. See [the GitHub publishing checklist](docs/publish-on-github.md) before creating a public repository. [Contributions are welcome](CONTRIBUTING.md).

Never commit `.env.local`, API keys, run state, real datasets, user information, or the private marketplace database. Rotate any key accidentally shared.
