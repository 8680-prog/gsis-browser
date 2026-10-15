# Fern

A dark, tabbed browser workspace that runs in a normal web browser (including Chromebooks). It has a sidebar, real tabs with their own history, an address/search bar, bookmarks, history, Games and Apps catalogs, and settings. Websites open inside the app **when the website allows embedding**. When a site forbids it, Fern says so and offers to open the site in a normal browser tab.

## How it works

```
Browser (React SPA)                                   Vercel
┌───────────────────────────────┐   GET /api/inspect   ┌──────────────────────────────┐
│ address bar → normalize input │ ───────────────────▶ │ Node function (server/)      │
│ tab: per-tab history stack    │ ◀─────────────────── │  • SSRF guards, DNS pinning  │
│ iframe (sandboxed)  ◀── site  │   metadata only:     │  • reads status, XFO/CSP,    │
└───────────────────────────────┘   status, framing,   │    <title>; never the page   │
                                     title, errors      └──────────────────────────────┘
```

**Why there is a backend.** A page cannot find out from JavaScript why a cross-origin iframe failed. The `load` event fires even when the browser refused the frame because of `X-Frame-Options` or CSP `frame-ancestors`, and DNS or TLS failures look the same. Without help, the user just sees a blank box. Before mounting the iframe, Fern calls `/api/inspect`. That endpoint fetches the URL server-side and reports:

- the final URL after redirects
- the HTTP status
- whether the framing headers allow embedding on Fern's origin
- the page title
- network errors: DNS, refused, TLS, timeout, too many redirects

**It is not a proxy.** It never returns page content, and the page itself is always loaded by the user's browser directly from the site.

**Security of the inspector** (`server/`):

- Only `http`/`https` on ports 80/443, with no credentials in the URL.
- Internal host names are refused: `localhost`, `*.local`, `*.internal`, single-label names and so on.
- DNS is resolved through a custom `lookup`. If *any* resolved address is private, loopback, link-local, CGNAT, ULA, multicast, reserved, NAT64/6to4/Teredo or IPv4-mapped-private, the connection is refused. This covers `169.254.169.254` and `fd00:ec2::254`. The socket connects only to the addresses that were checked, which prevents DNS rebinding.
- Literal IP hosts are checked before connecting, including normalized forms such as `2130706433`.
- Redirects are followed manually (at most 5), and every hop is validated again.
- Requests time out after 8 s overall. At most 256 KB of the decoded body is read (for `<title>`), then the connection is closed.
- No cookies are sent or stored, and requests use an honest User-Agent.
- Requests flagged by browsers as `Sec-Fetch-Site: cross-site` are rejected. There is a per-instance rate limit of 40 requests per minute per client.

**Iframes** use `sandbox` without `allow-top-navigation`, so an embedded page cannot navigate Fern away. Popups (links with `target=_blank`) open real browser tabs.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | App shell, tab state, persistence, keyboard shortcuts |
| `src/components/` | `Sidebar`, `TabStrip`, `Toolbar` (address bar), `WebFrame` (embed check, iframe, blocked/error states) |
| `src/pages/` | Internal `fern://` pages: home, bookmarks, history, games, apps, settings |
| `src/lib/` | URL normalization, search engines, tabs reducer, storage, inspect client, catalog |
| `server/` | Embed inspector: `framePolicy.ts`, `netGuard.ts`, `inspect.ts`, `handler.ts` |
| `api/inspect.ts` | Vercel serverless entry for `GET /api/inspect` |
| `vite.config.ts` | Also serves `/api/inspect` during `npm run dev` and `npm run preview` |
| `tests/unit` | Vitest: URL parsing, tabs, frame-policy rules, SSRF guards, inspector against local servers |
| `tests/e2e` | Playwright: the full app in Chromium against local fixture sites with different embedding policies |

## Local development

```bash
npm ci
npm run dev        # http://localhost:5173 (includes /api/inspect)
npm run lint
npm run typecheck
npm test           # unit tests
npm run build      # production build into dist/
npm run preview    # serve dist/ with /api/inspect
npm run test:e2e   # builds, then runs Playwright (needs a Chromium: npx playwright install chromium)
```

Requires Node 22 (see `.nvmrc`).

## Deploying (free): Vercel + GitHub

Vercel's free Hobby plan hosts both the static app and the Node function. `vercel.json` already contains everything:

- **Framework preset:** Vite
- **Install command:** `npm ci`
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Function:** `api/inspect.ts` (Node.js, `maxDuration` 10 s)
- **Security headers** for the app: CSP with `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`
- **Environment variables:** none required. No secrets are used anywhere.

Steps:

1. Push this repository to GitHub.
2. Sign in at <https://vercel.com> with GitHub. Choose **Add New → Project**, then import the repository.
3. Keep the detected settings (they come from `vercel.json`) and click **Deploy**.
4. Every push to `main` redeploys. Pull requests get preview URLs, and `.github/workflows/ci.yml` runs lint, type check, unit tests, build and e2e tests on GitHub Actions.

You can also deploy with the CLI: `npx vercel` (preview) or `npx vercel --prod`.

**Static-only hosts** (GitHub Pages, Cloudflare Pages without Functions) can serve `dist/`, but they have no `/api/inspect`. Fern detects that and still loads pages, with a notice: "Embed check unavailable — if the page stays blank, the site probably forbids embedding." Blocked sites then show the browser's own blank or error frame instead of Fern's explanation. Netlify Functions or any Node host could run `server/handler.ts`, but only the Vercel setup is configured and verified.

## Known limitations

These are inherent to running a browser inside a web page:

- **Many major sites cannot be embedded.** Google, Bing, DuckDuckGo, YouTube's main site, social networks, banks and most sign-in pages send `X-Frame-Options` or `frame-ancestors`. Browsers enforce these, and no header trick on Fern's side can change that. Fern shows a clear notice and an "Open in a new browser tab" button. Many reference, documentation and small sites allow embedding (Wikipedia and OpenStreetMap's embed page have historically allowed it). The live check decides each time.
- **Search results usually open the notice**, because most search engines forbid framing. You can pick another engine or a custom URL template (`%s` = query) in Settings.
- **Cross-origin pages hide their address and title from Fern.** After you click links *inside* an embedded page, the address bar keeps showing the last address opened through Fern; an ⓘ icon marks this. Fern's Back/Forward/Reload act on the addresses opened through Fern. Titles come from the server-side check of the opened URL.
- **Signing in inside a frame often fails**, because browsers block or partition third-party cookies. Use "Open in a new browser tab".
- **The check is advisory.** A site may send different headers to Fern's server than to your browser, for example behind bot protection or geo-blocking. If the check passes but the site still refuses, the frame stays blank or shows the browser's error page. A "slow/blank" notice appears after 20 s, and "Open in a new browser tab" is always available in the toolbar.
- **`http://` pages** cannot be embedded when Fern is served over `https` (mixed content). Fern offers the https version instead.
- **Keyboard shortcuts** work only while focus is in Fern's interface, not inside an embedded page. Chrome reserves Ctrl+T/Ctrl+W in normal windows, so Alt+T/Alt+W are provided.
- **The rate limit is per serverless instance** (in memory). It is best-effort, not a global quota.
- Bookmarks, history, settings and open tabs live in this browser's `localStorage`. They are not synced.
