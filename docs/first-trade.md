# Complete your agent's first trade

[Back to README](../README.md)

This walkthrough connects an external Node.js client to an existing Agent Exchange server. It uses synthetic seeded resources and virtual credits. No AI model, paid model subscription, or package installation is required.

## 1. Obtain a running marketplace and a buyer key

The examples repository does not start or include the server. Ask a marketplace operator for its URL and an account, or start your separately installed local instance. A URL beginning with `127.0.0.1` points to your computer; it cannot be used to reach somebody else's installation.

For a local installation with the seeded resources:

1. Open `http://127.0.0.1:3100`.
2. Sign in with a test account supplied privately by the marketplace operator, or register your own account. This repository does not publish account credentials.
3. Open agent management and select or create a buyer agent you are authorized to operate. Ask the operator to grant test credits if its wallet is empty.
4. Set a per-transaction limit of at least **40** credits. Confirm at least **52** available credits and **52** remaining daily credits. A shared organization limit, if applicable, must also permit the purchases.
5. Create an agent API key and copy the one-time display. An account password is not an API key.
6. Confirm the marketplace worker is running. Data purchases settle immediately; tool execution requires the worker.

The key represents that agent's permissions and wallet. Use an operator-approved test account and obtain access details privately. Keep account credentials out of public documentation and issue reports.

## 2. Configure the examples

Inside this repository:

```sh
node --version
cp .env.example .env.local
```

Node.js must be version 22 or newer. Edit `.env.local` in your editor:

```dotenv
MARKET_URL=http://127.0.0.1:3100
MARKET_API_KEY=replace_with_your_agent_api_key
MARKET_MAX_SPEND=52
MARKET_DATA_PRODUCT_ID=dataset-demo
MARKET_TOOL_PRODUCT_ID=tool-demo
```

For a reachable remote instance, use the URL and resource IDs provided by its operator. The client requires HTTPS for remote connections and permits HTTP only on loopback development addresses. Keep the environment file private. Do not paste keys into screenshots, issue reports, or shell commands recorded in history.

## 3. Preview without creating orders

```sh
node --env-file=.env.local first-trade.mjs
```

The preview checks authentication, catalog entries, approved status, compatible resource types, price, balance, budgets, and worker availability. Review the actual IDs and prices before continuing. The default combined client ceiling is 52 credits; the server enforces its own per-order and daily limits independently.

## 4. Authorize the transaction

```sh
node --env-file=.env.local first-trade.mjs --execute
```

The client:

1. Prints a run ID and saves recovery state before its first write.
2. Purchases the dataset with a stable idempotency key saved for that run.
3. Downloads data through the buyer's authorized order.
4. Extracts the dataset's numeric `agents` values (or values from a numeric array).
5. Creates a tool order with a second stable idempotency key.
6. Polls the order until the worker returns a terminal result, or the client stops waiting.
7. Reports the result and actual balance.

Illustrative result for a fresh seeded buyer, **not a guarantee of your current balance or literal CLI output**:

```text
Data purchase: 40 virtual credits
Tool call: 12 virtual credits
Tool status: succeeded
sum: 296
average: 98.66666666666667
Buyer balance: 1000 -> 948
Held credits after settlement: 0
```

Data purchases are charged upon delivery. Tool fees are frozen first and settled only after a successful, validated result. A later tool failure does not undo a completed data purchase.

## Recovering a run

Copy the run ID printed before the trade:

```sh
node --env-file=.env.local first-trade.mjs --execute --run-id YOUR_PRINTED_RUN_ID
```

Use the same marketplace URL, agent, resource configuration, and spending ceiling. Keep the corresponding state file under `.agent-market-runs/`. It contains order/recovery information, not the API key; it can still contain private transaction details and is excluded from public packaging.

The same run uses the same request keys, so an interrupted request can be replayed to obtain its original result. Idempotency does not mean “never pay twice across all runs”: a new run ID is a new transaction authorization. Do not change request content under an existing key.

If the tool order is still `pending` or `running`, query it and resume polling. A client timeout does not establish that the server failed. If the tool order is `failed`, `unknown`, or `cancelled`, inspect the order and stop. Do not automatically start a new tool call. `unknown` may mean an external executor acted but its result could not be established; frozen credits are released without automatically retrying that execution.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Connection refused | Start the separate marketplace, verify its port, or obtain a reachable URL. Downloading this repository does not start a server. |
| HTTP 401 | Check that `.env.local` is loaded and contains an active agent API key. A revoked key, account password, or placeholder will not authenticate. |
| HTTP 403 | Use the owning buyer agent for order downloads. Check organization membership and operator permissions. |
| HTTP 404 for a resource | Confirm the ID and that the administrator approved it. Withdrawn resources cannot receive new trades. |
| HTTP 409 | Read the returned reason: insufficient balance, per-order/daily/shared budget, unconfigured tool, or conflicting idempotency content. Daily limits use UTC. |
| Worker unavailable or order stays pending | Have the operator start the worker. Resume the same run instead of placing another order. |
| Client stops waiting | Look up the existing order; preserve its run ID and state. A network/client timeout is not proof of failed execution. |
| Tool fails validation | Confirm the dataset contains finite numeric `agents` values and the tool accepts `{ "values": [...] }`. Custom resources must match this example's contract. |

When requesting help, include the command without secrets, HTTP status, resource IDs, and order status. Remove keys, cookies, environment file contents, and private downloaded data. The [API guide](api.md) shows how these requests fit together.
