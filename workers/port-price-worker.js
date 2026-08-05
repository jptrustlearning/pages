/* ============================================================
   port-price — Worker for Port Recorder (JP Trust Learning)
   Endpoints:
     GET  /hist?symbol=AAPL&from=YYYY-MM-DD[&to=YYYY-MM-DD]
          → { symbol, dates:[...], closes:[...], highs:[...], lows:[...] }
     POST /ocr   body: { image: <base64 jpeg/png, no prefix>, media_type }
          → { trades:[{ side, ticker, price, shares, amount, date, confidence }] }
          (Claude vision — requires secret ANTHROPIC_API_KEY)
============================================================ */
const OCR_DAILY_LIMIT = 30; // per-IP per-day soft cap (กันคน spam เผาเครดิต)

export default {
  async fetch(request, env, ctx) {
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/hist' && request.method === 'GET') return hist(url, ctx, CORS);
    if (url.pathname === '/search' && request.method === 'GET') return search(url, ctx, CORS);
    if (url.pathname === '/ocr' && request.method === 'POST') return ocr(request, env, ctx, CORS);
    return json({ ok: true, service: 'port-price', endpoints: ['/hist?symbol=AAPL&from=YYYY-MM-DD', '/search?q=apple', 'POST /ocr'] }, 200, CORS);
  },
};

/* ---------------- /hist : Yahoo Finance ---------------- */
async function hist(url, ctx, CORS) {
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(symbol)) return json({ error: 'bad symbol' }, 400, CORS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return json({ error: 'bad from (YYYY-MM-DD)' }, 400, CORS);

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
  const p2 = Math.floor(Date.parse(effTo + 'T00:00:00Z') / 1000) + 86400;
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

  let dates = [], closes = [], highs = [], lows = [];
  try {
    const j = await yr.json();
    const r = j.chart && j.chart.result && j.chart.result[0];
    if (!r) throw new Error('no result');
    const ts = r.timestamp || [];
    const q = r.indicators || {};
    const adj = q.adjclose && q.adjclose[0] && q.adjclose[0].adjclose;
    const quote = (q.quote && q.quote[0]) || {};
    const raw = quote.close;
    const hiA = quote.high || [], loA = quote.low || [];
    const src = adj || raw || [];
    const tz = (r.meta && r.meta.exchangeTimezoneName) || 'UTC';
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    for (let i = 0; i < ts.length; i++) {
      const c = src[i];
      if (c == null || !isFinite(c)) continue;
      dates.push(fmt.format(new Date(ts[i] * 1000)));
      closes.push(Math.round(c * 10000) / 10000);
      const h = (hiA[i] != null && isFinite(hiA[i])) ? hiA[i] : c;
      const l = (loA[i] != null && isFinite(loA[i])) ? loA[i] : c;
      highs.push(Math.round(h * 10000) / 10000);
      lows.push(Math.round(l * 10000) / 10000);
    }
  } catch (e) {
    return json({ error: 'parse: ' + e.message }, 502, CORS);
  }
  if (!dates.length) return json({ error: 'no data for ' + symbol }, 404, CORS);

  const body = JSON.stringify({ symbol, dates, closes, highs, lows });
  const res = new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...CORS, 'X-Cache': 'MISS' },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ---------------- /search : Yahoo ticker lookup (name + exchange) ---------------- */
async function search(url, ctx, CORS) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 1) return json({ quotes: [] }, 200, CORS);
  if (q.length > 40) return json({ error: 'query too long' }, 400, CORS);

  const cacheKey = new Request(`https://cache.port-price/search/${encodeURIComponent(q.toLowerCase())}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const res = new Response(hit.body, hit);
    Object.entries(CORS).forEach(([k, v]) => res.headers.set(k, v));
    res.headers.set('X-Cache', 'HIT');
    return res;
  }

  const yUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
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
  if (!yr.ok) return json({ error: 'yahoo ' + yr.status }, 502, CORS);

  const OK_TYPES = ['EQUITY', 'ETF', 'INDEX', 'CRYPTOCURRENCY', 'CURRENCY', 'FUTURE', 'MUTUALFUND'];
  let quotes = [];
  try {
    const j = await yr.json();
    quotes = (j.quotes || [])
      .filter(function (x) { return x.symbol && OK_TYPES.includes(x.quoteType); })
      .map(function (x) {
        return { symbol: x.symbol, name: x.shortname || x.longname || x.symbol, exchange: x.exchDisp || x.exchange || '', type: x.quoteType };
      })
      .slice(0, 8);
  } catch (e) {
    return json({ error: 'parse: ' + e.message }, 502, CORS);
  }

  const body = JSON.stringify({ quotes });
  const res = new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400', ...CORS, 'X-Cache': 'MISS' },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ---------------- /ocr : Claude vision slip reader ---------------- */
async function ocr(request, env, ctx, CORS) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'OCR not configured (missing ANTHROPIC_API_KEY secret)' }, 500, CORS);

  // per-IP daily soft cap via edge cache
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const capKey = new Request(`https://cache.port-price/ocrcap/${day}/${encodeURIComponent(ip)}`);
  const cache = caches.default;
  let count = 0;
  const capHit = await cache.match(capKey);
  if (capHit) { try { count = (await capHit.json()).n || 0; } catch (e) {} }
  if (count >= OCR_DAILY_LIMIT) return json({ error: 'daily OCR limit reached — ลองใหม่พรุ่งนี้ หรือกรอกเอง' }, 429, CORS);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, CORS); }
  const image = (body.image || '').replace(/^data:[^,]+,/, '');
  const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(body.media_type) ? body.media_type : 'image/jpeg';
  if (!image || image.length < 100) return json({ error: 'no image' }, 400, CORS);
  if (image.length > 2400000) return json({ error: 'image too large' }, 413, CORS);

  const today = new Date().toISOString().slice(0, 10);
  const prompt = 'You are reading a screenshot from a stock brokerage app (Thai brokers like Dime!, InnovestX, Streaming, or international apps). The app language may be THAI or ENGLISH. It may show ONE order detail page, or a LIST of multiple orders.\n'
    + 'Extract every distinct EXECUTED trade visible. Respond with ONLY this JSON, no markdown fences, no other text:\n'
    + '{"trades":[{"side":"buy"|"sell","ticker":"SYMBOL","price":number or null,"shares":number or null,"amount":number or null,"date":"YYYY-MM-DD" or null,"confidence":"high"|"low"}]}\n'
    + 'EVERY number you output MUST be in USD. Never output a THB value.\n'
    + 'STEP 1 — CURRENCY CHECK. Do this FIRST, before reading any other number. Look at the big headline amount near the top of the order (next to Buy/Sell + ticker). It is labelled either THB or USD.\n'
    + 'CASE A — headline is THB (e.g. "1,329.86 THB"): the app is displaying Thai baht totals. IGNORE EVERY THB NUMBER on the screen — the headline amount, "Stock Amount", "มูลค่าหุ้น", "Commission Fee", "ค่าธรรมเนียม", "VAT". Do NOT convert them yourself. Do NOT use the "Exchange Rate" / "อัตราแลกเปลี่ยน" row for anything.\n'
    + '  For CASE A: price = "Executed Price" (this field is already USD), shares = "Shares", amount = price x shares. Then sanity-check against the "USD Amount" row if present: it should match price x shares within 1%. If it differs by more than 1%, still output price x shares but set confidence "low".\n'
    + 'CASE B — headline is USD: the app is displaying dollars, use the amount rules below normally.\n'
    + 'Rules per trade:\n'
    + '- side: ซื้อ/Buy = "buy"; ขาย/Sell = "sell". On detail pages the word sits right before the ticker (e.g. "Buy LUV").\n'
    + '- ticker: symbol only, uppercase (AAPL, LUV, PTT.BK). Strip exchange tags/flags like ":NASDAQ", "NYSE" and company names.\n'
    + '- price: the FILLED price per share, always USD. Labels: "Executed Price", "Average Price", "ราคาที่ได้จริง", "ราคาเฉลี่ย", "ราคาที่จับคู่". NEVER use "Limit Price" / "ราคาที่ตั้ง" (that is the order price, not the fill) and never the current market price.\n'
    + '- shares: filled quantity ("Shares", "จำนวนหุ้น"), may be fractional like 0.8039926.\n'
    + '- amount (CASE B only): value of shares EXCLUDING commission/fees/VAT. Labels "มูลค่าหุ้น" / "Stock Amount". The big headline amount (e.g. "25.00 USD") often INCLUDES fees — prefer "มูลค่าหุ้น"/"Stock Amount" or compute price x shares. Numbers may contain thousands commas (2,088.00 = 2088).\n'
    + '- Cross-check: price x shares should ~= amount within 1%; if inconsistent, trust price and shares.\n'
    + '- date: the EXECUTION/FILL date. Prefer "Completion date" / "วันที่คำสั่งสำเร็จ" over "Submission Date" / "วันที่ส่งคำสั่ง" (order-sent). Output YYYY-MM-DD, drop the time.\n'
    + '- English date format "11 Feb 2026 - 10:50 PM" -> 2026-02-11. English months: Jan=01 Feb=02 Mar=03 Apr=04 May=05 Jun=06 Jul=07 Aug=08 Sep=09 Oct=10 Nov=11 Dec=12.\n'
    + '- YEAR RULE: a 4-digit year BELOW 2500 is already Gregorian (CE) — use it as-is, do NOT subtract 543 (2026 stays 2026). A 4-digit year >= 2500 is Thai Buddhist Era — subtract 543 (2569 -> 2026).\n'
    + '- TWO-DIGIT years on Thai screens are Buddhist Era too: "1 ก.ค. 69" means BE 2569 -> 2026-07-01 (NOT 1969/2069). Convert: 2-digit yy -> 2500+yy -> minus 543.\n'
    + '- Thai months: ม.ค.=01 ก.พ.=02 มี.ค.=03 เม.ย.=04 พ.ค.=05 มิ.ย.=06 ก.ค.=07 ส.ค.=08 ก.ย.=09 ต.ค.=10 พ.ย.=11 ธ.ค.=12. Thai numeric dates are day/month/year.\n'
    + '- Today is ' + today + '; dates must not be in the future.\n'
    + '- List screens: one element per order row (same ticker on different rows/times = separate trades). Include only executed/filled orders — status "จับคู่แล้ว"/"กำลังคืนเงิน"/"Filled"/"Completed" counts as executed; skip pending/cancelled.\n'
    + '- SKIP rows that are NOT stock trades: dividends (ปันผล/รับเงินเข้า/Dividend), withholding tax (ภาษีหัก ณ ที่จ่าย), fees (ค่าธรรมเนียม/Commission), deposits/withdrawals, interest, coupons/discounts (Special Coupons). Only ซื้อ/ขาย/Buy/Sell orders become trades.\n'
    + '- SELL rows in lists: the big headline number is the SHARE COUNT ("0.3650863 หุ้น"), not money. price = ราคาที่ได้จริง; amount = price x shares.\n'
    + '- SELL detail pages: use "มูลค่าหุ้น"/"Stock Amount" (gross) as amount, NOT "ยอดที่จะได้รับคืน" (net proceeds after fees) — and if those are in THB, fall back to CASE A rules.\n'
    + '- confidence "low" only if blurry or a key field is ambiguous.';

  let ar;
  try {
    ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
  } catch (e) {
    return json({ error: 'api fetch failed' }, 502, CORS);
  }
  if (!ar.ok) {
    const t = await ar.text();
    return json({ error: 'claude ' + ar.status, detail: t.slice(0, 200) }, ar.status === 429 ? 429 : 502, CORS);
  }

  let out;
  try {
    const j = await ar.json();
    const text = (j.content || []).filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join('\n');
    out = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e) {
    return json({ error: 'parse model output failed' }, 502, CORS);
  }

  ctx.waitUntil(cache.put(capKey, new Response(JSON.stringify({ n: count + 1 }), {
    headers: { 'Cache-Control': 'max-age=86400' },
  })));

  return json(out, 200, CORS);
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
