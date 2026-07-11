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
      .filter((x) => x.symbol && OK_TYPES.includes(x.quoteType))
      .map((x) => ({
        symbol: x.symbol,
        name: x.shortname || x.longname || x.symbol,
        exchange: x.exchDisp || x.exchange || '',
        type: x.quoteType,
      }))
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
  const prompt = 'You are reading a screenshot from a stock brokerage app or statement (brokers used in Thailand like Dime!, Webull Thailand, InnovestX, Streaming, or international apps). It may show ONE order detail page, a LIST of multiple orders, or an account statement / TRADE RECORDS table.\n'
    + 'Extract every distinct EXECUTED trade visible. Respond with ONLY this JSON, no markdown fences, no other text:\n'
    + '{"trades":[{"side":"buy"|"sell","ticker":"SYMBOL","price":number or null,"shares":number or null,"amount":number or null,"date":"YYYY-MM-DD" or null,"date_text":"the date EXACTLY as printed on screen, e.g. 01/07/2026 or 1 ก.ค. 69 or Jul 1, 2026","confidence":"high"|"low"}]}\n'
    + 'Rules per trade:\n'
    + '- side: ซื้อ/Buy = "buy"; ขาย/Sell = "sell".\n'
    + '- ticker: symbol only, uppercase (AAPL, PTT.BK). Strip exchange tags like ":NASDAQ" and company names.\n'
    + '- price: the FILLED price per share. Thai labels: "ราคาที่ได้จริง", "ราคาเฉลี่ย", "ราคาที่จับคู่". NOT the limit price, NOT current market price.\n'
    + '- shares: filled quantity ("จำนวนหุ้น"), may be fractional like 0.2138450.\n'
    + '- amount: value of shares EXCLUDING commission/fees/VAT. Thai label "มูลค่าหุ้น". The big headline amount (e.g. "25.00 USD") often INCLUDES fees — prefer "มูลค่าหุ้น" or compute price x shares. Numbers may contain thousands commas (2,088.00 = 2088).\n'
    + '- Cross-check: price x shares should ~= amount within 1%; if inconsistent, trust price and shares.\n'
    + '- date: execution/fill date ("วันที่คำสั่งสำเร็จ" preferred over order-sent date) as YYYY-MM-DD.\n'
    + '- THAI BUDDHIST ERA years: 4-digit >= 2500 -> subtract 543 (2569 -> 2026). TWO-DIGIT Thai years are BE too: "1 ก.ค. 69" means BE 2569 -> 2026-07-01 (NOT 1969/2069). Convert: 2-digit yy -> 2500+yy -> minus 543.\n'
    + '- Thai months: ม.ค.=01 ก.พ.=02 มี.ค.=03 เม.ย.=04 พ.ค.=05 มิ.ย.=06 ก.ค.=07 ส.ค.=08 ก.ย.=09 ต.ค.=10 พ.ย.=11 ธ.ค.=12.\n'
    + '- NUMERIC DATE ORDER — IMPORTANT: brokers used in Thailand (Dime!, Webull Thailand, InnovestX, Streaming) write numeric dates as DAY/MONTH/YEAR. "01/07/2026" = 1 July 2026, NOT January 7 — even when the app UI is English and shows a US timezone like EDT/EST next to the time (Webull Thailand does this). Interpret month-first ONLY when the month is written as a word in US order (e.g. "Jul 1, 2026").\n'
    + '- Account statements / TRADE RECORDS tables: one trade per table row. Use the Trade Date column (day/month/year), Buy/Sell column for side, Quantity for shares, Traded Price for price, Gross Amount for amount (fallback: price x quantity). Skip non-stock rows (dividends, fees, deposits).\n'
    + '- Today is ' + today + '; dates must not be in the future.\n'
    + '- List screens: one element per order row (same ticker on different rows/times = separate trades). Include only executed/filled orders — status "จับคู่แล้ว"/"กำลังคืนเงิน"/Filled counts as executed; skip pending/cancelled.\n'
    + '- SKIP rows that are NOT stock trades: dividends (ปันผล/รับเงินเข้า), withholding tax (ภาษีหัก ณ ที่จ่าย), fees (ค่าธรรมเนียม...), deposits/withdrawals, interest. Only ซื้อ/ขาย orders become trades.\n'
    + '- SELL rows in lists: the big headline number is the SHARE COUNT ("0.3650863 หุ้น"), not money. price = ราคาที่ได้จริง; amount = price x shares.\n'
    + '- SELL detail pages: use "มูลค่าหุ้น" (gross) as amount, NOT "ยอดที่จะได้รับคืน" (net proceeds after fees).\n'
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
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
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

  // Deterministic date fix: parse date_text ourselves (Thai-market brokers = day/month/year)
  try {
    if (out && Array.isArray(out.trades)) {
      out.trades.forEach(function (t) {
        const fixed = normDate(t && t.date_text, t && t.date);
        if (fixed) t.date = fixed;
      });
    }
  } catch (e) {}

  ctx.waitUntil(cache.put(capKey, new Response(JSON.stringify({ n: count + 1 }), {
    headers: { 'Cache-Control': 'max-age=86400' },
  })));

  return json(out, 200, CORS);
}

/* แปลงข้อความวันที่ดิบ -> YYYY-MM-DD (เลขล้วน = วัน/เดือน/ปี เสมอ, รองรับ พ.ศ. และเดือนไทย/อังกฤษ) */
function normDate(txt, fallbackIso) {
  const iso = function (y, mo, d) {
    if (!(y > 1990 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };
  const fixYear = function (y) {
    if (y >= 2500) return y - 543;            // พ.ศ. 4 หลัก
    if (y < 100) return y >= 60 ? y + 2500 - 543 : y + 2000; // 2 หลัก: 69 = พ.ศ.2569, 26 = ค.ศ.2026
    return y;
  };
  if (!txt) return fallbackIso || null;
  txt = String(txt).trim();

  let m = txt.match(/(\d{4})-(\d{2})-(\d{2})/); // ISO อยู่แล้ว
  if (m) return iso(+m[1], +m[2], +m[3]);

  // เดือนไทยย่อ/เต็ม
  const TH = { 'ม.ค': 1, 'มกราคม': 1, 'ก.พ': 2, 'กุมภาพันธ์': 2, 'มี.ค': 3, 'มีนาคม': 3, 'เม.ย': 4, 'เมษายน': 4,
    'พ.ค': 5, 'พฤษภาคม': 5, 'มิ.ย': 6, 'มิถุนายน': 6, 'ก.ค': 7, 'กรกฎาคม': 7, 'ส.ค': 8, 'สิงหาคม': 8,
    'ก.ย': 9, 'กันยายน': 9, 'ต.ค': 10, 'ตุลาคม': 10, 'พ.ย': 11, 'พฤศจิกายน': 11, 'ธ.ค': 12, 'ธันวาคม': 12 };
  for (const k in TH) {
    if (txt.indexOf(k) >= 0) {
      const dm = txt.match(/(\d{1,2})/);
      const nums = txt.match(/\d{1,4}/g) || [];
      const ym = nums.length ? nums[nums.length - 1] : null;
      if (dm && ym) return iso(fixYear(+ym), TH[k], +dm[1]);
    }
  }

  // เดือนอังกฤษเป็นคำ: "Jul 1, 2026" หรือ "1 Jul 2026"
  const EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const low = txt.toLowerCase();
  m = low.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/);
  if (m && EN[m[1].slice(0, 3)]) return iso(fixYear(+m[3]), EN[m[1].slice(0, 3)], +m[2]);
  m = low.match(/(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{2,4})/);
  if (m && EN[m[2].slice(0, 3)]) return iso(fixYear(+m[3]), EN[m[2].slice(0, 3)], +m[1]);

  // ตัวเลขล้วน: วัน/เดือน/ปี เสมอ (โบรกที่ใช้ในไทย)
  m = txt.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let d = +m[1], mo = +m[2];
    const y = fixYear(+m[3]);
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } // เขียนสลับชัดเจนค่อยสลับกลับ
    return iso(y, mo, d) || fallbackIso || null;
  }
  return fallbackIso || null;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
