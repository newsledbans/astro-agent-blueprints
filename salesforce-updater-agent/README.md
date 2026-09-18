# salesforce-updater-agent

Turns a Gong sales call into an approved Salesforce Opportunity update, so reps skip the post-call CRM
data entry.

A rep picks a call from their recent Gong calls, the agent reads the transcript and extracts what
belongs on the Opportunity, shows exactly what would change, and writes it only after the rep approves.

## Quick start

```bash
# Install dependencies
bun install

# Start the agent locally
ast dev
```

The playground is at `localhost:3100`. With no credentials configured the agent still boots and serves
a clearly-labelled sample transcript, so the extraction and approval flow is usable immediately.

## Project structure

```
salesforce-updater-agent/
├── agent/
│   ├── index.ts          # Agent entry point
│   ├── config.ts         # Environment + write allowlist
│   ├── extraction.ts     # Extraction schema and Salesforce field mapping
│   ├── salesforce.ts     # Salesforce REST client
│   ├── gong.ts           # Gong transcript source (+ sample fallback)
│   └── tools/            # The four agent tools
├── astropods.yml         # Agent specification
├── Dockerfile            # Agent container
├── .env                  # Environment variables (set via ast configure; not committed)
└── package.json
```

## Configuration

### Integrations

| Integration | Type | Environment variables |
|------------|------|----------------------|
| Anthropic | Model API | `ANTHROPIC_API_KEY` |
| Salesforce | REST API (connected app) | `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_LOGIN_URL` |
| Gong | REST API (basic auth) | `GONG_ACCESS_KEY`, `GONG_SECRET`, `GONG_BASE_URL` |

### Settings

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SF_ALLOWED_OPPORTUNITY_IDS` | for writes | _(empty)_ | Comma-separated Opportunity IDs the agent may write to. **Empty means no writes are permitted.** Accepts 15- or 18-character IDs. |
| `SF_API_VERSION` | no | `v67.0` | Salesforce REST API version. |
| `SF_LOGIN_URL` | no | `https://login.salesforce.com` | Token endpoint host. |
| `GONG_BASE_URL` | no | `https://api.gong.io` | Override to route through an internal gateway. |
| `SF_ACCESS_TOKEN` / `SF_INSTANCE_URL` | no | — | Local-dev shortcut in place of the connected app. Lift both from `sf org display --json`. |

Set them with `ast project configure`.

### Interfaces

- **Web** — HTTP/SSE endpoint (playground available at `localhost:3100` during dev)

## Safety model

Salesforce writes pass three independent gates:

1. **Read-only preview.** `preview_opportunity_update` reports every proposed change, quotes any
   existing value that would be overwritten, and flags fields that move the forecast.
2. **Runtime approval.** `write_opportunity_update` uses Mastra's `requireApproval`, so the platform
   renders a permission card. If no render surface is available the adapter **denies** the call, so the
   gate fails closed.
3. **Allowlist.** Writes are restricted to `SF_ALLOWED_OPPORTUNITY_IDS`, enforced in code rather than by
   prompt instruction.

> This agent is configured against a **production** Salesforce org. Keep the allowlist pointed at a test
> Opportunity until you are satisfied with extraction quality.

## Requirements and caveats

- **Gong API access is required for real transcripts.** Gong's Salesforce managed package syncs call
  metadata but no transcript text. Without `GONG_ACCESS_KEY` and `GONG_SECRET` the agent returns a
  sample transcript and says so.
- **Gong's synced summaries are not a substitute.** In a 200-call sample from this org, only 23% had a
  substantive `Gong__Call_Brief__c`, 4% had next steps, and none had action items.
- **About 40% of calls have no linked Opportunity.** The agent asks which record to update rather than
  inferring one from the account.
- **`bun` must be on PATH** for `ast dev`. The container provides it via `oven/bun:1`.
