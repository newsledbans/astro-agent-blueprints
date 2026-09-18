# salesforce-updater-agent

Turns a Gong sales call into an approved Salesforce Opportunity update.

For comprehensive platform documentation including **critical API usage notes**, run `ast docs`.

## Directory layout

```
agent/
├── index.ts                        # Entry point: Agent definition, instructions, tool bindings, serve()
├── config.ts                       # Environment reading; the write allowlist lives here
├── extraction.ts                   # Zod extraction schema + mapping to Salesforce fields
├── salesforce.ts                   # Salesforce REST client (auth, query, read, PATCH)
├── gong.ts                         # Transcript sources: Gong API, and a sample fallback
└── tools/
    ├── listRecentCalls.ts          # SOQL over Gong__Gong_Call__c — read-only
    ├── fetchTranscript.ts          # Gong transcript by call ID — read-only
    ├── previewOpportunityUpdate.ts # Renders the proposed diff — read-only
    └── writeOpportunityUpdate.ts   # The only mutating tool; gated
astropods.yml                       # Agent spec: model, build, interfaces
Dockerfile                          # Agent container
```

## Conventions

**One mutating tool.** `writeOpportunityUpdate` is the only tool that changes Salesforce. Everything
else is read-only. Keep it that way — it is what makes the approval gate meaningful.

**Guards live in code, not in prompts.** The Opportunity allowlist is enforced in `config.ts` and
checked inside the write tool. Instructions in `index.ts` shape behaviour but are not a security
boundary, so never move a guard into the prompt.

**Preview and write share one mapping.** Both call `mapExtraction()` from `extraction.ts`, so what the
rep approved is necessarily what gets written. If you add a field, add it there and both paths stay in
step.

**Field limits are org facts.** `FIELD_LIMITS` in `extraction.ts` mirrors the Opportunity describe at
api v67.0. Re-check with `sf sobject describe --sobject Opportunity --json` before changing them.

**Empty means empty.** An extraction with nothing for a field omits it from the payload instead of
writing a blank, so a quiet call cannot wipe a human's notes.

**Credentials degrade, they don't crash.** `config.ts` throws nothing at import time. Missing Gong
credentials fall back to the sample transcript; missing Salesforce credentials surface as a tool error
naming the variable to set. The agent must always boot so the playground works.

## Local development

```bash
bun install
export SF_INSTANCE_URL="$(sf org display --json | jq -r .result.instanceUrl)"
export SF_ACCESS_TOKEN="$(sf org display --json | jq -r .result.accessToken)"
export SF_ALLOWED_OPPORTUNITY_IDS="006..."   # a scratch Opportunity, not a live deal
ast dev
```

Requires `bun` on PATH. The container gets it from `oven/bun:1`, but `ast dev` runs locally.

## Testing against Salesforce

This agent targets a **production** org. Keep `SF_ALLOWED_OPPORTUNITY_IDS` pointed at a test
Opportunity while iterating. Leaving it unset is safe: writes are refused rather than attempted.
