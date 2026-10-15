/** Client for the /api/inspect embed check. Mirrors server/inspect.ts types. */

export type InspectErrorCode =
  | 'invalid_url'
  | 'blocked_target'
  | 'dns'
  | 'refused'
  | 'tls'
  | 'timeout'
  | 'too_many_redirects'
  | 'network';

export type InspectNote = 'auth_required' | 'bot_challenge' | 'download' | 'http_error' | 'insecure';

export interface InspectSuccess {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirects: number;
  contentType: string | null;
  title: string | null;
  embeddable: boolean;
  blockSource: 'csp' | 'xfo' | null;
  blockReason: string | null;
  notes: InspectNote[];
}

export interface InspectFailure {
  ok: false;
  requestedUrl: string;
  errorCode: InspectErrorCode;
  message: string;
}

export interface InspectUnavailable {
  ok: null;
  reason: string;
}

export type InspectOutcome = InspectSuccess | InspectFailure | InspectUnavailable;

const CACHE_TTL_MS = 60_000;
const CLIENT_TIMEOUT_MS = 12_000;
const cache = new Map<string, { at: number; value: InspectSuccess | InspectFailure }>();

export async function inspect(url: string, signal?: AbortSignal): Promise<InspectOutcome> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const query = new URLSearchParams({ url, ancestor: window.location.origin });
    const res = await fetch(`/api/inspect?${query}`, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (res.status === 429) return { ok: null, reason: 'The embed check is rate-limited right now.' };
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('application/json')) {
      return { ok: null, reason: `The embed check service is not available (HTTP ${res.status}).` };
    }
    const body = (await res.json()) as InspectSuccess | InspectFailure;
    if (typeof body.ok !== 'boolean') return { ok: null, reason: 'The embed check returned an unexpected response.' };
    cache.set(url, { at: Date.now(), value: body });
    return body;
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      ok: null,
      reason: controller.signal.aborted ? 'The embed check timed out.' : 'The embed check service could not be reached.',
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function clearInspectCache(url?: string): void {
  if (url) cache.delete(url);
  else cache.clear();
}

export const ERROR_TITLES: Record<InspectErrorCode, string> = {
  invalid_url: 'That address is not valid',
  blocked_target: 'This address cannot be opened',
  dns: 'Site not found',
  refused: 'Connection refused',
  tls: 'Secure connection failed',
  timeout: 'The site took too long to respond',
  too_many_redirects: 'Too many redirects',
  network: 'Site could not be reached',
};
