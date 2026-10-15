import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { ERROR_TITLES, inspect, type InspectFailure, type InspectNote, type InspectSuccess } from '../lib/inspect';
import { displayHost } from '../lib/url';
import type { LoadStatus } from '../lib/types';

const SLOW_AFTER_MS = 20_000;

type Phase =
  | { kind: 'checking' }
  | { kind: 'blocked'; title: string; reason: string; detail?: string; httpsAlternative?: string }
  | { kind: 'error'; failure: InspectFailure }
  | { kind: 'frame'; src: string; notes: InspectNote[]; status?: number; unverified?: string };

interface Props {
  url: string;
  /**
   * Unique per iframe mount. Browsers match session-history entries to frames
   * by name, so a unique name stops entries left by an earlier mount from ever
   * being applied to this one.
   */
  frameName: string;
  active: boolean;
  checkEmbedding: boolean;
  onStatus: (status: LoadStatus, title?: string) => void;
  onResolvedUrl: (url: string) => void;
  onFrameNavigated: () => void;
  onRetry: () => void;
  onNavigate: (url: string) => void;
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function mixedContentBlocked(src: string): boolean {
  return window.location.protocol === 'https:' && src.startsWith('http:');
}

function phaseFromInspection(info: InspectSuccess): Phase {
  const finalUrl = info.finalUrl;
  if (!info.embeddable) {
    return {
      kind: 'blocked',
      title: `${displayHost(finalUrl)} doesn't allow embedding`,
      reason: info.blockReason ?? 'The site forbids being shown inside other pages.',
      detail:
        info.blockSource === 'csp'
          ? 'This is enforced by your browser through the Content-Security-Policy "frame-ancestors" rule. No web app can override it.'
          : 'This is enforced by your browser through the X-Frame-Options header. No web app can override it.',
    };
  }
  if (mixedContentBlocked(finalUrl)) {
    return {
      kind: 'blocked',
      title: 'Insecure page (http) cannot be embedded here',
      reason: 'Fern is served over https, and browsers block http pages inside https pages (mixed content).',
      httpsAlternative: finalUrl.replace(/^http:/, 'https:'),
    };
  }
  return { kind: 'frame', src: finalUrl, notes: info.notes, status: info.status };
}

const NOTE_TEXT: Record<InspectNote, string> = {
  auth_required: 'This site asked for sign-in. Logging in inside an embedded frame often fails because browsers restrict third-party cookies; open it in a normal tab to sign in.',
  bot_challenge: "This site showed a bot check to Fern's embed checker. It may still load for you; if it stays blank, open it in a normal tab.",
  download: 'This address serves a file download rather than a page.',
  http_error: 'The site answered with an error status. Its error page is shown below.',
  insecure: 'This page uses an unencrypted http connection.',
};

export function WebFrame({ url, frameName, active, checkEmbedding, onStatus, onResolvedUrl, onFrameNavigated, onRetry, onNavigate }: Props) {
  const [phase, setPhase] = useState<Phase>(() =>
    checkEmbedding ? { kind: 'checking' } : { kind: 'frame', src: url, notes: [], unverified: 'Embed checking is turned off in Settings.' },
  );
  const [frameState, setFrameState] = useState<'loading' | 'loaded' | 'slow'>('loading');
  const [dismissed, setDismissed] = useState(false);
  const loads = useRef(0);

  // Callbacks from the parent change identity on every render; keep the latest.
  const callbacks = useRef({ onStatus, onResolvedUrl, onFrameNavigated });
  useEffect(() => {
    callbacks.current = { onStatus, onResolvedUrl, onFrameNavigated };
  });

  // 1. Ask the server whether the page can be embedded.
  useEffect(() => {
    if (phase.kind !== 'checking') return;
    const controller = new AbortController();
    callbacks.current.onStatus('checking');
    inspect(url, controller.signal)
      .then((outcome) => {
        if (outcome.ok === null) {
          setPhase({ kind: 'frame', src: url, notes: [], unverified: outcome.reason });
          return;
        }
        if (!outcome.ok) {
          setPhase({ kind: 'error', failure: outcome });
          return;
        }
        if (outcome.finalUrl !== url) callbacks.current.onResolvedUrl(outcome.finalUrl);
        const next = phaseFromInspection(outcome);
        if (next.kind === 'frame' && outcome.title) callbacks.current.onStatus('loading', outcome.title);
        setPhase(next);
      })
      .catch(() => {
        /* aborted because the tab navigated away */
      });
    return () => controller.abort();
  }, [phase.kind, url]);

  // 2. Report status for tab spinner and title.
  useEffect(() => {
    const host = displayHost(url);
    if (phase.kind === 'blocked') callbacks.current.onStatus('blocked', host);
    else if (phase.kind === 'error') callbacks.current.onStatus('error', ERROR_TITLES[phase.failure.errorCode]);
    else if (phase.kind === 'frame') callbacks.current.onStatus(frameState === 'loaded' ? 'loaded' : frameState === 'slow' ? 'slow' : 'loading');
  }, [phase, frameState, url]);

  // 3. Warn if the frame never finishes loading.
  useEffect(() => {
    if (phase.kind !== 'frame' || frameState !== 'loading') return;
    const timer = window.setTimeout(() => setFrameState('slow'), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase.kind, frameState]);

  if (phase.kind === 'checking') {
    return (
      <div className="page-state" data-testid="state-checking">
        <div className="progress-bar indeterminate" />
        <div className="state-card subtle">
          <span className="spinner large" />
          <p>Checking whether {displayHost(url)} allows embedding…</p>
        </div>
      </div>
    );
  }

  if (phase.kind === 'blocked') {
    return (
      <div className="page-state" data-testid="state-blocked">
        <div className="state-card">
          <div className="state-icon warn">
            <Icon name="shield" size={28} />
          </div>
          <h2>{phase.title}</h2>
          <p className="state-reason" data-testid="block-reason">{phase.reason}</p>
          {phase.detail && <p className="state-detail">{phase.detail}</p>}
          <p className="state-url">{url}</p>
          <div className="state-actions">
            {phase.httpsAlternative ? (
              <button type="button" className="btn primary" onClick={() => onNavigate(phase.httpsAlternative!)}>
                Try the https version
              </button>
            ) : null}
            <button type="button" className="btn primary" onClick={() => openExternal(url)} data-testid="open-new-tab">
              <Icon name="external" size={16} /> Open in a new browser tab
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setPhase({ kind: 'frame', src: url, notes: [], unverified: 'Loaded despite a warning; the browser may still refuse it.' })}
            >
              Try embedding anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === 'error') {
    const { failure } = phase;
    const canTryAnyway = failure.errorCode !== 'blocked_target' && failure.errorCode !== 'invalid_url';
    return (
      <div className="page-state" data-testid="state-error">
        <div className="state-card">
          <div className="state-icon error">
            <Icon name="alert" size={28} />
          </div>
          <h2 data-testid="error-title">{ERROR_TITLES[failure.errorCode]}</h2>
          <p className="state-reason">{failure.message}</p>
          <p className="state-url">{url}</p>
          <div className="state-actions">
            <button type="button" className="btn primary" onClick={onRetry} data-testid="retry">
              <Icon name="reload" size={16} /> Retry
            </button>
            {canTryAnyway && (
              <>
                <button type="button" className="btn" onClick={() => openExternal(url)}>
                  <Icon name="external" size={16} /> Open in a new browser tab
                </button>
                <button type="button" className="btn" onClick={() => setPhase({ kind: 'frame', src: url, notes: [], unverified: "Fern's server could not reach this site; your browser may still be able to." })}>
                  Try loading anyway
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // The lock icon in the address bar already signals http; no banner for it.
  const notes = phase.notes.filter((n) => n !== 'insecure');

  return (
    <div className="frame-wrap">
      {frameState === 'loading' && <div className="progress-bar indeterminate" data-testid="frame-loading" />}
      {(notes.length > 0 || phase.unverified || frameState === 'slow') && !dismissed && (
        <div className="frame-notice" role="status" data-testid="frame-notice">
          <Icon name="info" size={16} />
          <div className="frame-notice-text">
            {frameState === 'slow' && <p>This page is taking a long time to load. It may be slow, offline, or silently refusing to be embedded.</p>}
            {phase.unverified && (
              <p>
                {phase.unverified} If the page stays blank, the site probably forbids embedding.
              </p>
            )}
            {notes.map((n) => (
              <p key={n}>{NOTE_TEXT[n]}</p>
            ))}
          </div>
          <div className="frame-notice-actions">
            {frameState === 'slow' && (
              <button type="button" className="btn small" onClick={onRetry}>
                Retry
              </button>
            )}
            <button type="button" className="btn small" onClick={() => openExternal(phase.src)}>
              Open in new tab
            </button>
            <button type="button" className="icon-btn small" onClick={() => setDismissed(true)} aria-label="Dismiss notice">
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
      )}
      <iframe
        className="web-frame"
        src={phase.src}
        name={frameName}
        title={`Web page: ${displayHost(phase.src)}`}
        data-testid="web-frame"
        // No allow-top-navigation: embedded pages cannot navigate Fern itself away.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation"
        allow="fullscreen; clipboard-write; autoplay; gamepad; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={active ? 0 : -1}
        onLoad={() => {
          loads.current += 1;
          if (loads.current === 1) setFrameState('loaded');
          else callbacks.current.onFrameNavigated();
        }}
      />
    </div>
  );
}
