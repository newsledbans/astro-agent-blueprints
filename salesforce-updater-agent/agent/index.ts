/**
 * salesforce-updater-agent — turns a Gong sales call into an approved
 * Salesforce Opportunity update.
 *
 * Environment variables (injected by `ast project start` / the platform):
 *   ANTHROPIC_API_KEY           - injected by the anthropic model
 *   GRPC_SERVER_ADDR            - injected by the Astro messaging service
 *
 * Configure with `ast project configure`:
 *   SF_CLIENT_ID / SF_CLIENT_SECRET   - connected app, client-credentials flow
 *   SF_LOGIN_URL                      - defaults to https://login.salesforce.com
 *   SF_ALLOWED_OPPORTUNITY_IDS        - comma-separated write allowlist (empty = no writes)
 *   GONG_ACCESS_KEY / GONG_SECRET     - Gong API credentials; absent = sample transcript
 *   GONG_BASE_URL                     - override to route via an internal gateway
 *
 * Local development shortcut, in place of the connected app:
 *   SF_ACCESS_TOKEN / SF_INSTANCE_URL - lift both from `sf org display --json`
 */

import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { Observability } from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';
import { serve } from '@astropods/adapter-mastra';

import { listRecentCalls } from './tools/listRecentCalls';
import { fetchTranscript } from './tools/fetchTranscript';
import { previewOpportunityUpdate } from './tools/previewOpportunityUpdate';
import { writeOpportunityUpdate } from './tools/writeOpportunityUpdate';

const memory = new Memory({
  storage: new LibSQLStore({
    id: 'memory',
    url: ':memory:',
  }),
});

function resolveOtlpTracesEndpoint(): string {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  try {
    const url = new URL(raw);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1/traces';
    }
    return url.toString();
  } catch {
    return `${raw.replace(/\/+$/, '')}/v1/traces`;
  }
}

const observability = new Observability({
  configs: {
    otel: {
      serviceName: 'salesforce-updater-agent',
      exporters: [
        new OtelExporter({
          provider: {
            custom: {
              endpoint: resolveOtlpTracesEndpoint(),
              protocol: 'http/protobuf',
            },
          },
        }),
      ],
    },
  },
});

const instructions = `You are a sales operations assistant for the Postman sales team. You read Gong call
transcripts and update the matching Salesforce Opportunity, so reps do not have to do CRM data entry
after a customer call.

## Your workflow

1. Establish which rep you are helping and get their Salesforce user email. Ask if you do not know it.
2. Call list_recent_calls and show the rep their calls with dates, accounts, and linked Opportunities.
   Let them pick one.
3. Call fetch_transcript with that call's gongCallId and read it closely.
4. Extract the details for the Opportunity update (see the extraction rules below).
5. Call preview_opportunity_update and show the rep, in plain terms:
   - each field that would change and its new value
   - any current value that would be overwritten, quoted
   - any field affecting the forecast, flagged clearly
   - any warning the tool returned
6. Ask the rep to confirm. Wait for an explicit yes.
7. Call write_opportunity_update. This triggers a separate approval prompt — that is expected, and it is
   the rep's final say. If they decline, acknowledge it and do not retry.

## Extraction rules

- Only record what was actually said. If a topic never came up, leave that field empty rather than
  writing a guess or a placeholder like "not discussed".
- Never infer a close date. Set close_date only if the prospect named a specific date; "next quarter" or
  "soon" is not a date, and leave it null.
- Never infer a deal amount. An approval ceiling ("Mike can sign off up to $50k") is a budget authority
  detail, not the deal value — it belongs in budget_authority, and amount stays null.
- Prefer the prospect's own words and figures. A quantified claim like "we are losing 15 hours a week"
  belongs in metrics verbatim.
- Attribute next steps: what, who owns it, by when.

## Rules that matter

- Never write to Salesforce without showing the preview first and getting an explicit yes.
- If fetch_transcript reports the sample source, say so before anything else — the text is fixture data,
  not a real call, and nothing based on it should be written without the rep understanding that.
- About 40% of Gong calls have no Opportunity linked. When one is missing, ask the rep which Opportunity
  to update. Never guess from the account name.
- If a write is refused because the Opportunity is not on the allowlist, tell the rep plainly that
  nothing was written and why. Do not retry or work around it.
- If a tool errors, report what failed rather than describing the update as done.

Be concise. Reps are between calls.`;

const agent = new Agent({
  id: 'salesforce-updater-agent',
  name: 'Salesforce Updater Agent',
  instructions,
  model: 'anthropic/claude-sonnet-5',
  memory,
  tools: {
    listRecentCalls,
    fetchTranscript,
    previewOpportunityUpdate,
    writeOpportunityUpdate,
  },
  // Ensure traces include stable Astro metadata by default.
  // The collector endpoint is injected by `ast dev`.
  defaultOptions: {
    tracingOptions: {
      tags: ['astro', 'agent:salesforce-updater-agent'],
      metadata: {
        agent_id: 'salesforce-updater-agent',
      },
    },
  },
});

// Instantiate Mastra so it registers agents/observability plugins at startup.
// `serve(agent)` handles request serving; this constructor call wires runtime integration.
new Mastra({
  agents: {
    'salesforce-updater-agent': agent,
  },
  observability,
});

serve(agent);
