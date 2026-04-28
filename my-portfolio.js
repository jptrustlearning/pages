/* ============================================================
   My Portfolio — JP Trust Learning
   Storage: Supabase (portfolio_lots + portfolio_sells)
   Data: SP500 daily CSV (cached in memory)
============================================================ */
(function(){
'use strict';

const SUPABASE_URL  = 'https://rcdukwwcbyryauhqlzmx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZHVrd3djYnlyeWF1aHFsem14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MTY0MDAsImV4cCI6MjA4NTQ5MjQwMH0.rprPmudJYyb6dyhXb9Z9GrtQWEeIX99A2Wrj55PvS54';
const PRICE_CSV   = 'https://raw.githubusercontent.com/jptrustlearning/sp500/main/input_sp500_daily.csv';
const SECTOR_CSV  = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';

let sb = null;
try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON); }
catch(e) { console.error('Supabase init failed', e); }

/* Global state */
const S = {
  user: null,
  lots: [],          // [{id, ticker, entry_date, amount_usd, entry_price, shares, notes, created_at, sells:[]}]
  // price data
  tickers: [],       // sorted unique tickers in CSV
  sectors: {},       // ticker -> sector
  prices: {},        // ticker -> { dates:[YYYY-MM-DD,...], closes:[number,...] }  (sorted asc)
  allDates: [],      // union of all trading dates (sorted asc)
  latestDate: null,
  currentTab: 'lots',
  currentTf: 'YTD',
};

/* ============================================================
   LOADER PROGRESS
============================================================ */
function setProgress(pct){
  pct = Math.max(0, Math.min(100, pct));
  const ring = document.getElementById('owlLoaderRingFg');
  const label = document.getElementById('owlLoaderPct');
  if (ring){
    const C = 565.48;  // 2*pi*r at r=90
    const v = (C * pct / 100);
    ring.style.strokeDasharray = `${v} ${C}`;
  }
  if (label) label.textContent = Math.round(pct) + '%';
}

function showApp(){
  document.getElementById('loaderView').style.display='none';
  document.getElementById('gateView').style.display='none';
  document.getElementById('appView').style.display='block';
}
function showGate(){
  document.getElementById('loaderView').style.display='none';
  document.getElementById('appView').style.display='none';
  document.getElementById('gateView').style.display='flex';
}

/* ============================================================
   TOAST
============================================================ */
let toastT = null;
function toast(msg, kind){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (kind || 'ok');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(()=>{ el.className = 'toast'; }, 2400);
}

/* ============================================================
   FORMATTERS
============================================================ */
const fmtUSD = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
};
const fmtUSDsigned = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
};
const fmtShares = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return v.toLocaleString('en-US', {minimumFractionDigits:4, maximumFractionDigits:4});
};
const fmtPct = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
};
const pnlClass = (v) => v > 0.005 ? 'pnl-pos' : (v < -0.005 ? 'pnl-neg' : 'pnl-zero');
const pnlText  = (v) => v > 0.005 ? 'text-green' : (v < -0.005 ? 'text-red' : 'text-zero');

function todayISO(){
  const d = new Date();
  // local date — format as YYYY-MM-DD
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/* ============================================================
   CSV LOADERS
============================================================ */
async function loadPriceCSV(){
  const res = await fetch(PRICE_CSV);
  if (!res.ok) throw new Error('Failed to load price CSV: ' + res.status);
  const text = await res.text();
  // Long format: Ticker, Date, Open, High, Low, Close, Volume (matches Free_scannerSP500 parser)
  const parsed = window.Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows.length) throw new Error('No data rows in CSV');

  const tmp = {};
  const dateSet = new Set();
  rows.forEach(row => {
    const tk = (row.Ticker || '').trim();
    const d  = (row.Date   || '').trim();
    const cl = parseFloat(row.Close);
    if (!tk || !d || !isFinite(cl) || cl <= 0) return;
    if (!tmp[tk]) tmp[tk] = [];
    tmp[tk].push({ d, c: cl });
    dateSet.add(d);
  });
  const out = {};
  for (const tk of Object.keys(tmp)){
    tmp[tk].sort((a,b) => a.d < b.d ? -1 : 1);
    out[tk] = { dates: tmp[tk].map(x => x.d), closes: tmp[tk].map(x => x.c) };
  }
  S.prices = out;
  S.tickers = Object.keys(out).sort();
  S.allDates = [...dateSet].sort();
  S.latestDate = S.allDates[S.allDates.length - 1];
}

async function loadSectorCSV(){
  try {
    const res = await fetch(SECTOR_CSV);
    if (!res.ok) return;
    const text = await res.text();
    const parsed = window.Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    parsed.data.forEach(row => {
      const sym = (row.Symbol || '').trim();
      const sec = (row['GICS Sector'] || '').trim();
      if (sym && sec) S.sectors[sym] = sec;
      // BRK.B -> BRK-B alias (matches scanner behaviour)
      if (sym.includes('.')) S.sectors[sym.replace('.', '-')] = sec;
    });
  } catch(e) { console.warn('Sector CSV failed (non-fatal)', e); }
}

/* ============================================================
   PRICE LOOKUP
   - Returns { date, close } where date <= requested date
   - If exact date is non-trading, falls back to previous trading day
   - Returns null if no price found before requested date
============================================================ */
function priceOnOrBefore(ticker, dateStr){
  const series = S.prices[ticker];
  if (!series) return null;
  const { dates, closes } = series;
  // binary search: largest index where dates[i] <= dateStr
  let lo=0, hi=dates.length-1, ans=-1;
  while (lo <= hi){
    const mid = (lo+hi) >> 1;
    if (dates[mid] <= dateStr){ ans = mid; lo = mid+1; }
    else hi = mid-1;
  }
  if (ans < 0) return null;
  return { date: dates[ans], close: closes[ans] };
}

function latestPrice(ticker){
  const series = S.prices[ticker];
  if (!series) return null;
  const i = series.dates.length - 1;
  return { date: series.dates[i], close: series.closes[i] };
}

/* Earliest entry_date among all lots (for ALL timeframe) */
function earliestEntryDate(){
  if (!S.lots.length) return null;
  return S.lots.reduce((min, l) => l.entry_date < min ? l.entry_date : min, S.lots[0].entry_date);
}

/* ============================================================
   AUTH + DATA FETCH
============================================================ */
async function fetchUser(){
  if (!sb) return null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    return session?.user || null;
  } catch(e) { console.error(e); return null; }
}

async function fetchLots(){
  if (!sb || !S.user) return;
  const { data: lots, error: e1 } = await sb.from('portfolio_lots')
    .select('*').eq('user_id', S.user.id).order('entry_date', {ascending: false});
  if (e1){ console.error(e1); toast('โหลดข้อมูลล้มเหลว: '+e1.message, 'err'); return; }
  const { data: sells, error: e2 } = await sb.from('portfolio_sells')
    .select('*').eq('user_id', S.user.id).order('exit_date', {ascending: true});
  if (e2){ console.error(e2); }
  // attach sells to their lots
  const sellsByLot = {};
  (sells || []).forEach(s => {
    (sellsByLot[s.lot_id] = sellsByLot[s.lot_id] || []).push(s);
  });
  S.lots = (lots || []).map(l => {
    l.amount_usd  = parseFloat(l.amount_usd);
    l.entry_price = parseFloat(l.entry_price);
    l.shares      = parseFloat(l.shares);
    l.sells = (sellsByLot[l.id] || []).map(s => ({
      ...s,
      exit_price:  parseFloat(s.exit_price),
      shares_sold: parseFloat(s.shares_sold),
    }));
    return l;
  });
}

/* ============================================================
   PER-LOT METRICS
============================================================ */
function lotMetrics(lot){
  const sold = lot.sells.reduce((a,s) => a + s.shares_sold, 0);
  const remaining = lot.shares - sold;
  const realizedPnl = lot.sells.reduce((a,s) => a + (s.exit_price - lot.entry_price) * s.shares_sold, 0);
  const proceeds    = lot.sells.reduce((a,s) => a + s.exit_price * s.shares_sold, 0);
  const lp = latestPrice(lot.ticker);
  const latest = lp ? lp.close : null;
  const unrealizedPnl = (latest !== null && remaining > 0) ? (latest - lot.entry_price) * remaining : 0;
  const marketValue   = (latest !== null && remaining > 0) ? latest * remaining : 0;
  const costRemaining = remaining * lot.entry_price;
  const status = remaining < 1e-8 ? 'closed' : (sold > 1e-8 ? 'partial' : 'open');
  const totalPnl = realizedPnl + unrealizedPnl;
  // pct vs original cost
  const pctOriginal = lot.amount_usd > 0 ? (totalPnl / lot.amount_usd) * 100 : 0;
  const unrealizedPct = costRemaining > 0 ? (unrealizedPnl / costRemaining) * 100 : 0;
  return { sold, remaining, realizedPnl, proceeds, latest, unrealizedPnl, marketValue, costRemaining, status, totalPnl, pctOriginal, unrealizedPct };
}

/* ============================================================
   PORTFOLIO TOTALS (for hero header)
============================================================ */
function totals(){
  let mv=0, cost=0, realized=0, unrealized=0, totalInvested=0;
  S.lots.forEach(lot => {
    const m = lotMetrics(lot);
    mv += m.marketValue;
    cost += m.costRemaining;
    realized += m.realizedPnl;
    unrealized += m.unrealizedPnl;
    totalInvested += lot.amount_usd;
  });
  return { marketValue: mv, costRemaining: cost, realized, unrealized, totalInvested };
}

/* ============================================================
   RENDER: HERO
============================================================ */
function renderHero(){
  const t = totals();
  document.getElementById('heroValue').textContent = fmtUSD(t.marketValue);
  const r = document.getElementById('heroRealized');
  const u = document.getElementById('heroUnrealized');
  r.textContent = fmtUSDsigned(t.realized);
  r.className = 'pnl-cell-value ' + pnlClass(t.realized);
  u.textContent = fmtUSDsigned(t.unrealized);
  u.className = 'pnl-cell-value ' + pnlClass(t.unrealized);
  // sub
  const openLots = S.lots.filter(l => lotMetrics(l).status !== 'closed').length;
  const totalLots = S.lots.length;
  let sub = '';
  if (totalLots === 0){
    sub = 'ยังไม่มีรายการ — เริ่มบันทึกการซื้อขายของคุณ';
  } else {
    sub = `${openLots} ไม้ที่ถืออยู่ · จากทั้งหมด ${totalLots} ไม้ · ลงทุนไปแล้ว ${fmtUSD(t.totalInvested)}`;
  }
  document.getElementById('heroSub').textContent = sub;
  // realized sub
  const realizedSub = document.getElementById('heroRealizedSub');
  const totalSells = S.lots.reduce((a,l)=>a+l.sells.length, 0);
  realizedSub.textContent = totalSells === 0 ? 'ยังไม่มีการขาย' : `จาก ${totalSells} การขาย`;
  // unrealized sub
  const unrealizedSub = document.getElementById('heroUnrealizedSub');
  if (openLots === 0) unrealizedSub.textContent = 'ไม่มีไม้ที่ถืออยู่';
  else unrealizedSub.textContent = `${openLots} ไม้ · ${t.costRemaining > 0 ? fmtPct((t.unrealized/t.costRemaining)*100) : '0%'}`;
}

/* ============================================================
   RENDER: LOTS LIST
============================================================ */
function renderLots(){
  const wrap = document.getElementById('tabLots');
  if (!S.lots.length){
    wrap.innerHTML = `<div class="empty">
      <div class="empty-icon">📊</div>
      <div class="empty-text">ยังไม่มีไม้ในพอร์ต</div>
      <div class="empty-sub">กดปุ่ม "บันทึกการซื้อใหม่" ด้านบนเพื่อเริ่มต้น</div>
    </div>`;
    return;
  }
  const html = S.lots.map(lot => {
    const m = lotMetrics(lot);
    const sector = S.sectors[lot.ticker] || '';
    const badge = m.status === 'closed' ? '<span class="lot-badge closed">CLOSED</span>'
                : m.status === 'partial' ? '<span class="lot-badge partial">PARTIAL</span>'
                : '<span class="lot-badge open">OPEN</span>';
    const pnlVal = m.totalPnl;
    const pnlCls = pnlText(pnlVal);
    const pnlSym = pnlVal >= 0 ? '+' : '−';
    const sellsHtml = lot.sells.length === 0 ? '' : '<div class="sell-history">' + lot.sells.map(s => {
      const sellPnl = (s.exit_price - lot.entry_price) * s.shares_sold;
      const cls = sellPnl >= 0 ? 'pnl-pos' : 'pnl-neg';
      return `<div class="sell-row">
        <div class="sell-row-left">
          <span class="sell-row-tag">SOLD</span>
          <span>${s.exit_date} · ${fmtShares(s.shares_sold)} sh @ $${s.exit_price.toFixed(2)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="sell-row-pnl ${cls}">${fmtUSDsigned(sellPnl)}</span>
          <button class="sell-row-del" onclick="deleteSell('${s.id}')" title="ลบรายการขายนี้">✕</button>
        </div>
      </div>`;
    }).join('') + '</div>';
    const actions = m.status === 'closed'
      ? `<div class="lot-actions">
           <button class="lot-btn delete" onclick="confirmDeleteLot('${lot.id}','${lot.ticker}')">ลบไม้นี้</button>
         </div>`
      : `<div class="lot-actions">
           <button class="lot-btn sell" onclick="openSellModal('${lot.id}')">+ ขายบางส่วน / ทั้งหมด</button>
           <button class="lot-btn delete" onclick="confirmDeleteLot('${lot.id}','${lot.ticker}')">ลบ</button>
         </div>`;
    return `<div class="lot-card ${m.status === 'closed' ? 'closed' : ''}">
      <div class="lot-head">
        <div class="lot-head-left">
          <div class="lot-ticker-row">
            <span class="lot-ticker">${lot.ticker}</span>
            ${badge}
          </div>
          <div class="lot-meta">
            ${sector ? sector + ' · ' : ''}ซื้อ ${lot.entry_date} @ $${lot.entry_price.toFixed(2)}<br>
            ${fmtShares(lot.shares)} sh · ลงทุน ${fmtUSD(lot.amount_usd)}
          </div>
        </div>
        <div class="lot-pnl">
          <div class="lot-pnl-val ${pnlCls}">${fmtUSDsigned(pnlVal)}</div>
          <div class="lot-pnl-pct ${pnlCls}">${fmtPct(m.pctOriginal)}</div>
        </div>
      </div>
      <div class="lot-detail-row">
        <div>
          <div class="lot-detail-label">ถืออยู่</div>
          <div class="lot-detail-val">${fmtShares(m.remaining)} sh</div>
        </div>
        <div>
          <div class="lot-detail-label">ราคาตอนนี้</div>
          <div class="lot-detail-val">${m.latest !== null ? '$'+m.latest.toFixed(2) : '—'}</div>
        </div>
        <div>
          <div class="lot-detail-label">มูลค่าตอนนี้</div>
          <div class="lot-detail-val">${fmtUSD(m.marketValue)}</div>
        </div>
        <div>
          <div class="lot-detail-label">Unrealized</div>
          <div class="lot-detail-val ${pnlText(m.unrealizedPnl)}">${fmtUSDsigned(m.unrealizedPnl)}</div>
        </div>
      </div>
      ${sellsHtml}
      ${actions}
    </div>`;
  }).join('');
  wrap.innerHTML = `<div class="lots-list">${html}</div>`;
}

/* ============================================================
   RENDER: BY TICKER
============================================================ */
function renderByTicker(){
  const wrap = document.getElementById('tabTicker');
  if (!S.lots.length){
    wrap.innerHTML = `<div class="empty">
      <div class="empty-icon">📊</div>
      <div class="empty-text">ยังไม่มีหุ้นในพอร์ต</div>
    </div>`;
    return;
  }
  // Aggregate
  const agg = {};
  S.lots.forEach(lot => {
    const m = lotMetrics(lot);
    if (!agg[lot.ticker]) agg[lot.ticker] = {
      ticker: lot.ticker, lotsCount: 0, totalShares: 0, totalCost: 0,
      remainingShares: 0, costRemaining: 0,
      realized: 0, unrealized: 0, marketValue: 0,
    };
    const a = agg[lot.ticker];
    a.lotsCount += 1;
    a.totalShares += lot.shares;
    a.totalCost += lot.amount_usd;
    a.remainingShares += m.remaining;
    a.costRemaining += m.costRemaining;
    a.realized += m.realizedPnl;
    a.unrealized += m.unrealizedPnl;
    a.marketValue += m.marketValue;
  });
  const list = Object.values(agg).sort((a,b) => b.marketValue - a.marketValue || a.ticker.localeCompare(b.ticker));
  const html = list.map(a => {
    const avgCost = a.remainingShares > 0 ? a.costRemaining / a.remainingShares : 0;
    const lp = latestPrice(a.ticker);
    const latest = lp ? lp.close : null;
    const totalPnl = a.realized + a.unrealized;
    const pctRem = a.costRemaining > 0 ? (a.unrealized / a.costRemaining) * 100 : 0;
    const sector = S.sectors[a.ticker] || '';
    return `<div class="ticker-card" style="margin-bottom:10px">
      <div class="ticker-card-head">
        <div>
          <div class="ticker-card-name">${a.ticker}</div>
          <div class="lot-meta">${sector ? sector + ' · ' : ''}${a.lotsCount} ไม้ · ราคาตอนนี้ ${latest !== null ? '$'+latest.toFixed(2) : '—'}</div>
        </div>
        <div class="lot-pnl">
          <div class="lot-pnl-val ${pnlText(totalPnl)}">${fmtUSDsigned(totalPnl)}</div>
          <div class="lot-pnl-pct ${pnlText(pctRem)}">${fmtPct(pctRem)}</div>
        </div>
      </div>
      <div class="ticker-card-stats">
        <div><div class="lot-detail-label">ถืออยู่</div><div class="lot-detail-val">${fmtShares(a.remainingShares)} sh</div></div>
        <div><div class="lot-detail-label">ต้นทุนเฉลี่ย</div><div class="lot-detail-val">${a.remainingShares > 0 ? '$'+avgCost.toFixed(2) : '—'}</div></div>
        <div><div class="lot-detail-label">มูลค่าตอนนี้</div><div class="lot-detail-val">${fmtUSD(a.marketValue)}</div></div>
        <div><div class="lot-detail-label">Realized</div><div class="lot-detail-val ${pnlText(a.realized)}">${fmtUSDsigned(a.realized)}</div></div>
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML = html;
}

/* ============================================================
   EQUITY CURVE
   For each trading day d in window:
     equity[d] = Σ(remaining_shares_at_d_per_lot × close[d]) + cumulative_cash_received_by_d
     cost[d]   = Σ(amount_usd of lots opened by d) − Σ(amount_usd_basis_of_shares_sold_by_d)
   Where "amount_usd_basis_of_shares_sold_by_d" = entry_price × shares_sold (what cost left when shares sold)
   So Σcost shows current invested capital (decreases as you sell out)
============================================================ */
function buildEquitySeries(tf){
  if (!S.lots.length) return null;
  // Determine window
  const earliest = earliestEntryDate();
  if (!earliest) return null;
  let startDate;
  const end = S.latestDate;
  if (tf === 'ALL') startDate = earliest;
  else {
    const monthsBack = tf === '1M' ? 1 : tf === '3M' ? 3 : tf === '6M' ? 6 : null;
    if (tf === 'YTD'){
      const [yy] = end.split('-');
      startDate = `${yy}-01-01`;
    } else if (monthsBack !== null){
      const d = new Date(end + 'T00:00:00');
      d.setMonth(d.getMonth() - monthsBack);
      startDate = d.toISOString().slice(0,10);
    } else {
      startDate = earliest;
    }
    if (startDate < earliest) startDate = earliest;
  }
  // Filter dates in window
  const dates = S.allDates.filter(d => d >= startDate && d <= end);
  if (!dates.length) return null;

  // Pre-build per-lot arrays
  const lots = S.lots.map(l => ({
    ticker: l.ticker,
    entry_date: l.entry_date,
    entry_price: l.entry_price,
    shares: l.shares,
    amount_usd: l.amount_usd,
    sells: l.sells.slice().sort((a,b) => a.exit_date < b.exit_date ? -1 : 1),
  }));

  // Build series
  const equity = new Array(dates.length);
  const cost   = new Array(dates.length);
  for (let i=0; i<dates.length; i++){
    const d = dates[i];
    let equityVal = 0;
    let costVal = 0;
    let cashFromSells = 0;
    for (const lot of lots){
      if (lot.entry_date > d) continue;  // not bought yet
      // remaining shares as of d (after sells with exit_date <= d)
      let sold = 0;
      let realizedCash = 0;
      for (const s of lot.sells){
        if (s.exit_date > d) break;
        sold += s.shares_sold;
        realizedCash += s.exit_price * s.shares_sold;
      }
      const remaining = lot.shares - sold;
      // close price on or before d
      const p = priceOnOrBefore(lot.ticker, d);
      const close = p ? p.close : lot.entry_price;
      equityVal += remaining * close;
      cashFromSells += realizedCash;
      // cost basis still in market (what's not yet sold * entry_price) + already-realized PROCEEDS == amount_usd basically
      // For "เงินลงทุนสะสม" we want: cumulative cash put in (sum of amount_usd) − (proceeds of fully-realized portion)
      // Simpler interpretation: cost = sum of amount_usd of all lots opened by d (does not decrease on sell — it's "เงินที่เคยลง")
      costVal += lot.amount_usd;
    }
    equity[i] = equityVal + cashFromSells;
    cost[i]   = costVal;
  }
  return { dates, equity, cost };
}

/* ============================================================
   CHART (canvas, no lib)
============================================================ */
function drawEquityChart(){
  const canvas = document.getElementById('eqCanvas');
  const empty  = document.getElementById('eqEmpty');
  const wrap   = canvas.parentElement;
  const series = buildEquitySeries(S.currentTf);
  if (!series || series.dates.length < 2){
    canvas.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  canvas.style.display = 'block';
  empty.style.display = 'none';

  const dpr = window.devicePixelRatio || 1;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0,0,W,H);

  const padL = 50, padR = 14, padT = 14, padB = 24;
  const cw = W - padL - padR, ch = H - padT - padB;

  // y range
  const allVals = series.equity.concat(series.cost).filter(v => v > 0);
  if (!allVals.length){
    ctx.fillStyle = '#7A6F62';
    ctx.font = '12px Anuphan';
    ctx.textAlign = 'center';
    ctx.fillText('ยังไม่มีข้อมูลในช่วงนี้', W/2, H/2);
    return;
  }
  let yMin = Math.min(...allVals);
  let yMax = Math.max(...allVals);
  const pad = (yMax - yMin) * 0.08 || 1;
  yMin = Math.max(0, yMin - pad);
  yMax = yMax + pad;

  const xAt = (i) => padL + (i / (series.dates.length-1)) * cw;
  const yAt = (v) => padT + ch - ((v - yMin) / (yMax - yMin)) * ch;

  // grid + y-axis labels (4 lines)
  ctx.strokeStyle = 'rgba(212,175,55,0.15)';
  ctx.lineWidth = 1;
  ctx.font = '10px DM Serif Display';
  ctx.fillStyle = '#7A6F62';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i=0; i<=4; i++){
    const v = yMin + (yMax - yMin) * (i/4);
    const y = yAt(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W-padR, y); ctx.stroke();
    ctx.fillText('$' + Math.round(v).toLocaleString(), padL - 6, y);
  }

  // x-axis labels (start, end)
  ctx.font = '10px Anuphan';
  ctx.fillStyle = '#7A6F62';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(series.dates[0], padL, H - padB + 6);
  ctx.textAlign = 'right';
  ctx.fillText(series.dates[series.dates.length-1], W - padR, H - padB + 6);
  // mid label
  if (series.dates.length > 4){
    const mid = Math.floor(series.dates.length / 2);
    ctx.textAlign = 'center';
    ctx.fillText(series.dates[mid], padL + cw/2, H - padB + 6);
  }

  // Cost line (gold dashed)
  ctx.strokeStyle = '#B8860B';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5,4]);
  ctx.beginPath();
  for (let i=0; i<series.dates.length; i++){
    const x = xAt(i), y = yAt(series.cost[i]);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Equity line (maroon, thicker, with area fill)
  // Area
  ctx.beginPath();
  for (let i=0; i<series.dates.length; i++){
    const x = xAt(i), y = yAt(series.equity[i]);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineTo(xAt(series.dates.length-1), padT + ch);
  ctx.lineTo(xAt(0), padT + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
  grad.addColorStop(0, 'rgba(114,47,55,0.18)');
  grad.addColorStop(1, 'rgba(114,47,55,0.02)');
  ctx.fillStyle = grad;
  ctx.fill();
  // Line
  ctx.strokeStyle = '#722F37';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i=0; i<series.dates.length; i++){
    const x = xAt(i), y = yAt(series.equity[i]);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}

/* ============================================================
   TABS
============================================================ */
function switchTab(tab){
  S.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('tabLots').style.display   = tab === 'lots' ? 'block' : 'none';
  document.getElementById('tabTicker').style.display = tab === 'ticker' ? 'block' : 'none';
}
window.switchTab = switchTab;

/* ============================================================
   ADD MODAL
============================================================ */
let _addAcHL = -1;
function openAddModal(){
  document.getElementById('addTicker').value = '';
  document.getElementById('addDate').value = todayISO();
  document.getElementById('addAmount').value = '';
  document.getElementById('addPreview').style.display = 'none';
  document.getElementById('addPreviewWarn').style.display = 'none';
  document.getElementById('addConfirmBtn').disabled = true;
  document.getElementById('addAcList').classList.remove('show');
  _addAcHL = -1;
  document.getElementById('addModal').classList.add('active');
  setTimeout(()=> document.getElementById('addTicker').focus(), 100);
}
function closeAddModal(){
  document.getElementById('addModal').classList.remove('active');
}
window.openAddModal = openAddModal;
window.closeAddModal = closeAddModal;

function onTickerInput(){
  const inp = document.getElementById('addTicker');
  const list = document.getElementById('addAcList');
  const q = inp.value.trim().toUpperCase();
  if (q.length < 1){ list.classList.remove('show'); list.innerHTML=''; recalcAddPreview(); return; }
  const matches = S.tickers.filter(t => t.startsWith(q)).slice(0, 8);
  if (!matches.length){
    // Try contains
    const c = S.tickers.filter(t => t.includes(q)).slice(0, 8);
    if (!c.length){ list.classList.remove('show'); list.innerHTML=''; recalcAddPreview(); return; }
    list.innerHTML = c.map((t,i) => `<div class="ac-item ${i===0?'hl':''}" onclick="pickTicker('${t}')"><span class="ac-tk">${t}</span><span class="ac-sec">${S.sectors[t] || ''}</span></div>`).join('');
    _addAcHL = 0;
  } else {
    list.innerHTML = matches.map((t,i) => `<div class="ac-item ${i===0?'hl':''}" onclick="pickTicker('${t}')"><span class="ac-tk">${t}</span><span class="ac-sec">${S.sectors[t] || ''}</span></div>`).join('');
    _addAcHL = 0;
  }
  list.classList.add('show');
  recalcAddPreview();
}
window.onTickerInput = onTickerInput;

function pickTicker(t){
  document.getElementById('addTicker').value = t;
  document.getElementById('addAcList').classList.remove('show');
  recalcAddPreview();
}
window.pickTicker = pickTicker;

function onTickerKeydown(e){
  const list = document.getElementById('addAcList');
  if (!list.classList.contains('show')) return;
  const items = list.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown'){
    e.preventDefault();
    _addAcHL = Math.min(items.length-1, _addAcHL+1);
    items.forEach((it,i)=>it.classList.toggle('hl', i===_addAcHL));
  } else if (e.key === 'ArrowUp'){
    e.preventDefault();
    _addAcHL = Math.max(0, _addAcHL-1);
    items.forEach((it,i)=>it.classList.toggle('hl', i===_addAcHL));
  } else if (e.key === 'Enter'){
    e.preventDefault();
    if (_addAcHL >= 0 && items[_addAcHL]){
      const tk = items[_addAcHL].querySelector('.ac-tk').textContent;
      pickTicker(tk);
    }
  } else if (e.key === 'Escape'){
    list.classList.remove('show');
  }
}
window.onTickerKeydown = onTickerKeydown;

function recalcAddPreview(){
  const tk = document.getElementById('addTicker').value.trim().toUpperCase();
  const date = document.getElementById('addDate').value;
  const amt = parseFloat(document.getElementById('addAmount').value);
  const prev = document.getElementById('addPreview');
  const warn = document.getElementById('addPreviewWarn');
  const btn = document.getElementById('addConfirmBtn');
  const hint = document.getElementById('addTickerHint');
  warn.style.display = 'none'; warn.textContent = '';
  btn.disabled = true;
  if (!tk){ prev.style.display='none'; hint.textContent='พิมพ์อย่างน้อย 1 ตัวอักษร'; hint.className='field-hint'; return; }
  if (!S.prices[tk]){ prev.style.display='none'; hint.textContent='ไม่พบ ticker นี้ในข้อมูล S&P 500'; hint.className='field-hint err'; return; }
  hint.textContent = S.sectors[tk] ? `${tk} · ${S.sectors[tk]}` : tk;
  hint.className = 'field-hint';
  if (!date){ prev.style.display='none'; return; }
  // Date must be on/after first available + on/before latest
  const series = S.prices[tk];
  if (date < series.dates[0]){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `ไม่มีข้อมูลก่อนวันที่ ${series.dates[0]}`;
    return;
  }
  if (date > S.latestDate){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `วันที่ต้องไม่หลังจากวันที่ข้อมูลล่าสุด (${S.latestDate})`;
    return;
  }
  const p = priceOnOrBefore(tk, date);
  if (!p){ prev.style.display='none'; warn.style.display='block'; warn.textContent='ไม่พบราคาที่ใช้ได้สำหรับวันที่นี้'; return; }
  if (!isFinite(amt) || amt <= 0){ prev.style.display='none'; return; }
  const shares = amt / p.close;
  document.getElementById('prevDate').textContent = p.date + (p.date !== date ? '  (วันก่อนหน้า)' : '');
  document.getElementById('prevPrice').textContent = '$' + p.close.toFixed(2);
  document.getElementById('prevShares').textContent = fmtShares(shares) + ' sh';
  prev.style.display = 'block';
  btn.disabled = false;
}
window.recalcAddPreview = recalcAddPreview;

async function submitAdd(){
  if (!sb || !S.user){ toast('ไม่ได้เข้าสู่ระบบ', 'err'); return; }
  const tk = document.getElementById('addTicker').value.trim().toUpperCase();
  const date = document.getElementById('addDate').value;
  const amt = parseFloat(document.getElementById('addAmount').value);
  const p = priceOnOrBefore(tk, date);
  if (!p){ toast('ไม่พบราคา', 'err'); return; }
  const shares = amt / p.close;
  const btn = document.getElementById('addConfirmBtn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
  const { error } = await sb.from('portfolio_lots').insert({
    user_id: S.user.id,
    ticker: tk,
    entry_date: p.date,   // store actual trading day used
    amount_usd: amt,
    entry_price: p.close,
    shares: shares,
  });
  btn.textContent = 'บันทึก'; btn.disabled = false;
  if (error){ toast('บันทึกล้มเหลว: '+error.message, 'err'); return; }
  toast('บันทึกแล้ว · ' + tk + ' ' + fmtShares(shares) + ' sh', 'ok');
  closeAddModal();
  await fetchLots();
  renderAll();
}
window.submitAdd = submitAdd;

/* ============================================================
   SELL MODAL
============================================================ */
let _sellLot = null;
function openSellModal(lotId){
  const lot = S.lots.find(l => l.id === lotId);
  if (!lot){ toast('ไม่พบไม้นี้', 'err'); return; }
  _sellLot = lot;
  const m = lotMetrics(lot);
  document.getElementById('sellLotInfo').innerHTML = `
    <div style="font-family:var(--font-number);font-size:1.1rem;color:var(--maroon)">${lot.ticker}</div>
    <div style="font-size:.78rem;color:var(--text-muted);margin-top:3px">
      ซื้อ ${lot.entry_date} @ $${lot.entry_price.toFixed(2)} · ถืออยู่ <strong style="color:var(--text-heading)">${fmtShares(m.remaining)}</strong> sh
    </div>`;
  document.getElementById('sellMaxShares').textContent = fmtShares(m.remaining);
  document.getElementById('sellDate').value = todayISO();
  document.getElementById('sellShares').value = '';
  document.getElementById('sellShares').max = m.remaining;
  document.getElementById('sellPreview').style.display = 'none';
  document.getElementById('sellPreviewWarn').style.display = 'none';
  document.getElementById('sellConfirmBtn').disabled = true;
  document.getElementById('sellModal').classList.add('active');
  setTimeout(()=> document.getElementById('sellShares').focus(), 100);
}
function closeSellModal(){ document.getElementById('sellModal').classList.remove('active'); _sellLot = null; }
window.openSellModal = openSellModal;
window.closeSellModal = closeSellModal;

function recalcSellPreview(){
  if (!_sellLot) return;
  const date = document.getElementById('sellDate').value;
  const sh = parseFloat(document.getElementById('sellShares').value);
  const prev = document.getElementById('sellPreview');
  const warn = document.getElementById('sellPreviewWarn');
  const btn = document.getElementById('sellConfirmBtn');
  warn.style.display = 'none'; warn.textContent='';
  btn.disabled = true;
  const m = lotMetrics(_sellLot);
  if (!date) { prev.style.display='none'; return; }
  if (date < _sellLot.entry_date){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `วันที่ขายต้องไม่ก่อนวันที่ซื้อ (${_sellLot.entry_date})`;
    return;
  }
  if (date > S.latestDate){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `วันที่ต้องไม่หลังจากวันที่ข้อมูลล่าสุด (${S.latestDate})`;
    return;
  }
  if (!isFinite(sh) || sh <= 0){ prev.style.display='none'; return; }
  if (sh > m.remaining + 1e-8){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `จำนวนเกินที่ถืออยู่ (สูงสุด ${fmtShares(m.remaining)})`;
    return;
  }
  const p = priceOnOrBefore(_sellLot.ticker, date);
  if (!p){ prev.style.display='none'; warn.style.display='block'; warn.textContent='ไม่พบราคา'; return; }
  const proceeds = p.close * sh;
  const pnl = (p.close - _sellLot.entry_price) * sh;
  document.getElementById('sellPrevDate').textContent = p.date + (p.date !== date ? '  (วันก่อนหน้า)' : '');
  document.getElementById('sellPrevPrice').textContent = '$' + p.close.toFixed(2);
  document.getElementById('sellPrevProceeds').textContent = fmtUSD(proceeds);
  const pnlEl = document.getElementById('sellPrevPnl');
  pnlEl.textContent = fmtUSDsigned(pnl);
  pnlEl.style.color = pnl >= 0 ? '#226F44' : '#922B21';
  prev.style.display = 'block';
  btn.disabled = false;
}
window.recalcSellPreview = recalcSellPreview;

async function submitSell(){
  if (!_sellLot || !sb || !S.user) return;
  const date = document.getElementById('sellDate').value;
  const sh = parseFloat(document.getElementById('sellShares').value);
  const p = priceOnOrBefore(_sellLot.ticker, date);
  if (!p){ toast('ไม่พบราคา', 'err'); return; }
  const btn = document.getElementById('sellConfirmBtn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
  const { error } = await sb.from('portfolio_sells').insert({
    user_id: S.user.id,
    lot_id: _sellLot.id,
    exit_date: p.date,
    exit_price: p.close,
    shares_sold: sh,
  });
  btn.textContent = 'บันทึก'; btn.disabled = false;
  if (error){ toast('บันทึกล้มเหลว: '+error.message, 'err'); return; }
  const realized = (p.close - _sellLot.entry_price) * sh;
  toast(`ขายแล้ว · Realized ${fmtUSDsigned(realized)}`, realized >= 0 ? 'ok' : 'err');
  closeSellModal();
  await fetchLots();
  renderAll();
}
window.submitSell = submitSell;

/* ============================================================
   DELETE
============================================================ */
async function deleteSell(sellId){
  if (!confirm('ลบรายการขายนี้?')) return;
  const { error } = await sb.from('portfolio_sells').delete().eq('id', sellId);
  if (error){ toast('ลบล้มเหลว: '+error.message, 'err'); return; }
  toast('ลบแล้ว');
  await fetchLots();
  renderAll();
}
window.deleteSell = deleteSell;

async function confirmDeleteLot(lotId, ticker){
  if (!confirm(`ลบไม้ ${ticker} นี้? · การขายทั้งหมดของไม้นี้จะถูกลบด้วย`)) return;
  const { error } = await sb.from('portfolio_lots').delete().eq('id', lotId);
  if (error){ toast('ลบล้มเหลว: '+error.message, 'err'); return; }
  toast('ลบแล้ว');
  await fetchLots();
  renderAll();
}
window.confirmDeleteLot = confirmDeleteLot;

/* ============================================================
   RENDER ALL + TF BAR
============================================================ */
function renderAll(){
  renderHero();
  renderLots();
  renderByTicker();
  drawEquityChart();
}

function bindTfBar(){
  document.querySelectorAll('.eq-tf-btn').forEach(b => {
    b.addEventListener('click', () => {
      S.currentTf = b.dataset.tf;
      document.querySelectorAll('.eq-tf-btn').forEach(x => x.classList.toggle('active', x === b));
      drawEquityChart();
    });
  });
}

window.addEventListener('resize', () => {
  if (document.getElementById('appView').style.display !== 'none') drawEquityChart();
});

/* ============================================================
   INIT
============================================================ */
async function init(){
  setProgress(5);
  // 1. auth check
  S.user = await fetchUser();
  setProgress(15);
  if (!S.user){ showGate(); return; }
  // 2. price CSV (the heavy one)
  try {
    await loadPriceCSV();
    setProgress(70);
  } catch(e){
    console.error(e);
    document.querySelector('.owl-loader-text').innerHTML = '<span style="color:#922B21">โหลดข้อมูลราคาล้มเหลว</span>';
    return;
  }
  // 3. sector CSV (non-fatal)
  await loadSectorCSV();
  setProgress(85);
  // 4. user portfolio
  await fetchLots();
  setProgress(100);
  // 5. show
  setTimeout(() => {
    showApp();
    bindTfBar();
    renderAll();
  }, 250);
}

document.addEventListener('DOMContentLoaded', init);
})();
