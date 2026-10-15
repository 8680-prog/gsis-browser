# Fern

A dark, tabbed browser workspace that runs in a normal web browser (including Chromebooks). It has a sidebar, real tabs with their own history, an address/search bar, bookmarks, history, Games and Apps catalogs, and settings. Websites open inside the app **when the website allows embedding**. When a site forbids it, Fern says so and offers to open the site in a normal browser tab.

## How it works

```
Browser (React SPA)                                   Netlify
┌───────────────────────────────┐   GET /api/inspect   ┌──────────────────────────────────┐
│ address bar → normalize input │ ───────────────────▶ │ Netlify Function (Node.js)       │
│ tab: per-tab history stack    │ ◀─────────────────── │ netlify/functions/inspect.ts     │
│ iframe (sandboxed)  ◀── site  │   metadata only:     │  • SSRF guards, pinned DNS       │
└───────────────────────────────┘   status, framing,   │  • reads status, XFO/CSP,        │
                                     title, errors      │    <title>; never the page       │
                                                        └──────────────────────────────────┘
```

**Why there is a backend.** A page cannot find out from JavaScript why a cross-origin iframe failed. The `load` event fires even when the browser refused the frame because of `X-Frame-Options` or CSP `frame-ancestors`, and DNS or TLS failures look the same. Without help, the user just sees a blank box. Before mounting the iframe, Fern calls `/api/inspect`. That endpoint fetches the URL server-side and reports:

- the final URL after redirects
- the HTTP status
- whether the framing headers allow embedding on Fern's origin
- the page title
- network errors: DNS, refused, TLS, timeout, too many redirects

**It is not a proxy.** It never returns page content, and the page itself is always loaded by the user's browser directly from the site.

**Security of the inspector:**

- Only `http`/`https` on ports 80/443, with no credentials in the URL.
- Internal host names are refused: `localhost`, `*.local`, `*.internal`, single-label names and so on.
- Literal IP hosts are checked before any network access, including normalized forms such as `2130706433` and `[::1]`.
- Every hostname, including each redirect hop, is resolved first. If *any* address is private, loopback, link-local, CGNAT, ULA, multicast, reserved, NAT64/6to4/Teredo or IPv4-mapped-private, the request is refused. This covers `169.254.169.254` and `fd00:ec2::254`. On Netlify (Node.js) the connection then goes only to the checked addresses, so DNS rebinding is not possible.
- Redirects are followed manually (at most 5), and every hop is validated again.
- Requests time out after 8 s overall. At most 256 KB of the body is read (for `<title>`), then the download is cancelled.
- No cookies are sent or stored, and requests use an honest User-Agent.
- Requests flagged by browsers as `Sec-Fetch-Site: cross-site` are rejected.
- Rate limit: 40 requests per minute per visitor IP, enforced by Netlify itself (`rateLimit` in the function's `config`). An in-memory limiter in the function is a second, best-effort layer.

All inspector variants share their logic in `server/core.ts` and the HTTP handling in `server/webHandler.ts`:

| | **Netlify Function** (production, `npm run dev`, e2e tests) | Cloudflare Pages Function (alternative) | Vercel (alternative) |
| --- | --- | --- | --- |
| Entry | `netlify/functions/inspect.ts` | `functions/api/inspect.ts` | `api/inspect.ts` |
| Inspector | Node (`server/inspect.ts`) | Workers (`server/edge.ts`) | Node (`server/inspect.ts`) |
| DNS / rebinding | guarded `lookup`, socket pinned to checked addresses | check-then-fetch, no pinning possible | pinned |
| Error detail | specific DNS, refused and TLS codes | refused and TLS may show as generic | specific |
| Rate limit | Netlify platform rule + in-memory | in-memory only | in-memory only |

**Iframes** use `sandbox` without `allow-top-navigation`, so an embedded page cannot navigate Fern away. Popups (links with `target=_blank`) open real browser tabs.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | App shell, tab state, in-page back/forward, persistence, keyboard shortcuts |
| `src/components/` | `Sidebar`, `TabStrip`, `Toolbar` (address bar), `WebFrame` (embed check, iframe, blocked/error states) |
| `src/pages/` | Internal `fern://` pages: home, bookmarks, history, games, apps, settings |
| `src/lib/` | URL normalization, search engines, tabs reducer, frame history model, storage, inspect client, catalog |
| `netlify/functions/inspect.ts` | **Netlify Function** for `GET /api/inspect` (`config.path`, platform rate limit) |
| `netlify/functions/api-not-found.ts` | JSON 404 for any other `/api/*` path |
| `netlify.toml` | Netlify build: `npm run build` → `dist`, Node 22, functions directory |
| `public/_headers` | Security headers (CSP and others) for the static site; Netlify and Cloudflare both read this file |
| `server/core.ts`, `server/addressPolicy.ts`, `server/framePolicy.ts`, `server/webHandler.ts` | Shared inspector logic and Request/Response handler |
| `server/inspect.ts`, `server/netGuard.ts` | Node inspector with pinned DNS (Netlify, Vercel, Vite dev/preview) |
| `server/nodeAdapter.ts` | Runs the Request/Response handler inside Vite's dev/preview server |
| `server/edge.ts`, `functions/`, `wrangler.toml`, `public/_routes.json` | Cloudflare Pages alternative (not used by Netlify) |
| `api/inspect.ts`, `server/handler.ts`, `vercel.json` | Vercel alternative (not used by Netlify) |
| `tests/unit` | Vitest: URL parsing, tabs, frame history, frame-policy rules, SSRF guards, all inspectors, the Netlify Function modules |
| `tests/e2e` | Playwright: the full app in Chromium against local fixture sites with different embedding policies |

## Local development

```bash
npm ci
npm run dev        # http://localhost:5173 (serves /api/inspect with the same handler as the Netlify Function)
npm run lint
npm run typecheck
npm test           # unit tests
npm run build      # production build into dist/
npm run netlify:check  # run Netlify's build locally (offline): site build + Functions bundling
npm run cf:check   # (Cloudflare alternative) compile the Pages Functions
npm run cf:dev     # (Cloudflare alternative) run dist/ + functions/ in wrangler pages dev on :8788
npm run test:e2e   # builds, then runs Playwright (needs a Chromium: npx playwright install chromium)
```

Requires Node 22 (see `.nvmrc`).

## Deploying (free): Netlify + GitHub

Netlify's free plan hosts the static app and the Netlify Functions. Everything is configured in `netlify.toml` and in each function's `config`, and there are no environment variables or secrets. Dashboard settings for the site **gsis**:

| Setting | Value |
| --- | --- |
| Site / project name | `gsis` (gives `https://gsis.netlify.app` if the name is free) |
| Repository | `8680-prog/gsis-browser` |
| Branch to deploy | `main` |
| Base directory | *(leave empty)* |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Environment variables | none required (Node 22 comes from `netlify.toml`) |

Values in `netlify.toml` take precedence over the dashboard fields.

Routes: `/api/inspect` → `netlify/functions/inspect.ts`. Every other `/api/*` path → JSON 404. Everything else is a static file from `dist`. The app is a single page at `/`, so no SPA redirect is needed.

`.github/workflows/ci.yml` runs lint, type check, unit tests, build, Netlify's offline build (Functions bundling), the Cloudflare Functions compile check and e2e tests on GitHub Actions.

**Alternatives:** Cloudflare Pages (`functions/`, `wrangler.toml`) and Vercel (`vercel.json`, `api/inspect.ts`) configurations are kept and tested, but they are not used by Netlify. **Static-only hosts** such as GitHub Pages have no `/api/inspect`. Fern detects that and still loads pages, with the notice "Embed check unavailable — if the page stays blank, the site probably forbids embedding".

## Known limitations

These are inherent to running a browser inside a web page:

- **Many major sites cannot be embedded.** Google, Bing, DuckDuckGo, YouTube's main site, social networks, banks and most sign-in pages send `X-Frame-Options` or `frame-ancestors`. Browsers enforce these, and no header trick on Fern's side can change that. Fern shows a clear notice and an "Open in a new browser tab" button. Many reference, documentation and small sites allow embedding (Wikipedia and OpenStreetMap's embed page have historically allowed it). The live check decides each time.
- **Search results usually open the notice**, because most search engines forbid framing. You can pick another engine or a custom URL template (`%s` = query) in Settings.
- **Cross-origin pages hide their address and title from Fern.** After you click links *inside* an embedded page, the address bar keeps showing the address Fern opened; an ⓘ icon marks this. Fern's **Back/Forward step through those in-page links first**, using the browser's session history, then continue with the tab's own history. Fern only does this when it knows the latest history entry belongs to the visible page; otherwise (for example, you followed a link in another tab more recently) it falls back to the tab's own history, so it never moves a hidden tab. **Reload** reloads the address shown, not the in-page link you followed, because Fern cannot read it. Titles come from the server-side check of the opened URL.
- **The browser's own Back button** (outside Fern) also steps embedded pages back, but Fern cannot observe that, so its Back/Forward buttons may then be one step out of sync.
- **Signing in inside a frame often fails**, because browsers block or partition third-party cookies. Use "Open in a new browser tab".
- **The check is advisory.** A site may send different headers to Fern's server than to your browser, for example behind bot protection or geo-blocking. If the check passes but the site still refuses, the frame shows the browser's own error page or stays blank, and Fern cannot detect this (the browser reports the frame as loaded). "Open in a new browser tab" is always available in the toolbar. A "still loading" notice appears only when a frame has not finished loading after 20 s.
- **`http://` pages** cannot be embedded when Fern is served over `https` (mixed content). Fern offers the https version instead.
- **Keyboard shortcuts** work only while focus is in Fern's interface, not inside an embedded page. Chrome reserves Ctrl+T/Ctrl+W in normal windows, so Alt+T/Alt+W are provided.
- **Rate limiting:** on Netlify the per-visitor rule in the function's `config` is enforced by the platform. Its enforcement can only be confirmed on a live deployment. The in-memory limiter does not survive across function instances, and on the Cloudflare and Vercel alternatives it is the only limit.
- **Cloudflare alternative only:** the inspector cannot pin resolved addresses (see the table above). URLs that use a public IP address instead of a host name cannot be checked, because Workers cannot fetch raw IPs. Fern then reports a network error and offers to load the page anyway or open it in a new tab.
- Bookmarks, history, settings and open tabs live in this browser's `localStorage`. They are not synced.
