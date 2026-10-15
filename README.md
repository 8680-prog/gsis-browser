# Fern

A dark, tabbed browser workspace that runs in a normal web browser (including Chromebooks). It has a sidebar, real tabs with their own history, an address/search bar, bookmarks, history, Games and Apps catalogs, and settings. Websites open inside the app **when the website allows embedding**. When a site forbids it, Fern says so and offers to open the site in a normal browser tab.

## How it works

```
Browser (React SPA)                                   Cloudflare Pages
┌───────────────────────────────┐   GET /api/inspect   ┌──────────────────────────────────┐
│ address bar → normalize input │ ───────────────────▶ │ Pages Function                   │
│ tab: per-tab history stack    │ ◀─────────────────── │ functions/api/inspect.ts         │
│ iframe (sandboxed)  ◀── site  │   metadata only:     │  • SSRF guards, DNS pre-check    │
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
- Every hostname, including each redirect hop, is resolved first. If *any* address is private, loopback, link-local, CGNAT, ULA, multicast, reserved, NAT64/6to4/Teredo or IPv4-mapped-private, the request is refused. This covers `169.254.169.254` and `fd00:ec2::254`.
- Redirects are followed manually (at most 5), and every hop is validated again.
- Requests time out after 8 s overall. At most 256 KB of the body is read (for `<title>`), then the download is cancelled.
- No cookies are sent or stored, and requests use an honest User-Agent.
- Requests flagged by browsers as `Sec-Fetch-Site: cross-site` are rejected. There is a best-effort rate limit of 40 requests per minute per client IP, kept in memory per instance.

There are two implementations of the inspector, and the shared logic lives in `server/core.ts`:

| | Cloudflare Pages Function (`server/edge.ts`) **, used in production, `npm run dev` and e2e tests** | Node (`server/inspect.ts`), for Vercel or any Node host |
| --- | --- | --- |
| DNS check | `node:dns` `resolve4`/`resolve6` (DNS over HTTPS on Cloudflare, needs `nodejs_compat`) | guarded `lookup` |
| Rebinding protection | Check-then-fetch: `fetch` resolves the name again itself, so addresses cannot be pinned. Workers cannot fetch raw IPs or reach private networks. | The socket connects only to the checked addresses (pinned) |
| Error detail | Refused and TLS errors may show as a generic "could not be reached" | Specific DNS, refused and TLS codes |

**Iframes** use `sandbox` without `allow-top-navigation`, so an embedded page cannot navigate Fern away. Popups (links with `target=_blank`) open real browser tabs.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | App shell, tab state, in-page back/forward, persistence, keyboard shortcuts |
| `src/components/` | `Sidebar`, `TabStrip`, `Toolbar` (address bar), `WebFrame` (embed check, iframe, blocked/error states) |
| `src/pages/` | Internal `fern://` pages: home, bookmarks, history, games, apps, settings |
| `src/lib/` | URL normalization, search engines, tabs reducer, frame history model, storage, inspect client, catalog |
| `functions/api/inspect.ts` | **Cloudflare Pages Function** for `GET /api/inspect` |
| `functions/api/[[path]].ts` | JSON 404 for unknown `/api/*` routes, instead of the app's HTML |
| `server/core.ts`, `server/addressPolicy.ts`, `server/framePolicy.ts` | Shared, runtime-independent inspector logic |
| `server/edge.ts` | Web-standard inspector, used by the Pages Function and by Vite dev/preview through `server/nodeAdapter.ts` |
| `server/inspect.ts`, `server/handler.ts`, `server/netGuard.ts`, `api/inspect.ts`, `vercel.json` | Node/Vercel inspector. Optional and not used by Cloudflare. |
| `wrangler.toml` | Cloudflare Pages config: output dir `dist`, compatibility date, `nodejs_compat` |
| `public/_headers` | Security headers (CSP and others) for the static site on Cloudflare |
| `public/_routes.json` | Runs the Function only for `/api/*`; everything else is served as static files (no Function invocations) |
| `tests/unit` | Vitest: URL parsing, tabs, frame history, frame-policy rules, SSRF guards, both inspectors against local servers |
| `tests/e2e` | Playwright: the full app in Chromium against local fixture sites with different embedding policies |

## Local development

```bash
npm ci
npm run dev        # http://localhost:5173 (serves /api/inspect with the Cloudflare handler)
npm run lint
npm run typecheck
npm test           # unit tests
npm run build      # production build into dist/
npm run cf:check   # compile the Pages Functions the way Cloudflare does
npm run cf:dev     # build, then run dist/ + functions/ in Cloudflare's local runtime (wrangler pages dev) on :8788
npm run test:e2e   # builds, then runs Playwright (needs a Chromium: npx playwright install chromium)
```

Requires Node 22 (see `.nvmrc`).

## Deploying (free): Cloudflare Pages + GitHub

Cloudflare Pages' free plan hosts the static app and the Pages Function. Static files are free and unlimited. Function requests (only `/api/*`, see `public/_routes.json`) are billed as Workers requests: 100,000 a day on the free plan, shared with any other Workers on the account. Settings:

| Setting | Value |
| --- | --- |
| Framework preset | `None` (or `Vite`; the values below are what matter) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(leave empty)* |
| Node.js version | from `.nvmrc` (22) |
| Environment variables | none required, and there are no secrets |
| Functions | built automatically from `functions/` |
| Compatibility date / flags | from `wrangler.toml` (`2026-10-01`, `nodejs_compat`) |

Because `wrangler.toml` contains `pages_build_output_dir`, Cloudflare uses that file as the project's configuration for the settings it covers (compatibility date and flags) on each new deployment. Naming the Pages project **`fern-browser`**, the same as `name` in that file, avoids any mismatch; I could not confirm whether a different name causes problems.

`.github/workflows/ci.yml` runs lint, type check, unit tests, build, the Functions compile check and e2e tests on GitHub Actions.

**Vercel** still works as an alternative (`vercel.json` and `api/inspect.ts` are kept). **Static-only hosts** such as GitHub Pages have no `/api/inspect`. Fern detects that and still loads pages, with the notice "Embed check unavailable — if the page stays blank, the site probably forbids embedding".

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
- **The rate limit is per instance** (in memory). It is best-effort, not a global quota. On Cloudflare, a stronger, account-wide limit would be a WAF rate-limiting rule. Those are configured per zone, so plan on adding a custom domain if you need one; whether they can apply to a bare `*.pages.dev` address is unverified.
- **Cloudflare-specific:** the inspector cannot pin resolved addresses (see the table above). URLs that use a public IP address instead of a host name cannot be checked, because Workers cannot fetch raw IPs. Fern then reports a network error and offers to load the page anyway or open it in a new tab.
- Bookmarks, history, settings and open tabs live in this browser's `localStorage`. They are not synced.
