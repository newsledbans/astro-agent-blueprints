import { config } from './config';

export class GongError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GongError';
  }
}

/**
 * Where a transcript comes from. Kept behind an interface because Postman may
 * reach Gong directly or via an internal gateway, and because the sample
 * source makes the whole agent testable with no Gong credentials at all.
 */
export interface TranscriptSource {
  readonly kind: 'gong-api' | 'sample';
  fetchTranscript(gongCallId: string): Promise<string>;
}

interface GongSentence {
  text?: string;
}

interface GongMonologue {
  speakerId?: string;
  sentences?: GongSentence[];
}

interface GongTranscriptResponse {
  callTranscripts?: Array<{ callId?: string; transcript?: GongMonologue[] }>;
}

interface GongParty {
  speakerId?: string;
  name?: string;
  title?: string;
  affiliation?: string;
}

interface GongExtensiveResponse {
  calls?: Array<{ parties?: GongParty[] }>;
}

class GongApiSource implements TranscriptSource {
  readonly kind = 'gong-api' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly accessKey: string,
    private readonly secret: string,
  ) {}

  private get authHeader(): string {
    const encoded = Buffer.from(`${this.accessKey}:${this.secret}`).toString('base64');
    return `Basic ${encoded}`;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new GongError(`Gong ${path} failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Gong returns the transcript keyed by speakerId only, so participant names
   * come from a second call. Without them the transcript reads as "Speaker 1",
   * which loses who committed to what.
   */
  private async speakerNames(gongCallId: string): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    try {
      const extensive = await this.post<GongExtensiveResponse>('/v2/calls/extensive', {
        filter: { callIds: [gongCallId] },
        contentSelector: { exposedFields: { parties: true } },
      });

      for (const party of extensive.calls?.[0]?.parties ?? []) {
        if (!party.speakerId || !party.name) continue;
        const affiliation = party.affiliation === 'Internal' ? 'Sales' : party.title || 'Prospect';
        names.set(party.speakerId, `${party.name} (${affiliation})`);
      }
    } catch {
      // Names are a nicety; a transcript without them is still workable.
    }
    return names;
  }

  async fetchTranscript(gongCallId: string): Promise<string> {
    const [transcriptResponse, names] = await Promise.all([
      this.post<GongTranscriptResponse>('/v2/calls/transcript', {
        filter: { callIds: [gongCallId] },
      }),
      this.speakerNames(gongCallId),
    ]);

    const monologues = transcriptResponse.callTranscripts?.[0]?.transcript ?? [];
    if (monologues.length === 0) {
      throw new GongError(
        `Gong returned no transcript for call ${gongCallId}. It may still be processing, or the API key may lack access to it.`,
      );
    }

    const lines = monologues.map((monologue) => {
      const speaker = names.get(monologue.speakerId ?? '') ?? `Speaker ${monologue.speakerId ?? '?'}`;
      const text = (monologue.sentences ?? [])
        .map((sentence) => sentence.text?.trim())
        .filter(Boolean)
        .join(' ');
      return text ? `${speaker}: ${text}` : '';
    });

    return lines.filter(Boolean).join('\n\n');
  }
}

/** Stands in for Gong so the extraction and approval path can be exercised offline. */
class SampleTranscriptSource implements TranscriptSource {
  readonly kind = 'sample' as const;

  async fetchTranscript(gongCallId: string): Promise<string> {
    return [
      `[SAMPLE TRANSCRIPT — Gong credentials are not configured, so this is fixture text, not call ${gongCallId}.]`,
      '',
      'John (Sales): Thanks for jumping on, Sarah. How are things looking for the Q4 rollout?',
      '',
      'Sarah (Prospect): We want to move fast, ideally signing by late October to go live December 1st. ' +
        'But our current manual data entry is killing our team efficiency — we are losing 15 hours a week.',
      '',
      'John (Sales): Understood. Who else needs to approve the budget for this?',
      '',
      'Sarah (Prospect): Our VP of Ops, Mike, has the final sign-off on budgets up to $50k. This fits within that.',
      '',
      "John (Sales): Perfect. I'll send over the security documentation today. Can we meet next Tuesday at 2 PM to review?",
      '',
      "Sarah (Prospect): Yes, send the invite. I'll review the docs before then.",
    ].join('\n');
  }
}

/**
 * Picks the live source when Gong credentials exist and the sample otherwise,
 * so a missing credential degrades to something testable instead of an error.
 */
export function resolveTranscriptSource(): TranscriptSource {
  const { baseUrl, accessKey, secret } = config.gong;
  if (accessKey && secret) {
    return new GongApiSource(baseUrl, accessKey, secret);
  }
  return new SampleTranscriptSource();
}
