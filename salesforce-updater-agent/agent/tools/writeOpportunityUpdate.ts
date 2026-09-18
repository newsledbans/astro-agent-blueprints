import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CallExtractionSchema, mapExtraction, toFieldPayload } from '../extraction';
import { updateOpportunity } from '../salesforce';
import { describeWriteAllowlist, isWriteAllowed } from '../config';

/**
 * The only tool that mutates Salesforce. Two independent gates guard it:
 *
 *  1. `requireApproval` — Mastra pauses the run and the Astropods adapter
 *     renders a permission card. The adapter denies the call outright when no
 *     render surface is available, so the gate fails closed.
 *  2. The Opportunity allowlist — enforced here in code, because prompt-level
 *     instructions are not a security boundary. An empty allowlist permits
 *     nothing.
 *
 * It re-derives the payload from the same extraction the preview used, so what
 * the rep approved is necessarily what gets written.
 */
export const writeOpportunityUpdate = createTool({
  id: 'write_opportunity_update',
  description:
    'Write the extracted call details to the Salesforce Opportunity. Requires the rep to approve first. ' +
    'Only call this after preview_opportunity_update and after the rep has explicitly agreed to the changes shown.',
  requireApproval: true,
  inputSchema: z.object({
    opportunityId: z.string().min(15).describe('The Salesforce Opportunity ID to update.'),
    opportunityName: z
      .string()
      .describe('The Opportunity name, so the approval prompt shows the rep which deal is being changed.'),
    extraction: CallExtractionSchema.describe(
      'The same extraction shown in preview_opportunity_update. Do not alter it after the rep approves.',
    ),
  }),
  outputSchema: z.object({
    written: z.boolean(),
    opportunityId: z.string(),
    fieldsWritten: z.array(z.string()),
    message: z.string(),
  }),
  execute: async ({ opportunityId, extraction }) => {
    if (!isWriteAllowed(opportunityId)) {
      return {
        written: false,
        opportunityId,
        fieldsWritten: [],
        message:
          `Refused: ${opportunityId} is not on the write allowlist (currently ${describeWriteAllowlist()}). ` +
          'Add it to SF_ALLOWED_OPPORTUNITY_IDS to permit writes. Tell the rep the write did not happen.',
      };
    }

    const { changes } = mapExtraction(extraction);
    if (changes.length === 0) {
      return {
        written: false,
        opportunityId,
        fieldsWritten: [],
        message: 'Nothing to write — the extraction produced no populated fields.',
      };
    }

    const payload = toFieldPayload(changes);
    await updateOpportunity(opportunityId, payload);

    const fieldsWritten = Object.keys(payload);
    return {
      written: true,
      opportunityId,
      fieldsWritten,
      message: `Updated ${fieldsWritten.length} field(s) on ${opportunityId}: ${fieldsWritten.join(', ')}.`,
    };
  },
});
