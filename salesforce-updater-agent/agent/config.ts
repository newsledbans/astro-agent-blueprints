/**
 * Runtime configuration, read from the environment.
 *
 * Nothing here throws at import time: the agent must boot with partial
 * credentials so the playground is usable, and each tool reports precisely
 * what it is missing when it runs.
 */

function env(name: string): string | undefined {
  const trimmed = process.env[name]?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Salesforce returns 18-character IDs from the API, but a rep copying an ID
 * out of a record URL gets 15. Comparing on the 15-character prefix makes the
 * allowlist accept either form.
 */
export function normalizeSalesforceId(id: string): string {
  return id.trim().slice(0, 15);
}

function parseAllowlist(raw: string | undefined): readonly string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeSalesforceId);
}

export const config = {
  salesforce: {
    apiVersion: env('SF_API_VERSION') ?? 'v67.0',
    loginUrl: env('SF_LOGIN_URL') ?? 'https://login.salesforce.com',
    /** Local dev shortcut — lift both from `sf org display --json`. */
    instanceUrl: env('SF_INSTANCE_URL'),
    accessToken: env('SF_ACCESS_TOKEN'),
    /** Connected app, client-credentials flow. Preferred for deployment. */
    clientId: env('SF_CLIENT_ID'),
    clientSecret: env('SF_CLIENT_SECRET'),
  },
  gong: {
    /** Override to route through an internal gateway rather than Gong direct. */
    baseUrl: env('GONG_BASE_URL') ?? 'https://api.gong.io',
    accessKey: env('GONG_ACCESS_KEY'),
    secret: env('GONG_SECRET'),
  },
  /**
   * Opportunity IDs the agent may write to. Empty means no write is permitted
   * at all: the gate fails closed, so a missing or malformed setting can never
   * widen access. Compared on the 15-character prefix.
   */
  writeAllowlist: parseAllowlist(env('SF_ALLOWED_OPPORTUNITY_IDS')),
} as const;

export function isWriteAllowed(opportunityId: string): boolean {
  if (config.writeAllowlist.length === 0) return false;
  return config.writeAllowlist.includes(normalizeSalesforceId(opportunityId));
}

export function describeWriteAllowlist(): string {
  return config.writeAllowlist.length === 0
    ? 'no Opportunities are writable (SF_ALLOWED_OPPORTUNITY_IDS is unset)'
    : `${config.writeAllowlist.length} allowlisted Opportunity ID(s)`;
}
