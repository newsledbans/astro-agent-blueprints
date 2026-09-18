import { z } from 'zod';

/**
 * Character limits taken from the org's own Opportunity describe (api v67.0).
 * Challenges_Pain_Points__c is the tight one — 255 characters — so full pain
 * detail is preserved in Deal_Summary__c and only a precis goes in that field.
 */
export const FIELD_LIMITS = {
  Challenges_Pain_Points__c: 255,
  Metrics__c: 10_000,
  Decision_Process__c: 10_000,
  Next_Steps__c: 50_000,
  Deal_Summary__c: 32_768,
} as const;

/**
 * What the model pulls out of a transcript. Field descriptions are the actual
 * extraction instructions — the model sees them, so they carry the rules that
 * matter most: quote the prospect, never infer a date or a number.
 */
export const CallExtractionSchema = z.object({
  pain_points: z
    .string()
    .describe("Challenges the prospect described, in their own framing. Empty string if none surfaced."),
  metrics: z
    .string()
    .describe(
      'Quantified impact the prospect stated, e.g. "losing 15 hours a week". Only figures they actually said. Empty string if none.',
    ),
  budget_authority: z
    .string()
    .describe(
      'Budget availability and who signs off: named decision-makers, titles, and approval limits as stated. Empty string if not discussed.',
    ),
  timeline: z
    .string()
    .describe('When they intend to decide or go live, as stated. Empty string if not discussed.'),
  next_steps: z
    .string()
    .describe('Explicit action items: what, who owns it, and by when. Empty string if none were agreed.'),
  summary_notes: z.string().describe('A three-to-four sentence executive summary of the call.'),
  close_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, YYYY-MM-DD')
    .nullable()
    .describe(
      'ISO date the prospect indicated they would sign. Null unless they named a date. Never infer one from vague language like "soon" or "next quarter".',
    ),
  amount: z
    .number()
    .nullable()
    .describe(
      'Deal value in dollars, only if explicitly stated. Null otherwise. A mentioned approval ceiling is not the deal value.',
    ),
});

export type CallExtraction = z.infer<typeof CallExtractionSchema>;

function truncate(text: string, limit: number): { value: string; truncated: boolean } {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= limit) return { value: clean, truncated: false };

  const ellipsis = '…';
  const slice = clean.slice(0, limit - ellipsis.length);
  const lastSpace = slice.lastIndexOf(' ');
  // Only break on a word boundary if it doesn't cost us most of the budget.
  const cut = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return { value: `${cut}${ellipsis}`, truncated: true };
}

/** A single field's proposed change, ready to render for approval. */
export interface FieldChange {
  field: string;
  label: string;
  value: string | number;
  /** Forecast-affecting fields are called out separately to the rep. */
  forecast: boolean;
}

export interface MappedUpdate {
  changes: FieldChange[];
  /** Caveats worth showing the rep, e.g. a field that had to be shortened. */
  warnings: string[];
}

/**
 * Composes the long-form summary. Everything the model extracted lands here in
 * full, so nothing is lost to the shorter dedicated fields.
 */
function composeDealSummary(extraction: CallExtraction): string {
  const sections: string[] = [extraction.summary_notes.trim()];

  const detail: Array<[string, string]> = [
    ['Pain points', extraction.pain_points],
    ['Metrics', extraction.metrics],
    ['Budget & authority', extraction.budget_authority],
    ['Timeline (as stated)', extraction.timeline],
  ];

  for (const [label, value] of detail) {
    if (value.trim()) sections.push(`${label}: ${value.trim()}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Turns an extraction into the exact Salesforce field payload, applying the
 * org's length limits. Empty extractions are dropped rather than written as
 * blanks — a quiet call must not wipe a field a human filled in.
 */
export function mapExtraction(extraction: CallExtraction): MappedUpdate {
  const changes: FieldChange[] = [];
  const warnings: string[] = [];

  const push = (field: keyof typeof FIELD_LIMITS, label: string, raw: string) => {
    if (!raw.trim()) return;
    const { value, truncated } = truncate(raw, FIELD_LIMITS[field]);
    if (truncated) {
      warnings.push(
        `${label} was shortened to fit ${field} (${FIELD_LIMITS[field]} chars). Full text is preserved in Deal Summary.`,
      );
    }
    changes.push({ field, label, value, forecast: false });
  };

  push('Deal_Summary__c', 'Deal Summary', composeDealSummary(extraction));
  push('Challenges_Pain_Points__c', 'Challenges/Pain Points', extraction.pain_points);
  push('Metrics__c', 'Metrics', extraction.metrics);
  push('Decision_Process__c', 'Decision Process', extraction.budget_authority);
  push('Next_Steps__c', 'Next Steps', extraction.next_steps);

  if (extraction.close_date) {
    changes.push({ field: 'CloseDate', label: 'Close Date', value: extraction.close_date, forecast: true });
  }
  if (extraction.amount !== null) {
    changes.push({ field: 'Amount', label: 'Amount', value: extraction.amount, forecast: true });
  }

  return { changes, warnings };
}

/** The field payload to PATCH, derived from approved changes. */
export function toFieldPayload(changes: FieldChange[]): Record<string, string | number> {
  return Object.fromEntries(changes.map((change) => [change.field, change.value]));
}
