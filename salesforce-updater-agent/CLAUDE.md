# salesforce-updater-agent

Turns a Gong sales call into an approved Salesforce Opportunity update.

See `AGENTS.md` for the directory layout and the conventions this codebase follows — in particular that
`writeOpportunityUpdate` is the only mutating tool and that write guards live in code, not in prompts.

For comprehensive documentation including **critical API usage notes**, run `ast docs`.
