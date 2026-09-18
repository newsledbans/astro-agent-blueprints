---
name: salesforce-updater-agent
description: "Turns a Gong sales call into an approved Salesforce Opportunity update, so reps skip the post-call CRM data entry."
tags: ["salesforce", "gong", "sales-ops", "crm"]
authors: []
capabilities: ["call-transcript-extraction", "crm-update", "human-in-the-loop-approval"]
integrations:
  - "anthropic"
  - "salesforce"
  - "gong"
repository:
  type: git
  url: "https://github.com/newsledbans/astro-agent-blueprints"
  directory: salesforce-updater-agent
---

# Salesforce Updater Agent

## Overview

After a customer call, a rep picks the call from a list, and the agent reads the Gong transcript,
extracts the details that belong on the Opportunity, shows exactly what would change, and writes it
only once the rep approves.

The agent extracts six things from a transcript: pain points, quantified metrics, budget and
authority, timeline, next steps, and an executive summary. It maps them onto the org's existing
MEDDPICC fields rather than inventing new ones.

## Field mapping

| Extracted | Salesforce field | Limit |
|---|---|---|
| Executive summary (plus full detail for every other section) | `Deal_Summary__c` | 32,768 |
| Pain points (precis) | `Challenges_Pain_Points__c` | 255 |
| Quantified impact | `Metrics__c` | 10,000 |
| Budget and authority | `Decision_Process__c` | 10,000 |
| Next steps | `Next_Steps__c` | 50,000 |
| Stated decision date | `CloseDate` | forecast-affecting |
| Stated deal value | `Amount` | forecast-affecting |

`Challenges_Pain_Points__c` holds only 255 characters, so the full pain narrative is preserved in
`Deal_Summary__c` and a precis goes in the dedicated field. `Economic_Buyer_Detail__c` and
`Champion_Detail__c` are the natural MEDDPICC homes for authority information but are not writable in
this org, which is why budget and authority routes to `Decision_Process__c`.

## How writes are gated

Three independent guards, because a wrong CRM write is hard to undo:

1. **Preview first.** `preview_opportunity_update` is read-only. It reports each change, quotes any
   current value that would be overwritten, and flags forecast-affecting fields.
2. **Runtime approval.** `write_opportunity_update` sets Mastra's `requireApproval`, so the platform
   renders a permission card the rep must accept. The Astropods adapter denies the call when no render
   surface is available, so the gate fails closed.
3. **Opportunity allowlist.** `SF_ALLOWED_OPPORTUNITY_IDS` restricts which records can be written at
   all, enforced in code rather than by prompt. An empty allowlist permits nothing.

## Extraction discipline

The agent records only what was said. It never infers a close date from vague language, and never
treats a mentioned approval ceiling ("Mike can sign off up to $50k") as the deal value. Topics that
did not come up are left empty rather than filled with a placeholder, so a quiet call cannot erase
what a human wrote.

## Known constraints

- Gong's Salesforce package syncs call metadata but **no transcript text**, so full transcripts require
  the Gong API. Without credentials the agent falls back to a clearly-labelled sample transcript.
- Gong's own synced summaries are too sparse to substitute: across a 200-call sample, only 23% had a
  substantive `Gong__Call_Brief__c`, 4% had next steps, and none had action items.
- Roughly 40% of Gong calls have no linked Opportunity, so the agent asks the rep which record to
  update rather than guessing from the account.
