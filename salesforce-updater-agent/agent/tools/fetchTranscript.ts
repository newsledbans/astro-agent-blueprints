import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolveTranscriptSource } from '../gong';

/**
 * Gong's Salesforce package stores call metadata but no transcript text, so
 * the full transcript has to come from the Gong API. Falls back to fixture
 * text when credentials are absent, and says so in the output.
 */
export const fetchTranscript = createTool({
  id: 'fetch_transcript',
  description:
    'Fetch the full transcript for a Gong call by its Gong call ID. Use the gongCallId returned by list_recent_calls. ' +
    'Read the transcript carefully before proposing any Salesforce update.',
  inputSchema: z.object({
    gongCallId: z.string().min(1).describe('The Gong call ID, from list_recent_calls.'),
  }),
  outputSchema: z.object({
    transcript: z.string(),
    source: z.enum(['gong-api', 'sample']),
    characterCount: z.number(),
    warning: z.string().nullable(),
  }),
  execute: async ({ gongCallId }) => {
    const source = resolveTranscriptSource();
    const transcript = await source.fetchTranscript(gongCallId);

    return {
      transcript,
      source: source.kind,
      characterCount: transcript.length,
      warning:
        source.kind === 'sample'
          ? 'This is FIXTURE text, not a real call. Gong credentials are not configured (set GONG_ACCESS_KEY and GONG_SECRET). ' +
            'Tell the rep plainly that this is sample data before proposing any write.'
          : null,
    };
  },
});
