// Local stand-ins for public websites with different embedding policies.
// Host-based routing: Chromium maps *.test to 127.0.0.1 during e2e tests.
import http from 'node:http';

const PORT = Number(process.env.FIXTURE_PORT || 4101);
const counters = new Map();

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif">${body}</body></html>`;
}

http
  .createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const send = (status, headers, html) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(html);
    };
    const key = `${host}${url.pathname}`;
    counters.set(key, (counters.get(key) || 0) + 1);

    switch (host) {
      case 'frame-ok.test':
        if (url.pathname === '/page2') return send(200, {}, page('Second Page', '<h1>Second fixture page</h1><a id="next" href="/page3">Go to page 3</a>'));
        if (url.pathname === '/page3') return send(200, {}, page('Third Page', '<h1>Third fixture page</h1>'));
        if (url.pathname === '/counter') return send(200, {}, page('Counter', `<h1 id="count">Load #${counters.get(key)}</h1>`));
        return send(200, {}, page('Frame OK Fixture', '<h1>Embeddable fixture page</h1><a id="next" href="/page2">Go to page 2</a>'));
      case 'other-ok.test':
        if (url.pathname === '/b') return send(200, {}, page('Other B', '<h1>Other site page B</h1>'));
        return send(200, {}, page('Other Site', '<h1>Another embeddable site</h1><a id="next" href="/b">Go to B</a>'));
      case 'frame-xfo.test':
        return send(200, { 'x-frame-options': 'DENY' }, page('XFO Fixture', '<h1>SECRET XFO CONTENT</h1>'));
      case 'frame-csp.test':
        return send(200, { 'content-security-policy': "frame-ancestors 'none'" }, page('CSP Fixture', '<h1>SECRET CSP CONTENT</h1>'));
      case 'frame-allowlist.test':
        return send(200, { 'content-security-policy': 'frame-ancestors http://localhost:4173', 'x-frame-options': 'DENY' }, page('Allowlisted', '<h1>Allowlisted embed</h1>'));
      case 'redirect.test':
        res.writeHead(302, { location: 'http://frame-ok.test:4101/' });
        return res.end();
      case 'search.test':
        return send(200, {}, page(`Results for ${url.searchParams.get('q')}`, `<h1 id="q">Query: ${(url.searchParams.get('q') || '').replace(/[<>&]/g, '')}</h1>`));
      case 'slow.test':
        return; // never answers
      default:
        return send(404, {}, page('Not found', 'unknown fixture host'));
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fixtures on ${PORT}`));
