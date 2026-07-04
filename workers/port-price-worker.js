/* ============================================================
   port-price — Worker for Port Recorder (JP Trust Learning)
   Endpoints:
     GET  /hist?symbol=AAPL&from=YYYY-MM-DD[&to=YYYY-MM-DD]
          → { symbol, dates:[...], closes:[...] }   (Yahoo Finance daily)
     POST /ocr   body: { image: <base64 jpeg/png, no prefix>, media_type }
          → { side, ticker, price, shares, amount, date, confidence }
          (Claude Haiku vision — requires secret ANTHROPIC_API_KEY)
   Setup secret (ครั้งเดียว):
     Worker → Settings → Variables and Secrets → Add
     name: ANTHROPIC_API_KEY  · type: Secret · value: sk-ant-...
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
    if (url.pathname === '/ocr' && request.method === 'POST') return ocr(request, env, ctx, CORS);
    return json({ ok: true, service: 'port-price', endpoints: ['/hist?symbol=AAPL&from=YYYY-MM-DD', 'POST /ocr'] }, 200, CORS);
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
  const prompt = 'You are reading a stock brokerage trade slip / order confirmation (from Thai or international broker apps such as Dime, InnovestX, Streaming, Webull, IBKR, Schwab, etc.). Extract the trade details carefully.\n'
    + 'Respond with ONLY a JSON object, no markdown fences, no other text:\n'
    + '{"side":"buy"|"sell","ticker":"SYMBOL or empty string","price":number or null,"shares":number or null,"amount":number or null,"date":"YYYY-MM-DD" or null,"confidence":"high"|"low"}\n'
    + 'Rules:\n'
    + '- side: ซื้อ/Buy/Bought = "buy"; ขาย/Sell/Sold = "sell".\n'
    + '- ticker: the stock symbol only (e.g. AAPL, NVDA, PTT.BK). If shown as "AAPL:NASDAQ" or with company name, return just the symbol, uppercase. Empty string if truly unclear.\n'
    + '- price: the EXECUTED/FILLED average price per share (ราคาเฉลี่ย/ราคาที่จับคู่/Filled/Avg price). If both a limit/order price and a filled price appear, use the filled price. Do NOT use the current market price shown elsewhere on screen.\n'
    + '- shares: quantity of shares actually filled (จำนวนหุ้น). May be fractional.\n'
    + '- amount: total trade value = price x shares (มูลค่า/ยอดรวม). EXCLUDE commission/fees/VAT (ค่าคอมมิชชั่น/ค่าธรรมเนียม). If only amount-with-fees is shown, prefer price x shares.\n'
    + '- Cross-check: if price, shares and amount are all visible, they must be consistent (price x shares ~= amount within 1%). If not, trust price and shares.\n'
    + '- date: the trade/execution date as YYYY-MM-DD.\n'
    + '- IMPORTANT Thai Buddhist Era: Thai slips often use พ.ศ. years (e.g. 2569, 04/07/2569, 4 ก.ค. 2569). If the year is 2500 or greater, subtract 543 to convert to CE (2569 -> 2026).\n'
    + '- Thai month abbreviations: ม.ค.=01 ก.พ.=02 มี.ค.=03 เม.ย.=04 พ.ค.=05 มิ.ย.=06 ก.ค.=07 ส.ค.=08 ก.ย.=09 ต.ค.=10 พ.ย.=11 ธ.ค.=12.\n'
    + '- Thai numeric dates are day/month/year (04/07/2569 = 4 July 2026), NOT month/day.\n'
    + '- Today is ' + today + '; the final date must not be in the future. If no date is visible, use null.\n'
    + '- If the image contains multiple orders, use the most recent FILLED/executed one.\n'
    + '- confidence "low" only if the image is blurry or key fields are ambiguous.';

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
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
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
