/* ============================================================
   port-price — Yahoo Finance proxy for Port Recorder
   Deploy: Cloudflare Workers (Free plan)
   Endpoint:
     GET /hist?symbol=AAPL&from=2026-01-15[&to=2026-07-04]
     → { symbol, dates:[YYYY-MM-DD...], closes:[number...] }
   Notes:
   - Daily closes, adjusted (Yahoo adjclose when available)
   - Edge cache: same symbol+range cached until next UTC day
   - CORS: open GET (data is public market data)
============================================================ */
export default {
  async fetch(request, env, ctx) {
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return json({ error: 'method' }, 405, CORS);

    const url = new URL(request.url);
    if (url.pathname !== '/hist') return json({ ok: true, service: 'port-price', usage: '/hist?symbol=AAPL&from=YYYY-MM-DD' }, 200, CORS);

    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    if (!/^[A-Z0-9.\-^=]{1,12}$/.test(symbol)) return json({ error: 'bad symbol' }, 400, CORS);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return json({ error: 'bad from (YYYY-MM-DD)' }, 400, CORS);

    // cache key: normalize "to" to today (UTC) so daily requests hit cache
    const today = new Date().toISOString().slice(0, 10);
    const effTo = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;
    const cacheKey = new Request(`https://cache.port-price/hist/${symbol}/${from}/${effTo}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) {
      const res = new Response(hit.body, hit);
      Object.entries(CORS).forEach(([k, v]) => res.headers.set(k, v));
      res.headers.set('X-Cache', 'HIT');
      return res;
    }

    const p1 = Math.floor(Date.parse(from + 'T00:00:00Z') / 1000);
    const p2 = Math.floor(Date.parse(effTo + 'T00:00:00Z') / 1000) + 86400; // inclusive
    if (!(p1 > 0) || !(p2 > p1)) return json({ error: 'bad range' }, 400, CORS);

    const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
    let yr;
    try {
      yr = await fetch(yUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'application/json',
        },
        cf: { cacheTtl: 0 },
      });
    } catch (e) {
      return json({ error: 'upstream fetch failed' }, 502, CORS);
    }
    if (!yr.ok) return json({ error: 'yahoo ' + yr.status }, yr.status === 404 ? 404 : 502, CORS);

    let dates = [], closes = [];
    try {
      const j = await yr.json();
      const r = j.chart && j.chart.result && j.chart.result[0];
      if (!r) throw new Error('no result');
      const ts = r.timestamp || [];
      const q = r.indicators || {};
      const adj = q.adjclose && q.adjclose[0] && q.adjclose[0].adjclose;
      const raw = q.quote && q.quote[0] && q.quote[0].close;
      const src = adj || raw || [];
      const tz = (r.meta && r.meta.exchangeTimezoneName) || 'UTC';
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      for (let i = 0; i < ts.length; i++) {
        const c = src[i];
        if (c == null || !isFinite(c)) continue;
        dates.push(fmt.format(new Date(ts[i] * 1000)));
        closes.push(Math.round(c * 10000) / 10000);
      }
    } catch (e) {
      return json({ error: 'parse: ' + e.message }, 502, CORS);
    }
    if (!dates.length) return json({ error: 'no data for ' + symbol }, 404, CORS);

    const body = JSON.stringify({ symbol, dates, closes });
    const res = new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...CORS, 'X-Cache': 'MISS' },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
