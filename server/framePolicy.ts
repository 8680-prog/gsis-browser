/**
 * Decides whether a browser would render a response inside an <iframe> on
 * `ancestorOrigin`, based on the response's `Content-Security-Policy`
 * (frame-ancestors) and `X-Frame-Options` headers.
 *
 * Follows the HTML "check a navigation response's adherence to
 * X-Frame-Options" algorithm and CSP Level 3 source matching closely enough
 * for an advance warning. The browser always has the final say.
 */

export type FrameBlockSource = 'csp' | 'xfo';

export interface FrameVerdict {
  embeddable: boolean;
  source: FrameBlockSource | null;
  reason: string | null;
}

const ALLOWED: FrameVerdict = { embeddable: true, source: null, reason: null };

function defaultPort(protocol: string): string {
  if (protocol === 'https:' || protocol === 'wss:') return '443';
  if (protocol === 'http:' || protocol === 'ws:') return '80';
  return '';
}

/** Extracts the frame-ancestors source lists from every enforced policy. */
export function parseFrameAncestors(cspHeaders: string[]): string[][] {
  const lists: string[][] = [];
  for (const header of cspHeaders) {
    // Several policies may be joined with commas into a single header value.
    for (const policy of header.split(',')) {
      const seen = new Set<string>();
      for (const rawDirective of policy.split(';')) {
        const tokens = rawDirective.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) continue;
        const name = tokens[0].toLowerCase();
        // Only the first occurrence of a directive in a policy counts.
        if (seen.has(name)) continue;
        seen.add(name);
        if (name === 'frame-ancestors') lists.push(tokens.slice(1));
      }
    }
  }
  return lists;
}

function schemeMatches(sourceScheme: string, ancestorScheme: string): boolean {
  if (sourceScheme === ancestorScheme) return true;
  // CSP allows an upgrade from http to https (and ws to wss).
  return (
    (sourceScheme === 'http:' && ancestorScheme === 'https:') ||
    (sourceScheme === 'ws:' && ancestorScheme === 'wss:')
  );
}

function sourceMatches(source: string, ancestor: URL, protectedUrl: URL): boolean {
  const token = source.toLowerCase();
  if (token === "'self'") {
    return (
      ancestor.host === protectedUrl.host &&
      schemeMatches(protectedUrl.protocol, ancestor.protocol)
    );
  }
  if (token.startsWith("'")) return false; // nonces, hashes and other keywords do not apply.
  if (token === '*') return /^(https?|wss?):$/.test(ancestor.protocol);

  // scheme-source, e.g. "https:"
  if (/^[a-z][a-z0-9+.-]*:$/.test(token)) return schemeMatches(token, ancestor.protocol);

  // host-source: [scheme://]host[:port][/path]
  const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|\*\.[^/:]+|[^/:*]+)(?::(\*|\d+))?(\/.*)?$/.exec(token);
  if (!match) return false;
  const [, scheme, host, port] = match;

  if (scheme) {
    if (!schemeMatches(`${scheme}:`, ancestor.protocol)) return false;
  } else if (!schemeMatches(protectedUrl.protocol, ancestor.protocol)) {
    return false;
  }

  const ancestorHost = ancestor.hostname.toLowerCase();
  if (host === '*') {
    // A bare wildcard host matches anything.
  } else if (host.startsWith('*.')) {
    if (!ancestorHost.endsWith(host.slice(1))) return false;
  } else if (ancestorHost !== host) {
    return false;
  }

  const ancestorPort = ancestor.port || defaultPort(ancestor.protocol);
  if (port === '*') return true;
  if (port) return ancestorPort === port;
  const expected = defaultPort(scheme ? `${scheme}:` : ancestor.protocol);
  // Default port, allowing the http->https upgrade from 80 to 443.
  return ancestorPort === expected || (expected === '80' && ancestorPort === '443');
}

export function sourceListAllows(sources: string[], ancestor: URL, protectedUrl: URL): boolean {
  const effective = sources.filter((s) => s.toLowerCase() !== "'none'");
  if (effective.length === 0) return false;
  return effective.some((s) => sourceMatches(s, ancestor, protectedUrl));
}

export function evaluateFramePolicy(
  headers: { csp: string[]; xfo: string[] },
  frameUrl: URL,
  ancestorOrigin: string,
): FrameVerdict {
  const ancestor = new URL(ancestorOrigin);

  const frameAncestors = parseFrameAncestors(headers.csp);
  if (frameAncestors.length > 0) {
    // When frame-ancestors is present, X-Frame-Options is ignored.
    for (const list of frameAncestors) {
      if (!sourceListAllows(list, ancestor, frameUrl)) {
        const joined = list.join(' ') || "'none'";
        return {
          embeddable: false,
          source: 'csp',
          reason: `The site's Content-Security-Policy only allows embedding by: frame-ancestors ${joined}`,
        };
      }
    }
    return ALLOWED;
  }

  const values = new Set(
    headers.xfo
      .join(',')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
  if (values.size === 0) return ALLOWED;
  if (values.size > 1) {
    if (values.has('deny') || values.has('sameorigin') || values.has('allowall')) {
      return {
        embeddable: false,
        source: 'xfo',
        reason: 'The site sends conflicting X-Frame-Options values, which browsers treat as DENY.',
      };
    }
    return ALLOWED;
  }
  if (values.has('deny')) {
    return {
      embeddable: false,
      source: 'xfo',
      reason: 'The site sends "X-Frame-Options: DENY", so browsers refuse to show it inside other pages.',
    };
  }
  if (values.has('sameorigin') && frameUrl.origin !== ancestor.origin) {
    return {
      embeddable: false,
      source: 'xfo',
      reason: 'The site sends "X-Frame-Options: SAMEORIGIN", so only its own pages may embed it.',
    };
  }
  return ALLOWED;
}
