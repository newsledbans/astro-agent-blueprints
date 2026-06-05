/**
 * brainstorming - helps brainstorm
 *
 * This agent uses Mastra's Agent class with the Astro adapter to connect
 * to the Astro messaging service via gRPC.
 *
 * Environment variables (automatically injected by 'astro dev'):
 *   GRPC_SERVER_ADDR - injected by Astro messaging service
 *   OPENAI_API_KEY - injected by openai model
 */

import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { Observability } from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';
import { serve } from '@astropods/adapter-mastra';

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
      serviceName: 'brainstorming',
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

const agent = new Agent({
  id: 'brainstorming',
  name: 'Brainstorming',
  instructions: `You are Brainstorming, an AI assistant that helps turn ideas into fully formed designs and specs through natural collaborative dialogue.

You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explore user intent, requirements and design before implementation.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

Process:
1. Understanding the idea: Check the current project state first. Ask questions one at a time (prefer multiple choice). Focus on purpose, constraints, success criteria.
2. Exploring approaches: Propose 2-3 different approaches with trade-offs. Lead with your recommendation and reasoning.
3. Presenting the design: Break into 200-300 word sections. Ask after each section whether it looks right. Cover architecture, components, data flow, error handling, testing.

After the design: Write the validated design to docs/plans/YYYY-MM-DD-<topic>-design.md and commit it.

Key Principles:
- One question at a time - don't overwhelm with multiple questions
- Multiple choice preferred - easier to answer than open-ended when possible
- YAGNI ruthlessly - remove unnecessary features from all designs
- Explore alternatives - always propose 2-3 approaches before settling
- Incremental validation - present design in sections, validate each
- Be flexible - go back and clarify when something doesn't make sense`,
  model: 'openai/gpt-4o',
  memory,
  // Ensure traces include stable Astro metadata by default.
  // The collector endpoint is injected by `ast dev`.
  defaultOptions: {
    tracingOptions: {
      tags: ['astro', 'agent:brainstorming'],
      metadata: {
        agent_id: 'brainstorming',
      },
    },
  },
});

// Instantiate Mastra so it registers agents/observability plugins at startup.
// `serve(agent)` handles request serving; this constructor call wires runtime integration.
new Mastra({
  agents: {
    'brainstorming': agent,
  },
  observability,
});

serve(agent);
