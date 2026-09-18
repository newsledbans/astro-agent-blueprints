import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { escapeSoqlString, query } from '../salesforce';

interface GongCallRecord {
  Id: string;
  Name: string | null;
  Gong__Call_ID__c: string | null;
  Gong__Call_Start__c: string | null;
  Gong__View_call__c: string | null;
  Gong__Primary_Opportunity__c: string | null;
  Gong__Primary_Opportunity__r: { Name: string | null; StageName: string | null } | null;
  Gong__Primary_Account__r: { Name: string | null } | null;
}

/**
 * Gong's managed package syncs call metadata into Salesforce, so listing a
 * rep's calls needs no Gong credentials — only the transcript itself does.
 * Gong__Call_ID__c is the handle used to fetch that transcript later.
 */
export const listRecentCalls = createTool({
  id: 'list_recent_calls',
  description:
    "List a sales rep's recent Gong calls from Salesforce so the rep can choose which one to process. " +
    'Returns the Gong call ID needed to fetch a transcript, plus the linked Opportunity when Gong recorded one.',
  inputSchema: z.object({
    repEmail: z
      .string()
      .email()
      .describe("The rep's Salesforce user email. Ask the rep for this if it is not already known."),
    daysBack: z.number().int().min(1).max(90).default(30).describe('How far back to look, in days.'),
    limit: z.number().int().min(1).max(50).default(15).describe('Maximum number of calls to return.'),
  }),
  outputSchema: z.object({
    calls: z.array(
      z.object({
        gongCallId: z.string().nullable(),
        title: z.string().nullable(),
        startedAt: z.string().nullable(),
        accountName: z.string().nullable(),
        opportunityId: z.string().nullable(),
        opportunityName: z.string().nullable(),
        opportunityStage: z.string().nullable(),
        gongUrl: z.string().nullable(),
      }),
    ),
    unlinkedCount: z.number(),
    note: z.string(),
  }),
  execute: async ({ repEmail, daysBack, limit }) => {
    // LAST_N_DAYS takes a literal, so clamp to an integer rather than interpolating input.
    const days = Math.max(1, Math.min(90, Math.floor(daysBack)));
    const rows = Math.max(1, Math.min(50, Math.floor(limit)));

    const soql = [
      'SELECT Id, Name, Gong__Call_ID__c, Gong__Call_Start__c, Gong__View_call__c,',
      'Gong__Primary_Opportunity__c, Gong__Primary_Opportunity__r.Name,',
      'Gong__Primary_Opportunity__r.StageName, Gong__Primary_Account__r.Name',
      'FROM Gong__Gong_Call__c',
      `WHERE Gong__Primary_User__r.Email = '${escapeSoqlString(repEmail)}'`,
      `AND Gong__Call_Start__c = LAST_N_DAYS:${days}`,
      `ORDER BY Gong__Call_Start__c DESC LIMIT ${rows}`,
    ].join(' ');

    const records = await query<GongCallRecord>(soql);

    const calls = records.map((record) => ({
      gongCallId: record.Gong__Call_ID__c,
      title: record.Name,
      startedAt: record.Gong__Call_Start__c,
      accountName: record.Gong__Primary_Account__r?.Name ?? null,
      opportunityId: record.Gong__Primary_Opportunity__c,
      opportunityName: record.Gong__Primary_Opportunity__r?.Name ?? null,
      opportunityStage: record.Gong__Primary_Opportunity__r?.StageName ?? null,
      gongUrl: record.Gong__View_call__c,
    }));

    const unlinkedCount = calls.filter((call) => !call.opportunityId).length;

    const note =
      calls.length === 0
        ? `No Gong calls found for ${repEmail} in the last ${days} days. Check the email is their Salesforce user email.`
        : unlinkedCount > 0
          ? `${unlinkedCount} of ${calls.length} calls have no Opportunity linked in Gong. For those, ask the rep which Opportunity to update — never guess.`
          : 'Every call returned has a linked Opportunity.';

    return { calls, unlinkedCount, note };
  },
});
