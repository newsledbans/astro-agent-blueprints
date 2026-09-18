import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CallExtractionSchema, mapExtraction } from '../extraction';
import { getOpportunityFields } from '../salesforce';
import { describeWriteAllowlist, isWriteAllowed } from '../config';

/** Trim a current value down to something readable in chat. */
function preview(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/**
 * Read-only counterpart to the write tool. Shows the rep what would change and
 * — critically — what is about to be overwritten, which the approval card
 * cannot convey on its own because it only renders the incoming arguments.
 */
export const previewOpportunityUpdate = createTool({
  id: 'preview_opportunity_update',
  description:
    'Show the rep exactly what would change on the Opportunity, including which existing field values would be ' +
    'overwritten. Always call this and show the result before calling write_opportunity_update. Writes nothing.',
  inputSchema: z.object({
    opportunityId: z.string().min(15).describe('The Salesforce Opportunity ID to update.'),
    extraction: CallExtractionSchema.describe('What you extracted from the transcript.'),
  }),
  outputSchema: z.object({
    opportunityName: z.string().nullable(),
    currentStage: z.string().nullable(),
    changes: z.array(
      z.object({
        field: z.string(),
        label: z.string(),
        forecast: z.boolean(),
        newValue: z.union([z.string(), z.number()]),
        currentValue: z.string().nullable(),
        overwritesExistingContent: z.boolean(),
      }),
    ),
    warnings: z.array(z.string()),
    writeAllowed: z.boolean(),
    allowlistNote: z.string(),
  }),
  execute: async ({ opportunityId, extraction }) => {
    const { changes, warnings } = mapExtraction(extraction);

    const record = await getOpportunityFields(opportunityId, [
      'Name',
      'StageName',
      ...changes.map((change) => change.field),
    ]);

    const detailed = changes.map((change) => {
      const currentValue = preview(record[change.field]);
      return {
        field: change.field,
        label: change.label,
        forecast: change.forecast,
        newValue: change.value,
        currentValue,
        overwritesExistingContent: currentValue !== null,
      };
    });

    const overwrites = detailed.filter((change) => change.overwritesExistingContent);
    const allWarnings = [...warnings];

    if (overwrites.length > 0) {
      allWarnings.push(
        `${overwrites.length} field(s) already contain content and would be replaced: ` +
          `${overwrites.map((change) => change.label).join(', ')}. Show the rep the current values before writing.`,
      );
    }

    const forecastChanges = detailed.filter((change) => change.forecast);
    if (forecastChanges.length > 0) {
      allWarnings.push(
        `${forecastChanges.map((change) => change.label).join(' and ')} affect the forecast. ` +
          'Call these out explicitly and confirm the prospect actually stated them.',
      );
    }

    const writeAllowed = isWriteAllowed(opportunityId);
    if (!writeAllowed) {
      allWarnings.push(
        `This Opportunity is not on the write allowlist, so the write will be refused. Currently ${describeWriteAllowlist()}.`,
      );
    }

    return {
      opportunityName: (record.Name as string | null) ?? null,
      currentStage: (record.StageName as string | null) ?? null,
      changes: detailed,
      warnings: allWarnings,
      writeAllowed,
      allowlistNote: describeWriteAllowlist(),
    };
  },
});
