# Inngest API CLI

**Binary:** `/usr/local/bin/inngest`
**Subcommand:** `inngest api`

Call Inngest REST API v2 endpoints. Defaults to local dev server (`localhost:8288`). Add `--prod` for Inngest Cloud.

## Environment Variables

| Variable              | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `INNGEST_API_KEY`     | API key for Bearer token auth                   |
| `INNGEST_SIGNING_KEY` | Signing key for Bearer token auth               |
| `INNGEST_ENV`         | Environment name (sent as X-Inngest-Env header) |

## Shared Flags

| Flag            | Description                             |
| --------------- | --------------------------------------- |
| `--prod`        | Target Inngest Cloud Production         |
| `--api-host`    | Custom API host/origin                  |
| `--api-port`    | Custom API port                         |
| `--api-key`     | API key (or `$INNGEST_API_KEY`)         |
| `--signing-key` | Signing key (or `$INNGEST_SIGNING_KEY`) |
| `--env`         | Environment name (or `$INNGEST_ENV`)    |
| `--timeout`     | HTTP request timeout (default: 30s)     |
| `--raw`         | Print unformatted JSON                  |

## Body Input (POST/PATCH commands)

- **`--body '{"key":"value"}'`** — Raw JSON string
- **`--body-file path.json`** — JSON file (`-` for stdin)
- **Individual flags** — Override matching keys in `--body`/`--body-file`

---

## Subcommands

### Health & Account

```bash
inngest api health                    # Health check (local or --prod)
inngest api get-account               # Account info
inngest api get-account-envs          # List environments
inngest api get-account-event-keys    # List event keys
inngest api get-account-signing-keys  # List signing keys
```

### Environments

```bash
inngest api create-env --name "staging"                      # Create environment
inngest api patch-env --id "env-id" --is-archived            # Archive environment
```

### Function Runs (Debugging)

```bash
# Get run details (positional arg or --run-id)
inngest api get-function-run <run-id> --include-output

# Get execution trace with step outputs
inngest api get-function-trace <run-id> --include-output

# Get all runs triggered by an event
inngest api get-event-runs <event-id> --include-output
```

| Flag               | Description                            |
| ------------------ | -------------------------------------- |
| `--run-id`         | Run ID (or positional arg)             |
| `--event-id`       | Event ID (or positional arg)           |
| `--include-output` | Include run/step output in response    |
| `--cursor`         | Pagination cursor                      |
| `--limit`          | Results per page (1–40 for event-runs) |

### Function Invocation

```bash
inngest api invoke-function --app-id my-app --function-id my-func \
  --data '{"userId": "123"}'
```

| Flag                | Description                          |
| ------------------- | ------------------------------------ |
| `--app-id`          | App ID (required, or positional arg) |
| `--function-id`     | Function ID (required)               |
| `--data`            | JSON input data                      |
| `--idempotency-key` | Optional idempotency key             |

### App Sync

```bash
inngest api sync-app --app-id my-app --url http://localhost:3000/api/inngest
```

| Flag       | Description                          |
| ---------- | ------------------------------------ |
| `--app-id` | App ID (required, or positional arg) |
| `--url`    | App's Inngest serve endpoint URL     |

### Webhooks

```bash
inngest api create-webhook --name "Stripe" \
  --transform 'function transform(evt) { return { name: "stripe/" + evt.type, data: evt }; }'
inngest api get-webhooks
```

### Insights (Analytics)

```bash
# List available tables
inngest api get-insights-tables

# List event schemas
inngest api get-insights-event-schemas

# Natural language → SQL query
inngest api query-insights-prompt --prompt "top 10 slowest functions in 24 hours"

# Direct SQL query
inngest api query-insights --query "SELECT function_id, count() as runs FROM function_runs GROUP BY function_id ORDER BY runs DESC LIMIT 10"
```

---

## Common Workflows

### Debug a failed run

```bash
inngest api get-function-run --prod <run-id> --include-output
inngest api get-function-trace --prod <run-id> --include-output
```

### Find runs from an event

```bash
inngest api get-event-runs --prod <event-id> --include-output
```

### Manually trigger a function

```bash
inngest api invoke-function --prod --app-id my-app --function-id my-func --data '{"key": "value"}'
```

### Sync an app after deploy

```bash
inngest api sync-app --prod --app-id my-app --url https://myapp.com/api/inngest
```

## Tips

- **Positional args:** Most path params (run-id, event-id, app-id) work as positional args.
- **Pipe-friendly:** `--raw` gives unformatted JSON for piping to `jq`.
- **Self-hosted:** Use `--api-host` and `--api-port` to target a self-hosted server.
- **Stdin body:** `--body-file -` reads JSON body from stdin.
