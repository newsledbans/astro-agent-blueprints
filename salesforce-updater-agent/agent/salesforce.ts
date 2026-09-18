import { config } from './config';

export class SalesforceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesforceError';
  }
}

/**
 * Escapes a string for safe interpolation into a SOQL literal. Reps supply the
 * email we filter on, so this is the boundary that keeps a quote or backslash
 * from altering the query.
 */
export function escapeSoqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

interface TokenState {
  accessToken: string;
  instanceUrl: string;
  expiresAt: number;
}

let cachedToken: TokenState | null = null;

async function authenticate(): Promise<TokenState> {
  const { accessToken, instanceUrl, clientId, clientSecret, loginUrl } = config.salesforce;

  // Local dev: a token lifted from `sf org display --json` needs no round trip.
  if (accessToken && instanceUrl) {
    return { accessToken, instanceUrl, expiresAt: Date.now() + 30 * 60_000 };
  }

  if (!clientId || !clientSecret) {
    throw new SalesforceError(
      'Salesforce is not configured. Set SF_CLIENT_ID and SF_CLIENT_SECRET for the connected app, ' +
        'or SF_ACCESS_TOKEN and SF_INSTANCE_URL for local development.',
    );
  }

  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new SalesforceError(`Salesforce authentication failed (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as {
    access_token: string;
    instance_url: string;
    expires_in?: number;
  };

  return {
    accessToken: body.access_token,
    instanceUrl: body.instance_url,
    // Refresh a minute early so a long tool call can't run past expiry.
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000,
  };
}

async function currentToken(): Promise<TokenState> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken;
  cachedToken = await authenticate();
  return cachedToken;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { accessToken, instanceUrl } = await currentToken();

  const response = await fetch(`${instanceUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (response.status === 401) {
    // Drop the token so the next call re-authenticates rather than looping.
    cachedToken = null;
    throw new SalesforceError('Salesforce rejected the credentials (401). The session may have expired.');
  }

  if (!response.ok) {
    throw new SalesforceError(
      `Salesforce ${init.method ?? 'GET'} ${path} failed (${response.status}): ${await response.text()}`,
    );
  }

  // PATCH returns 204 with an empty body.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function query<T>(soql: string): Promise<T[]> {
  const { apiVersion } = config.salesforce;
  const result = await request<{ records: T[] }>(
    `/services/data/${apiVersion}/query/?q=${encodeURIComponent(soql)}`,
  );
  return result.records ?? [];
}

export async function getOpportunityFields(
  opportunityId: string,
  fields: readonly string[],
): Promise<Record<string, unknown>> {
  const { apiVersion } = config.salesforce;
  return request<Record<string, unknown>>(
    `/services/data/${apiVersion}/sobjects/Opportunity/${encodeURIComponent(opportunityId)}` +
      `?fields=${encodeURIComponent(fields.join(','))}`,
  );
}

export async function updateOpportunity(
  opportunityId: string,
  fields: Record<string, string | number>,
): Promise<void> {
  const { apiVersion } = config.salesforce;
  await request<void>(`/services/data/${apiVersion}/sobjects/Opportunity/${encodeURIComponent(opportunityId)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}
