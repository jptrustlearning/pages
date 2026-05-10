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

/* === Phase 1: Multi-portfolio constants === */
const PORTFOLIO_COLORS = ['#722F37','#B8860B','#2E9F5F','#8B2252','#5A3D20'];
const PORTFOLIO_MAX    = 5;
const VIRTUAL_ALL      = '__all__';

/* === Phase 2: Categories — different palette so chips visually distinct from portfolio dots === */
const CATEGORY_COLORS  = ['#2E9F5F','#B8860B','#8B2252','#5A3D20','#722F37','#1F7D49','#C0392B','#3D3228'];

let sb = null;
try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON); }
catch(e) { console.error('Supabase init failed', e); }

/* Global state */
const S = {
  user: null,
  // Phase 1: multi-portfolio
  portfolios: [],            // [{id, name, color, sort_order}]
  selectedPortfolioId: VIRTUAL_ALL,
  allLots: [],               // raw fetched lots (full set for this user)
  lots: [],                  // filtered view by selectedPortfolioId — all render code reads this
  // Phase 2: categories (flat list, all portfolios — filter by portfolio_id when needed)
  categories: [],            // [{id, portfolio_id, name, color, sort_order}]
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
window.toast = toast;

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
    const hi = parseFloat(row.High);
    const lo = parseFloat(row.Low);
    if (!tk || !d || !isFinite(cl) || cl <= 0) return;
    // Fall back to close if H/L missing (defensive — shouldn't happen with clean data)
    const high = (isFinite(hi) && hi > 0) ? hi : cl;
    const low  = (isFinite(lo) && lo > 0) ? lo : cl;
    if (!tmp[tk]) tmp[tk] = [];
    tmp[tk].push({ d, c: cl, h: high, l: low });
    dateSet.add(d);
  });
  const out = {};
  for (const tk of Object.keys(tmp)){
    tmp[tk].sort((a,b) => a.d < b.d ? -1 : 1);
    out[tk] = {
      dates:  tmp[tk].map(x => x.d),
      closes: tmp[tk].map(x => x.c),
      highs:  tmp[tk].map(x => x.h),
      lows:   tmp[tk].map(x => x.l),
    };
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
  return { date: dates[ans], close: closes[ans], idx: ans };
}

/* Return min/max allowed price = lowest L and highest H across T-1, T0, T+1 trading days
   (auto-trims when T-1 or T+1 is out of bounds at the ends of the dataset) */
function priceRange(ticker, idx){
  const series = S.prices[ticker];
  if (!series) return null;
  const { highs, lows, dates } = series;
  const start = Math.max(0, idx - 1);
  const end   = Math.min(highs.length - 1, idx + 1);
  let minLow = Infinity, maxHigh = -Infinity;
  const daysUsed = [];
  for (let i = start; i <= end; i++){
    if (lows[i]  < minLow)  minLow  = lows[i];
    if (highs[i] > maxHigh) maxHigh = highs[i];
    daysUsed.push(dates[i]);
  }
  return { min: minLow, max: maxHigh, days: daysUsed };
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
  S.allLots = (lots || []).map(l => {
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
  applyPortfolioFilter();
}

/* ============================================================
   PHASE 1: PORTFOLIO MANAGEMENT
============================================================ */
function lsKeyForUser(){
  return 'jpt_my_portfolio_selected_' + (S.user ? S.user.id : 'anon');
}

function pickColorByOrder(idx){
  return PORTFOLIO_COLORS[idx % PORTFOLIO_COLORS.length];
}

function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function fetchPortfolios(){
  if (!sb || !S.user){ S.portfolios = []; return; }
  const { data, error } = await sb.from('portfolios')
    .select('*').eq('user_id', S.user.id).order('sort_order', {ascending: true});
  if (error){
    console.error(error);
    toast('โหลดพอร์ตล้มเหลว: '+error.message, 'err');
    S.portfolios = [];
    return;
  }
  S.portfolios = data || [];
}

/* Auto-create "พอร์ตหลัก" for users with no portfolios (new user case).
   Migration handled existing-user case at SQL level — this handles fresh signups. */
async function ensureDefaultPortfolio(){
  if (S.portfolios.length > 0) return;
  if (!sb || !S.user) return;
  const { data, error } = await sb.from('portfolios')
    .insert({ user_id: S.user.id, name: 'พอร์ตหลัก', color: pickColorByOrder(0), sort_order: 0 })
    .select().single();
  if (error){ console.error('ensureDefaultPortfolio failed', error); return; }
  S.portfolios = [data];
}

function applyPortfolioFilter(){
  if (S.selectedPortfolioId === VIRTUAL_ALL){
    S.lots = S.allLots.slice();
  } else {
    S.lots = S.allLots.filter(l => l.portfolio_id === S.selectedPortfolioId);
  }
}

function getCurrentPortfolio(){
  if (S.selectedPortfolioId === VIRTUAL_ALL) return null;
  return S.portfolios.find(p => p.id === S.selectedPortfolioId) || null;
}

function setSelectedPortfolio(id){
  // validate
  if (id !== VIRTUAL_ALL && !S.portfolios.find(p => p.id === id)){
    id = VIRTUAL_ALL;
  }
  S.selectedPortfolioId = id;
  try { localStorage.setItem(lsKeyForUser(), id); } catch(e){}
  applyPortfolioFilter();
  closePortTabMenu();
  closeLotCatPopup();
  renderPortTabs();
  updateCategoryTabVisibility();
  renderAll();
}
window.setSelectedPortfolio = setSelectedPortfolio;

function updatePortSwitcherChip(){
  // Phase 1.5: replaced by renderPortTabs — kept as no-op for safety in case any
  // legacy call site still references it. Real rendering happens in renderPortTabs.
  renderPortTabs();
}

/* === PORTFOLIO TAB BAR (Phase 1.5) === */
function renderPortTabs(){
  const wrap = document.getElementById('portTabs');
  if (!wrap) return;
  const items = [];
  // ทั้งหมด tab (virtual)
  const allActive = S.selectedPortfolioId === VIRTUAL_ALL;
  items.push(`<button class="port-tab ${allActive ? 'active' : ''}" onclick="setSelectedPortfolio('${VIRTUAL_ALL}')">
    <span class="port-tab-dot all"></span>
    <span class="port-tab-name">ทั้งหมด</span>
  </button>`);
  // Each portfolio
  S.portfolios.forEach(p => {
    const active = p.id === S.selectedPortfolioId;
    const menuHtml = active ? `
      <button class="port-tab-menu" onclick="event.stopPropagation(); togglePortTabMenu('${p.id}', this)" title="จัดการพอร์ต">⋮</button>
      <div class="port-tab-menu-popup" id="portMenuPopup-${p.id}">
        <button class="port-tab-menu-action" onclick="event.stopPropagation(); closePortTabMenu(); openRenamePortModal('${p.id}')">เปลี่ยนชื่อ</button>
        <button class="port-tab-menu-action danger" onclick="event.stopPropagation(); closePortTabMenu(); confirmDeletePortfolio('${p.id}')">ลบพอร์ต</button>
      </div>` : '';
    items.push(`<button class="port-tab ${active ? 'active' : ''}" onclick="setSelectedPortfolio('${p.id}')">
      <span class="port-tab-dot" style="background:${p.color || '#722F37'}"></span>
      <span class="port-tab-name">${escapeHtml(p.name)}</span>
      ${menuHtml}
    </button>`);
  });
  // + tab (create new)
  const atCap = S.portfolios.length >= PORTFOLIO_MAX;
  if (atCap){
    items.push(`<button class="port-tab-add disabled" onclick="toast('มีพอร์ตครบ ${PORTFOLIO_MAX} แล้ว','err')" title="มีพอร์ตครบ ${PORTFOLIO_MAX}">+</button>`);
  } else {
    items.push(`<button class="port-tab-add" onclick="openCreatePortModal()" title="สร้างพอร์ตใหม่">+</button>`);
  }
  wrap.innerHTML = items.join('');
  // Auto-scroll active tab into view (after DOM settles)
  setTimeout(() => {
    const activeEl = wrap.querySelector('.port-tab.active');
    if (activeEl) activeEl.scrollIntoView({behavior:'smooth', block:'nearest', inline:'nearest'});
  }, 50);
}
window.renderPortTabs = renderPortTabs;

function togglePortTabMenu(pid, btnEl){
  const popup = document.getElementById('portMenuPopup-' + pid);
  if (!popup) return;
  // close other open ones
  document.querySelectorAll('.port-tab-menu-popup.active').forEach(x => { if (x !== popup) x.classList.remove('active'); });
  if (popup.classList.contains('active')){
    popup.classList.remove('active');
    return;
  }
  // Show first so we can measure offsetWidth, then position via fixed coords
  popup.classList.add('active');
  if (btnEl){
    const rect = btnEl.getBoundingClientRect();
    const popupW = popup.offsetWidth || 150;
    let left = rect.right - popupW;  // right-align under the ⋮ button
    // clamp to viewport with 8px gutter
    left = Math.max(8, Math.min(window.innerWidth - popupW - 8, left));
    popup.style.top  = (rect.bottom + 6) + 'px';
    popup.style.left = left + 'px';
  }
}
window.togglePortTabMenu = togglePortTabMenu;

function closePortTabMenu(){
  document.querySelectorAll('.port-tab-menu-popup.active').forEach(x => x.classList.remove('active'));
}
window.closePortTabMenu = closePortTabMenu;

// Outside-click closes any open tab menu
document.addEventListener('click', (e) => {
  if (!e.target.closest('.port-tab-menu') && !e.target.closest('.port-tab-menu-popup')) {
    closePortTabMenu();
  }
});

// Close menu on viewport changes (since popup position is fixed and won't follow scroll)
window.addEventListener('resize', closePortTabMenu);
window.addEventListener('scroll', closePortTabMenu, {passive:true});

/* === CREATE / RENAME MODAL === */
let _portEditMode = 'create';
let _portEditId = null;

function openCreatePortModal(){
  if (S.portfolios.length >= PORTFOLIO_MAX){
    toast('มีพอร์ตครบ ' + PORTFOLIO_MAX + ' แล้ว', 'err');
    return;
  }
  _portEditMode = 'create';
  _portEditId = null;
  document.getElementById('portEditTitle').textContent = 'พอร์ตใหม่';
  document.getElementById('portEditName').value = '';
  document.getElementById('portEditConfirm').textContent = 'สร้าง';
  document.getElementById('portEditConfirm').disabled = false;
  document.getElementById('portEditModal').classList.add('active');
  setTimeout(() => { const n = document.getElementById('portEditName'); if (n) n.focus(); }, 60);
}
window.openCreatePortModal = openCreatePortModal;

function openRenamePortModal(pid){
  const p = S.portfolios.find(x => x.id === pid);
  if (!p) return;
  _portEditMode = 'rename';
  _portEditId = pid;
  document.getElementById('portEditTitle').textContent = 'เปลี่ยนชื่อพอร์ต';
  document.getElementById('portEditName').value = p.name;
  document.getElementById('portEditConfirm').textContent = 'บันทึก';
  document.getElementById('portEditConfirm').disabled = false;
  document.getElementById('portEditModal').classList.add('active');
  setTimeout(() => { const n = document.getElementById('portEditName'); if (n){ n.focus(); n.select(); } }, 60);
}
window.openRenamePortModal = openRenamePortModal;

function closePortEditModal(){
  document.getElementById('portEditModal').classList.remove('active');
}
window.closePortEditModal = closePortEditModal;

async function submitPortEdit(){
  const name = document.getElementById('portEditName').value.trim();
  if (!name){ toast('กรุณาใส่ชื่อพอร์ต', 'err'); return; }
  if (name.length > 40){ toast('ชื่อพอร์ตยาวเกินไป', 'err'); return; }
  const btn = document.getElementById('portEditConfirm');
  btn.disabled = true;
  if (_portEditMode === 'create'){
    if (S.portfolios.length >= PORTFOLIO_MAX){
      toast('มีพอร์ตครบ ' + PORTFOLIO_MAX + ' แล้ว', 'err');
      btn.disabled = false;
      return;
    }
    const sortOrder = S.portfolios.length;
    const color = pickColorByOrder(sortOrder);
    const { data, error } = await sb.from('portfolios')
      .insert({ user_id: S.user.id, name, color, sort_order: sortOrder })
      .select().single();
    btn.disabled = false;
    if (error){ toast('สร้างพอร์ตล้มเหลว: '+error.message, 'err'); return; }
    S.portfolios.push(data);
    closePortEditModal();
    toast('สร้างพอร์ต "' + name + '" แล้ว', 'ok');
    setSelectedPortfolio(data.id);  // auto-switch to new portfolio (also re-renders tabs)
  } else {
    // rename
    const { error } = await sb.from('portfolios').update({ name }).eq('id', _portEditId);
    btn.disabled = false;
    if (error){ toast('เปลี่ยนชื่อล้มเหลว: '+error.message, 'err'); return; }
    const p = S.portfolios.find(x => x.id === _portEditId);
    if (p) p.name = name;
    closePortEditModal();
    toast('เปลี่ยนชื่อแล้ว', 'ok');
    renderPortTabs();
  }
}
window.submitPortEdit = submitPortEdit;

function confirmDeletePortfolio(pid){
  const p = S.portfolios.find(x => x.id === pid);
  if (!p) return;
  if (S.portfolios.length <= 1){
    toast('ลบไม่ได้ — ต้องมีพอร์ตอย่างน้อย 1', 'err');
    return;
  }
  const lotCount = S.allLots.filter(l => l.portfolio_id === pid).length;
  const text = lotCount === 0
    ? `พอร์ต "${escapeHtml(p.name)}" ไม่มีไม้ — ลบได้ทันที`
    : `พอร์ต "${escapeHtml(p.name)}" มี <strong>${lotCount} ไม้</strong> — ไม้ทั้งหมดและประวัติการขายจะถูกลบด้วย<br><strong>การกระทำนี้ย้อนกลับไม่ได้</strong>`;
  showConfirm({
    title: 'ลบพอร์ตนี้?',
    text,
    okLabel: 'ลบพอร์ต',
    onOk: async () => {
      const { error } = await sb.from('portfolios').delete().eq('id', pid);
      if (error){ toast('ลบล้มเหลว: '+error.message, 'err'); return; }
      S.portfolios = S.portfolios.filter(x => x.id !== pid);
      // if it was selected → switch to ทั้งหมด
      if (S.selectedPortfolioId === pid){
        S.selectedPortfolioId = VIRTUAL_ALL;
        try { localStorage.setItem(lsKeyForUser(), VIRTUAL_ALL); } catch(e){}
      }
      toast('ลบพอร์ตแล้ว', 'ok');
      // refresh lots (CASCADE removes lots+sells server-side; refetch to reflect locally)
      await fetchLots();
      renderPortTabs();
      renderAll();
    }
  });
}
window.confirmDeletePortfolio = confirmDeletePortfolio;

/* ============================================================
   PHASE 2: CATEGORY MANAGEMENT
============================================================ */

async function fetchCategories(){
  if (!sb || !S.user){ S.categories = []; return; }
  const { data, error } = await sb.from('portfolio_categories')
    .select('*').eq('user_id', S.user.id).order('sort_order', {ascending: true});
  if (error){
    console.error('fetchCategories failed', error);
    toast('โหลดกลุ่มล้มเหลว: '+error.message, 'err');
    S.categories = [];
    return;
  }
  S.categories = data || [];
}

function pickCategoryColorByOrder(idx){
  return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
}

function getCategoriesForPortfolio(pid){
  return S.categories.filter(c => c.portfolio_id === pid);
}

function getCategoryById(catId){
  return S.categories.find(c => c.id === catId) || null;
}

function getLotCategory(lot){
  return lot.category_id ? getCategoryById(lot.category_id) : null;
}

async function createCategory(name){
  if (!sb || !S.user) return null;
  const cur = getCurrentPortfolio();
  if (!cur){ toast('เลือกพอร์ตเฉพาะก่อน (ไม่ใช่ทั้งหมด)', 'err'); return null; }
  const portCats = getCategoriesForPortfolio(cur.id);
  const sortOrder = portCats.length;
  const color = pickCategoryColorByOrder(sortOrder);
  const { data, error } = await sb.from('portfolio_categories')
    .insert({
      user_id: S.user.id,
      portfolio_id: cur.id,
      name, color,
      sort_order: sortOrder,
    })
    .select().single();
  if (error){ toast('สร้างกลุ่มล้มเหลว: '+error.message, 'err'); return null; }
  S.categories.push(data);
  return data;
}

async function updateCategoryName(catId, name){
  const { error } = await sb.from('portfolio_categories')
    .update({ name }).eq('id', catId);
  if (error){ toast('เปลี่ยนชื่อล้มเหลว: '+error.message, 'err'); return false; }
  const c = S.categories.find(x => x.id === catId);
  if (c) c.name = name;
  return true;
}

async function deleteCategory(catId){
  // ON DELETE SET NULL on lots → lots stay but become uncategorized
  const { error } = await sb.from('portfolio_categories')
    .delete().eq('id', catId);
  if (error){ toast('ลบกลุ่มล้มเหลว: '+error.message, 'err'); return false; }
  S.categories = S.categories.filter(c => c.id !== catId);
  // Update local lots — server already null'd them via FK constraint
  S.allLots.forEach(l => { if (l.category_id === catId) l.category_id = null; });
  applyPortfolioFilter();
  return true;
}

async function setLotCategory(lotId, catIdOrNull){
  const { error } = await sb.from('portfolio_lots')
    .update({ category_id: catIdOrNull })
    .eq('id', lotId);
  if (error){ toast('บันทึกกลุ่มล้มเหลว: '+error.message, 'err'); return false; }
  const lot = S.allLots.find(l => l.id === lotId);
  if (lot) lot.category_id = catIdOrNull;
  applyPortfolioFilter();
  return true;
}

/* === CATEGORY EDIT MODAL === */
let _catEditMode = 'create';
let _catEditId = null;
let _pendingLotForNewCat = null;  // when creating from a lot's chip → assign new cat to this lot

function openCreateCatModal(){
  if (!getCurrentPortfolio()){ toast('เลือกพอร์ตเฉพาะก่อน (ไม่ใช่ทั้งหมด)', 'err'); return; }
  _catEditMode = 'create';
  _catEditId = null;
  document.getElementById('catEditTitle').textContent = 'กลุ่มใหม่';
  document.getElementById('catEditName').value = '';
  document.getElementById('catEditConfirm').textContent = 'สร้าง';
  document.getElementById('catEditConfirm').disabled = false;
  document.getElementById('catEditModal').classList.add('active');
  setTimeout(() => { const n = document.getElementById('catEditName'); if (n) n.focus(); }, 60);
}
window.openCreateCatModal = openCreateCatModal;

function openCreateCatModalForLot(lotId){
  _pendingLotForNewCat = lotId;
  closeLotCatPopup();
  openCreateCatModal();
}
window.openCreateCatModalForLot = openCreateCatModalForLot;

function openRenameCatModal(catId){
  const c = getCategoryById(catId);
  if (!c) return;
  _catEditMode = 'rename';
  _catEditId = catId;
  document.getElementById('catEditTitle').textContent = 'เปลี่ยนชื่อกลุ่ม';
  document.getElementById('catEditName').value = c.name;
  document.getElementById('catEditConfirm').textContent = 'บันทึก';
  document.getElementById('catEditConfirm').disabled = false;
  document.getElementById('catEditModal').classList.add('active');
  setTimeout(() => { const n = document.getElementById('catEditName'); if (n){ n.focus(); n.select(); } }, 60);
}
window.openRenameCatModal = openRenameCatModal;

function closeCatEditModal(){
  document.getElementById('catEditModal').classList.remove('active');
  _pendingLotForNewCat = null;  // clear pending state on cancel
}
window.closeCatEditModal = closeCatEditModal;

async function submitCatEdit(){
  const name = document.getElementById('catEditName').value.trim();
  if (!name){ toast('กรุณาใส่ชื่อกลุ่ม', 'err'); return; }
  if (name.length > 40){ toast('ชื่อกลุ่มยาวเกินไป (สูงสุด 40 ตัวอักษร)', 'err'); return; }
  const btn = document.getElementById('catEditConfirm');
  btn.disabled = true;
  if (_catEditMode === 'create'){
    const newCat = await createCategory(name);
    btn.disabled = false;
    if (!newCat) return;
    document.getElementById('catEditModal').classList.remove('active');
    toast('สร้างกลุ่ม "' + name + '" แล้ว', 'ok');
    // If pending lot assignment from chip popup, do it now
    if (_pendingLotForNewCat){
      const lid = _pendingLotForNewCat;
      _pendingLotForNewCat = null;
      await setLotCategory(lid, newCat.id);
      toast('ใส่กลุ่มให้ไม้แล้ว', 'ok');
    }
    if (document.getElementById('manageCatModal').classList.contains('active')) renderManageCatList();
    renderAll();
  } else {
    const ok = await updateCategoryName(_catEditId, name);
    btn.disabled = false;
    if (!ok) return;
    document.getElementById('catEditModal').classList.remove('active');
    toast('เปลี่ยนชื่อแล้ว', 'ok');
    if (document.getElementById('manageCatModal').classList.contains('active')) renderManageCatList();
    renderAll();
  }
}
window.submitCatEdit = submitCatEdit;

function confirmDeleteCategory(catId){
  const c = getCategoryById(catId);
  if (!c) return;
  const lotCount = S.allLots.filter(l => l.category_id === catId).length;
  const text = lotCount === 0
    ? `กลุ่ม "${escapeHtml(c.name)}" ไม่มีไม้ — ลบได้ทันที`
    : `กลุ่ม "${escapeHtml(c.name)}" มี <strong>${lotCount} ไม้</strong> — ไม้จะกลับเป็น <em>"ยังไม่ได้จัดกลุ่ม"</em><br>(ไม้ไม่ถูกลบ)`;
  showConfirm({
    title: 'ลบกลุ่มนี้?',
    text,
    okLabel: 'ลบกลุ่ม',
    onOk: async () => {
      const ok = await deleteCategory(catId);
      if (!ok) return;
      toast('ลบกลุ่มแล้ว', 'ok');
      if (document.getElementById('manageCatModal').classList.contains('active')) renderManageCatList();
      renderAll();
    }
  });
}
window.confirmDeleteCategory = confirmDeleteCategory;

/* === MANAGE CATEGORIES MODAL === */
function openManageCatModal(){
  if (!getCurrentPortfolio()){ toast('เลือกพอร์ตเฉพาะก่อน', 'err'); return; }
  renderManageCatList();
  document.getElementById('manageCatModal').classList.add('active');
}
window.openManageCatModal = openManageCatModal;

function closeManageCatModal(){
  document.getElementById('manageCatModal').classList.remove('active');
}
window.closeManageCatModal = closeManageCatModal;

function renderManageCatList(){
  const cur = getCurrentPortfolio();
  const titleEl = document.getElementById('manageCatTitle');
  if (titleEl) titleEl.textContent = cur ? `จัดการกลุ่ม · ${cur.name}` : 'จัดการกลุ่ม';
  const list = document.getElementById('manageCatList');
  if (!list) return;
  if (!cur){
    list.innerHTML = '<div class="manage-cat-empty">เลือกพอร์ตเฉพาะก่อน</div>';
    return;
  }
  const cats = getCategoriesForPortfolio(cur.id);
  if (cats.length === 0){
    list.innerHTML = '<div class="manage-cat-empty">ยังไม่มีกลุ่มในพอร์ตนี้ — กดปุ่ม "+ กลุ่มใหม่" ด้านล่างเพื่อสร้าง</div>';
    return;
  }
  list.innerHTML = cats.map(c => {
    const lotCount = S.allLots.filter(l => l.category_id === c.id).length;
    return `<div class="manage-cat-row">
      <div class="manage-cat-info">
        <span class="cat-section-dot" style="background:${c.color || '#722F37'}"></span>
        <span class="manage-cat-name">${escapeHtml(c.name)}</span>
        <span class="manage-cat-count">${lotCount} ไม้</span>
      </div>
      <div class="manage-cat-actions">
        <button class="manage-cat-btn rename" onclick="openRenameCatModal('${c.id}')" title="เปลี่ยนชื่อ">เปลี่ยนชื่อ</button>
        <button class="manage-cat-btn danger" onclick="confirmDeleteCategory('${c.id}')" title="ลบกลุ่ม">ลบ</button>
      </div>
    </div>`;
  }).join('');
}

/* === LOT CATEGORY POPUP (anchored chip on lot card) === */
let _lotCatPopupLotId = null;

function openLotCatPopup(lotId, btnEl){
  // Only available in single-portfolio mode (categories are per-portfolio)
  if (S.selectedPortfolioId === VIRTUAL_ALL){ return; }
  _lotCatPopupLotId = lotId;
  const lot = S.allLots.find(l => l.id === lotId);
  if (!lot) return;
  const cur = getCurrentPortfolio();
  if (!cur) return;
  const cats = getCategoriesForPortfolio(cur.id);
  const popup = document.getElementById('lotCatPopup');
  if (!popup) return;
  // Build content
  const items = [];
  // "ไม่จัดกลุ่ม" option
  const isNone = !lot.category_id;
  items.push(`<button class="lot-cat-option ${isNone ? 'active' : ''}" onclick="event.stopPropagation(); pickLotCat(null)">
    <span class="lot-cat-option-dot none"></span>
    <span class="lot-cat-option-name">ไม่จัดกลุ่ม</span>
    ${isNone ? '<span class="lot-cat-check">✓</span>' : ''}
  </button>`);
  // each existing category
  cats.forEach(cat => {
    const active = cat.id === lot.category_id;
    items.push(`<button class="lot-cat-option ${active ? 'active' : ''}" onclick="event.stopPropagation(); pickLotCat('${cat.id}')">
      <span class="lot-cat-option-dot" style="background:${cat.color || '#722F37'}"></span>
      <span class="lot-cat-option-name">${escapeHtml(cat.name)}</span>
      ${active ? '<span class="lot-cat-check">✓</span>' : ''}
    </button>`);
  });
  // "+ สร้างกลุ่มใหม่"
  items.push(`<button class="lot-cat-option create" onclick="event.stopPropagation(); openCreateCatModalForLot('${lotId}')">+ สร้างกลุ่มใหม่</button>`);
  popup.innerHTML = items.join('');
  // Show first to measure
  popup.classList.add('active');
  // Position via getBoundingClientRect
  const rect = btnEl.getBoundingClientRect();
  const popupW = popup.offsetWidth || 200;
  const popupH = popup.offsetHeight || 200;
  let left = rect.left;
  let top  = rect.bottom + 6;
  if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;
  if (left < 8) left = 8;
  if (top + popupH > window.innerHeight - 8){
    // flip up if it would overflow bottom
    top = rect.top - popupH - 6;
    if (top < 8) top = 8;
  }
  popup.style.top  = top + 'px';
  popup.style.left = left + 'px';
}
window.openLotCatPopup = openLotCatPopup;

function closeLotCatPopup(){
  const popup = document.getElementById('lotCatPopup');
  if (popup) popup.classList.remove('active');
  _lotCatPopupLotId = null;
}
window.closeLotCatPopup = closeLotCatPopup;

async function pickLotCat(catId){
  const lotId = _lotCatPopupLotId;
  closeLotCatPopup();
  if (!lotId) return;
  const ok = await setLotCategory(lotId, catId);
  if (ok){
    toast(catId ? 'ย้ายกลุ่มแล้ว' : 'นำออกจากกลุ่มแล้ว', 'ok');
    renderAll();
  }
}
window.pickLotCat = pickLotCat;

// Outside-click closes lot cat popup
document.addEventListener('click', (e) => {
  if (!e.target.closest('.lot-cat-chip') && !e.target.closest('#lotCatPopup')) {
    closeLotCatPopup();
  }
});

window.addEventListener('resize', closeLotCatPopup);
window.addEventListener('scroll', closeLotCatPopup, {passive:true});

/* ============================================================
   PER-LOT METRICS
============================================================ */
/* Dust threshold: half of fmtShares display precision (4 decimals).
   Anything below this rounds to "0.0000" in the UI and is treated as fully closed
   to avoid stuck PARTIAL lots that show 0 shares but block re-selling. */
const DUST_SHARES = 5e-5;

function lotMetrics(lot){
  const sold = lot.sells.reduce((a,s) => a + s.shares_sold, 0);
  const remaining = lot.shares - sold;
  const realizedPnl = lot.sells.reduce((a,s) => a + (s.exit_price - lot.entry_price) * s.shares_sold, 0);
  const proceeds    = lot.sells.reduce((a,s) => a + s.exit_price * s.shares_sold, 0);
  const lp = latestPrice(lot.ticker);
  const latest = lp ? lp.close : null;
  // Dust cleanup: a lot with sub-display-precision remaining is effectively closed
  const isClosed = remaining < DUST_SHARES;
  const effRemaining = isClosed ? 0 : remaining;
  const unrealizedPnl = (latest !== null && effRemaining > 0) ? (latest - lot.entry_price) * effRemaining : 0;
  const marketValue   = (latest !== null && effRemaining > 0) ? latest * effRemaining : 0;
  const costRemaining = effRemaining * lot.entry_price;
  const status = isClosed ? 'closed' : (sold > 1e-8 ? 'partial' : 'open');
  const totalPnl = realizedPnl + unrealizedPnl;
  const pctOriginal = lot.amount_usd > 0 ? (totalPnl / lot.amount_usd) * 100 : 0;
  const unrealizedPct = costRemaining > 0 ? (unrealizedPnl / costRemaining) * 100 : 0;
  return { sold, remaining, effRemaining, realizedPnl, proceeds, latest, unrealizedPnl, marketValue, costRemaining, status, totalPnl, pctOriginal, unrealizedPct };
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

/* Renders a single lot card. Used by both renderLots (ดูเป็นไม้ tab)
   and renderByCategory (ดูตามกลุ่ม tab). Category chip auto-hidden
   in ทั้งหมด mode since categories are per-portfolio. */
function lotCardHtml(lot){
  const m = lotMetrics(lot);
  const sector = S.sectors[lot.ticker] || '';
  const badge = m.status === 'closed' ? '<span class="lot-badge closed">CLOSED</span>'
              : m.status === 'partial' ? '<span class="lot-badge partial">PARTIAL</span>'
              : '<span class="lot-badge open">OPEN</span>';
  const pnlVal = m.totalPnl;
  const pnlCls = pnlText(pnlVal);
  // Category chip — only when in single-portfolio mode
  const showChip = S.selectedPortfolioId !== VIRTUAL_ALL;
  let chipHtml = '';
  if (showChip){
    const cat = getLotCategory(lot);
    if (cat){
      chipHtml = `<button class="lot-cat-chip has-cat" onclick="event.stopPropagation(); openLotCatPopup('${lot.id}', this)" title="เปลี่ยนกลุ่ม">
        <span class="lot-cat-chip-dot" style="background:${cat.color || '#722F37'}"></span>
        <span class="lot-cat-chip-name">${escapeHtml(cat.name)}</span>
      </button>`;
    } else {
      chipHtml = `<button class="lot-cat-chip no-cat" onclick="event.stopPropagation(); openLotCatPopup('${lot.id}', this)" title="จัดกลุ่ม">+ จัดกลุ่ม</button>`;
    }
  }
  const sellsHtml = lot.sells.length === 0 ? '' : '<div class="sell-history">' + lot.sells.map(s => {
    const sellPnl = (s.exit_price - lot.entry_price) * s.shares_sold;
    const cls = sellPnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    return `<div class="sell-row">
      <div class="sell-row-left">
        <span class="sell-row-tag">SOLD</span>
        <span>${s.exit_date} · ${fmtShares(s.shares_sold)} Shares @ $${s.exit_price.toFixed(2)}</span>
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
          ${chipHtml}
        </div>
        <div class="lot-meta">
          ${sector ? sector + ' · ' : ''}ซื้อ ${lot.entry_date} @ $${lot.entry_price.toFixed(2)}<br>
          ${fmtShares(lot.shares)} Shares · ลงทุน ${fmtUSD(lot.amount_usd)}
        </div>
      </div>
      <div class="lot-pnl">
        <div class="lot-pnl-val ${pnlCls}">${fmtUSDsigned(pnlVal)}</div>
        <div class="lot-pnl-pct ${pnlCls}">${fmtPct(m.pctOriginal)}</div>
      </div>
    </div>
    ${m.status === 'closed' ? '' : `
    <div class="lot-detail-row">
      <div>
        <div class="lot-detail-label">ถืออยู่</div>
        <div class="lot-detail-val">${fmtShares(m.effRemaining)} Shares</div>
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
    </div>`}
    ${sellsHtml}
    ${actions}
  </div>`;
}

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
  const html = S.lots.map(lot => lotCardHtml(lot)).join('');
  wrap.innerHTML = `<div class="lots-list">${html}</div>`;
}

/* ============================================================
   RENDER: BY CATEGORY (Phase 2)
   - Only meaningful in single-portfolio mode (categories are per-portfolio)
   - In ทั้งหมด mode, the tab itself is hidden via updateCategoryTabVisibility()
============================================================ */
function renderByCategory(){
  const wrap = document.getElementById('tabCategory');
  if (!wrap) return;
  const cur = getCurrentPortfolio();
  if (!cur){
    // Should never render in ทั้งหมด mode (tab hidden); safety only
    wrap.innerHTML = '';
    return;
  }
  const cats = getCategoriesForPortfolio(cur.id);
  // S.lots is already filtered to current portfolio (per applyPortfolioFilter)
  const portLots = S.lots;
  // Group lots by category
  const byCat = {};
  const uncat = [];
  portLots.forEach(l => {
    if (l.category_id){
      (byCat[l.category_id] = byCat[l.category_id] || []).push(l);
    } else {
      uncat.push(l);
    }
  });

  // Empty-empty state (no categories AND no lots)
  if (cats.length === 0 && portLots.length === 0){
    wrap.innerHTML = `<div class="empty">
      <div class="empty-icon">📁</div>
      <div class="empty-text">ยังไม่มีกลุ่มและยังไม่มีไม้</div>
      <div class="empty-sub">เริ่มจากบันทึกการซื้อใหม่ในพอร์ตนี้ก่อน</div>
    </div>`;
    return;
  }

  // Toolbar
  let html = `<div class="cat-toolbar">
    <div class="cat-toolbar-title">กลุ่มในพอร์ต <strong>${escapeHtml(cur.name)}</strong></div>
    <button class="cat-manage-btn" onclick="openManageCatModal()">⚙ จัดการกลุ่ม</button>
  </div>`;

  // Each category section (in sort_order)
  cats.forEach(cat => {
    const lots = byCat[cat.id] || [];
    html += renderCatSection(cat, lots);
  });

  // Uncategorized section (only if any uncategorized lots exist)
  if (uncat.length > 0){
    html += renderCatSection(null, uncat);
  }

  // Hint when portfolio has lots but no categories
  if (cats.length === 0 && portLots.length > 0){
    html += `<div style="text-align:center;margin-top:14px">
      <button class="cat-create-first-btn" onclick="openCreateCatModal()">+ สร้างกลุ่มแรก</button>
      <div class="cat-create-first-hint">เพื่อจัดระเบียบไม้ในพอร์ต</div>
    </div>`;
  }

  wrap.innerHTML = html;
}

function renderCatSection(cat, lots){
  // Sum metrics for section header
  let mv = 0, realized = 0, unrealized = 0, totalInvested = 0;
  lots.forEach(lot => {
    const m = lotMetrics(lot);
    mv += m.marketValue;
    realized += m.realizedPnl;
    unrealized += m.unrealizedPnl;
    totalInvested += lot.amount_usd;
  });
  const totalPnl = realized + unrealized;
  const pctOnInvested = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const pnlCls = pnlText(totalPnl);
  const pnlSym = totalPnl >= 0 ? '+' : '−';
  const isUncat = !cat;

  const headerHtml = isUncat
    ? `<div class="cat-section-header uncat">
        <span class="cat-section-dot uncat"></span>
        <span class="cat-section-name">ยังไม่ได้จัดกลุ่ม</span>
        <span class="cat-section-count">${lots.length} ไม้</span>
      </div>`
    : `<div class="cat-section-header">
        <span class="cat-section-dot" style="background:${cat.color || '#722F37'}"></span>
        <span class="cat-section-name">${escapeHtml(cat.name)}</span>
        <span class="cat-section-count">${lots.length} ไม้</span>
      </div>`;

  const summaryHtml = lots.length === 0 ? '' : `<div class="cat-section-summary">
    <div class="cat-summary-cell"><div class="cat-summary-label">ลงทุน</div><div class="cat-summary-val">${fmtUSD(totalInvested)}</div></div>
    <div class="cat-summary-cell"><div class="cat-summary-label">มูลค่ารวม</div><div class="cat-summary-val">${fmtUSD(mv + realized)}</div></div>
    <div class="cat-summary-cell"><div class="cat-summary-label">P&amp;L</div><div class="cat-summary-val ${pnlCls}">${pnlSym}${fmtUSD(Math.abs(totalPnl))} (${(totalPnl >= 0 ? '+' : '')}${pctOnInvested.toFixed(2)}%)</div></div>
  </div>`;

  const lotsHtml = lots.length === 0
    ? '<div class="cat-section-empty">ไม่มีไม้ในกลุ่มนี้</div>'
    : `<div class="cat-section-lots">${lots.map(l => lotCardHtml(l)).join('')}</div>`;

  return `<div class="cat-section ${isUncat ? 'uncat-section' : ''}">
    ${headerHtml}
    ${summaryHtml}
    ${lotsHtml}
  </div>`;
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
    a.remainingShares += m.effRemaining;
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
        <div><div class="lot-detail-label">ถืออยู่</div><div class="lot-detail-val">${fmtShares(a.remainingShares)} Shares</div></div>
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
  // In ทั้งหมด mode, the category tab is hidden — guard against accessing it
  if (tab === 'category' && S.selectedPortfolioId === VIRTUAL_ALL){
    tab = 'lots';
  }
  S.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('tabLots').style.display     = tab === 'lots' ? 'block' : 'none';
  document.getElementById('tabTicker').style.display   = tab === 'ticker' ? 'block' : 'none';
  document.getElementById('tabCategory').style.display = tab === 'category' ? 'block' : 'none';
  document.getElementById('tabSells').style.display    = tab === 'sells' ? 'block' : 'none';
}
window.switchTab = switchTab;

/* Hide ดูตามกลุ่ม tab in ทั้งหมด mode (categories are per-portfolio) */
function updateCategoryTabVisibility(){
  const btn = document.getElementById('tabBtnCategory');
  if (!btn) return;
  if (S.selectedPortfolioId === VIRTUAL_ALL){
    btn.style.display = 'none';
    if (S.currentTab === 'category') switchTab('lots');
  } else {
    btn.style.display = '';
  }
}

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
  _addPriceDate = null;
  _addRange = null;
  // Phase 1: destination portfolio field — only shown in ทั้งหมด mode
  const portField  = document.getElementById('addPortField');
  const portSelect = document.getElementById('addPortSelect');
  if (S.selectedPortfolioId === VIRTUAL_ALL && S.portfolios.length > 0){
    portField.style.display = 'block';
    portSelect.innerHTML = S.portfolios.map(p =>
      `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');
    portSelect.value = S.portfolios[0].id;
  } else {
    portField.style.display = 'none';
  }
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

/* Track effective trading day used for current price input + valid range */
let _addPriceDate = null;
let _addRange = null;

function recalcAddPreview(){
  const tk = document.getElementById('addTicker').value.trim().toUpperCase();
  const date = document.getElementById('addDate').value;
  const prev = document.getElementById('addPreview');
  const warn = document.getElementById('addPreviewWarn');
  const btn = document.getElementById('addConfirmBtn');
  const hint = document.getElementById('addTickerHint');
  warn.style.display = 'none'; warn.textContent = '';
  btn.disabled = true;
  if (!tk){ prev.style.display='none'; hint.textContent='พิมพ์อย่างน้อย 1 ตัวอักษร'; hint.className='field-hint'; _addPriceDate=null; return; }
  if (!S.prices[tk]){ prev.style.display='none'; hint.textContent='ไม่พบ ticker นี้ในข้อมูล S&P 500'; hint.className='field-hint err'; _addPriceDate=null; return; }
  hint.textContent = S.sectors[tk] ? `${tk} · ${S.sectors[tk]}` : tk;
  hint.className = 'field-hint';
  if (!date){ prev.style.display='none'; _addPriceDate=null; return; }
  const series = S.prices[tk];
  if (date < series.dates[0]){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `ไม่มีข้อมูลก่อนวันที่ ${series.dates[0]}`;
    _addPriceDate=null; return;
  }
  if (date > S.latestDate){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `วันที่ต้องไม่หลังจากวันที่ข้อมูลล่าสุด (${S.latestDate})`;
    _addPriceDate=null; return;
  }
  const p = priceOnOrBefore(tk, date);
  if (!p){ prev.style.display='none'; warn.style.display='block'; warn.textContent='ไม่พบราคาที่ใช้ได้สำหรับวันที่นี้'; _addPriceDate=null; return; }

  // Show preview box
  prev.style.display = 'block';
  document.getElementById('prevDate').textContent = p.date + (p.date !== date ? '  (วันก่อนหน้า)' : '');

  // Compute allowed range based on T-1, T0, T+1 of the effective trading day
  const range = priceRange(tk, p.idx);
  _addRange = range;
  document.getElementById('priceRangeHint').textContent =
    `ช่วงราคาที่อนุญาต: $${range.min.toFixed(2)} — $${range.max.toFixed(2)} (จาก ${range.days.length === 1 ? '1 วัน' : range.days.length + ' วันรอบ ' + p.date})`;
  document.getElementById('priceRangeHint').classList.remove('err');

  // Reset price input ONLY if effective date changed (preserves manual edits when only amount changes)
  if (_addPriceDate !== p.date){
    document.getElementById('prevPrice').value = p.close.toFixed(2);
    document.getElementById('prevPrice').classList.remove('invalid');
    _addPriceDate = p.date;
  }

  recalcAddSharesFromPrice();
}
window.recalcAddPreview = recalcAddPreview;

/* Re-validate price + recompute shares (called from price input + amount input) */
function recalcAddSharesFromPrice(){
  const priceInp = document.getElementById('prevPrice');
  const sharesEl = document.getElementById('prevShares');
  const btn = document.getElementById('addConfirmBtn');
  const hint = document.getElementById('priceRangeHint');
  const amt = parseFloat(document.getElementById('addAmount').value);
  const price = parseFloat(priceInp.value);

  let priceOk = isFinite(price) && price > 0;
  if (priceOk && _addRange){
    if (price < _addRange.min - 0.005 || price > _addRange.max + 0.005) priceOk = false;
  }
  priceInp.classList.toggle('invalid', !priceOk);
  hint.classList.toggle('err', !priceOk);

  if (!priceOk || !isFinite(amt) || amt <= 0){
    sharesEl.textContent = '—';
    btn.disabled = true;
    return;
  }
  const shares = amt / price;
  sharesEl.textContent = fmtShares(shares) + ' Shares';
  btn.disabled = false;
}

function onAddPriceEdit(){ recalcAddSharesFromPrice(); }
window.onAddPriceEdit = onAddPriceEdit;

async function submitAdd(){
  if (!sb || !S.user){ toast('ไม่ได้เข้าสู่ระบบ', 'err'); return; }
  const tk = document.getElementById('addTicker').value.trim().toUpperCase();
  const date = document.getElementById('addDate').value;
  const amt = parseFloat(document.getElementById('addAmount').value);
  const price = parseFloat(document.getElementById('prevPrice').value);
  const p = priceOnOrBefore(tk, date);
  if (!p){ toast('ไม่พบราคา', 'err'); return; }
  if (!isFinite(price) || price <= 0){ toast('ราคาไม่ถูกต้อง', 'err'); return; }
  if (_addRange && (price < _addRange.min - 0.005 || price > _addRange.max + 0.005)){
    toast(`ราคาเกินช่วงที่อนุญาต ($${_addRange.min.toFixed(2)} — $${_addRange.max.toFixed(2)})`, 'err');
    return;
  }
  // Phase 1: determine destination portfolio
  let pid;
  if (S.selectedPortfolioId === VIRTUAL_ALL){
    pid = document.getElementById('addPortSelect').value;
    if (!pid){ toast('กรุณาเลือกพอร์ตปลายทาง', 'err'); return; }
  } else {
    pid = S.selectedPortfolioId;
  }
  if (!pid){ toast('ไม่พบพอร์ตปลายทาง — โหลดหน้าใหม่', 'err'); return; }
  const shares = amt / price;
  const btn = document.getElementById('addConfirmBtn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
  const { error } = await sb.from('portfolio_lots').insert({
    user_id: S.user.id,
    portfolio_id: pid,
    ticker: tk,
    entry_date: p.date,
    amount_usd: amt,
    entry_price: price,
    shares: shares,
  });
  btn.textContent = 'บันทึก'; btn.disabled = false;
  if (error){ toast('บันทึกล้มเหลว: '+error.message, 'err'); return; }
  toast('บันทึกแล้ว · ' + tk + ' ' + fmtShares(shares) + ' Shares', 'ok');
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
      ซื้อ ${lot.entry_date} @ $${lot.entry_price.toFixed(2)} · ถืออยู่ <strong style="color:var(--text-heading)">${fmtShares(m.effRemaining)}</strong> Shares
    </div>`;
  // Reset mode + amount
  _sellMode = 'shares';
  _sellAllFlag = false;
  document.querySelectorAll('#sellModal .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'shares'));
  const amtInp = document.getElementById('sellAmount');
  amtInp.value = '';
  amtInp.step = '0.0001'; amtInp.min = '0.0001'; amtInp.placeholder = '';
  document.getElementById('sellDate').value = todayISO();
  document.getElementById('sellPreview').style.display = 'none';
  document.getElementById('sellPreviewWarn').style.display = 'none';
  document.getElementById('sellConfirmBtn').disabled = true;
  _sellPriceDate = null;
  _sellRange = null;
  updateSellMaxHint();
  document.getElementById('sellModal').classList.add('active');
  setTimeout(()=> amtInp.focus(), 100);
}
function closeSellModal(){ document.getElementById('sellModal').classList.remove('active'); _sellLot = null; }
window.openSellModal = openSellModal;
window.closeSellModal = closeSellModal;

/* Track effective trading day used for current sell price input + valid range */
let _sellPriceDate = null;
let _sellRange = null;
let _sellMode = 'shares';     // 'shares' or 'usd'
let _sellAllFlag = false;     // true after user clicks "ขายทั้งหมด" until they edit amount

function setSellMode(mode){
  if (mode !== 'shares' && mode !== 'usd') return;
  _sellMode = mode;
  _sellAllFlag = false;
  document.querySelectorAll('#sellModal .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const amtInp = document.getElementById('sellAmount');
  amtInp.value = '';
  if (mode === 'shares'){
    amtInp.step = '0.0001'; amtInp.min = '0.0001'; amtInp.placeholder = '';
  } else {
    amtInp.step = '0.01';   amtInp.min = '0.01';   amtInp.placeholder = '500.00';
  }
  updateSellMaxHint();
  recalcSellProceedsFromPrice();
}
window.setSellMode = setSellMode;

function sellAll(){
  if (!_sellLot) return;
  const m = lotMetrics(_sellLot);
  const price = parseFloat(document.getElementById('sellPrevPrice').value);
  const amtInp = document.getElementById('sellAmount');
  if (_sellMode === 'shares'){
    amtInp.value = fmtShares(m.remaining).replace(/,/g,'');
  } else {
    if (!isFinite(price) || price <= 0){
      toast('เลือกวันที่ขายก่อน เพื่อให้รู้ราคา', 'err');
      return;
    }
    amtInp.value = (m.remaining * price).toFixed(2);
  }
  _sellAllFlag = true;
  recalcSellProceedsFromPrice();
}
window.sellAll = sellAll;

function onSellAmountInput(){
  _sellAllFlag = false;  // user is now manually editing
  recalcSellProceedsFromPrice();
}
window.onSellAmountInput = onSellAmountInput;

function updateSellMaxHint(){
  if (!_sellLot) return;
  const m = lotMetrics(_sellLot);
  const span = document.getElementById('sellMaxLabel');
  const price = parseFloat(document.getElementById('sellPrevPrice').value);
  if (_sellMode === 'shares'){
    if (isFinite(price) && price > 0){
      span.textContent = `${fmtShares(m.remaining)} Shares (≈ ${fmtUSD(m.remaining * price)})`;
    } else {
      span.textContent = `${fmtShares(m.remaining)} Shares`;
    }
  } else {
    if (isFinite(price) && price > 0){
      span.textContent = `${fmtUSD(m.remaining * price)} (= ${fmtShares(m.remaining)} Shares)`;
    } else {
      span.textContent = `(เลือกวันที่ขายก่อน)`;
    }
  }
}

function recalcSellPreview(){
  if (!_sellLot) return;
  const date = document.getElementById('sellDate').value;
  const prev = document.getElementById('sellPreview');
  const warn = document.getElementById('sellPreviewWarn');
  const btn = document.getElementById('sellConfirmBtn');
  warn.style.display = 'none'; warn.textContent='';
  btn.disabled = true;
  const m = lotMetrics(_sellLot);
  if (!date) { prev.style.display='none'; _sellPriceDate=null; updateSellMaxHint(); return; }
  if (date < _sellLot.entry_date){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `วันที่ขายต้องไม่ก่อนวันที่ซื้อ (${_sellLot.entry_date})`;
    _sellPriceDate=null; updateSellMaxHint(); return;
  }
  if (date > S.latestDate){
    prev.style.display='none';
    warn.style.display='block';
    warn.textContent = `วันที่ต้องไม่หลังจากวันที่ข้อมูลล่าสุด (${S.latestDate})`;
    _sellPriceDate=null; updateSellMaxHint(); return;
  }
  const p = priceOnOrBefore(_sellLot.ticker, date);
  if (!p){ prev.style.display='none'; warn.style.display='block'; warn.textContent='ไม่พบราคา'; _sellPriceDate=null; updateSellMaxHint(); return; }

  prev.style.display = 'block';
  document.getElementById('sellPrevDate').textContent = p.date + (p.date !== date ? '  (วันก่อนหน้า)' : '');

  const range = priceRange(_sellLot.ticker, p.idx);
  _sellRange = range;
  document.getElementById('sellPriceRangeHint').textContent =
    `ช่วงราคาที่อนุญาต: $${range.min.toFixed(2)} — $${range.max.toFixed(2)} (จาก ${range.days.length === 1 ? '1 วัน' : range.days.length + ' วันรอบ ' + p.date})`;
  document.getElementById('sellPriceRangeHint').classList.remove('err');

  if (_sellPriceDate !== p.date){
    document.getElementById('sellPrevPrice').value = p.close.toFixed(2);
    document.getElementById('sellPrevPrice').classList.remove('invalid');
    _sellPriceDate = p.date;
  }

  // If user hit "ขายทั้งหมด" while in USD mode without a price, the input is empty.
  // Now that price is available, refill it.
  if (_sellAllFlag && _sellMode === 'usd' && !document.getElementById('sellAmount').value){
    document.getElementById('sellAmount').value = (m.remaining * p.close).toFixed(2);
  }

  updateSellMaxHint();
  recalcSellProceedsFromPrice();
}
window.recalcSellPreview = recalcSellPreview;

/* Re-validate price + amount, derive shares per mode, recompute proceeds + P&L */
function recalcSellProceedsFromPrice(){
  if (!_sellLot) return;
  const priceInp = document.getElementById('sellPrevPrice');
  const proceedsEl = document.getElementById('sellPrevProceeds');
  const pnlEl = document.getElementById('sellPrevPnl');
  const btn = document.getElementById('sellConfirmBtn');
  const hint = document.getElementById('sellPriceRangeHint');
  const warn = document.getElementById('sellPreviewWarn');
  const amt = parseFloat(document.getElementById('sellAmount').value);
  const price = parseFloat(priceInp.value);
  const m = lotMetrics(_sellLot);

  // Validate price
  let priceOk = isFinite(price) && price > 0;
  if (priceOk && _sellRange){
    if (price < _sellRange.min - 0.005 || price > _sellRange.max + 0.005) priceOk = false;
  }
  priceInp.classList.toggle('invalid', !priceOk);
  hint.classList.toggle('err', !priceOk);

  // Bail if amount empty/invalid
  if (!isFinite(amt) || amt <= 0){
    proceedsEl.textContent = '—'; pnlEl.textContent = '—';
    btn.disabled = true; warn.style.display='none'; return;
  }

  // Derive shares from mode
  let shares;
  if (_sellMode === 'shares'){
    shares = amt;
  } else {
    // USD mode requires valid price to convert
    if (!priceOk){
      proceedsEl.textContent = '—'; pnlEl.textContent = '—';
      btn.disabled = true; warn.style.display='none'; return;
    }
    shares = amt / price;
  }
  // If user clicked "ขายทั้งหมด" — snap to exact remaining (avoids floating-point drift)
  if (_sellAllFlag) shares = m.remaining;
  // Dust snap: if user typed a value within display precision of remaining,
  // they meant to sell all. Snap to exact remaining so no dust is left behind.
  else if (shares > m.remaining - DUST_SHARES) shares = m.remaining;

  // Validate shares ≤ remaining
  if (shares > m.remaining + 1e-8){
    proceedsEl.textContent = '—'; pnlEl.textContent = '—';
    warn.style.display = 'block';
    if (_sellMode === 'shares'){
      warn.textContent = `จำนวนหุ้นเกินที่ถืออยู่ (สูงสุด ${fmtShares(m.remaining)})`;
    } else {
      warn.textContent = `จำนวนเงินเกินมูลค่าที่ถืออยู่ (สูงสุด ${fmtUSD(m.remaining * price)})`;
    }
    btn.disabled = true; return;
  }
  warn.style.display = 'none';

  if (!priceOk){
    proceedsEl.textContent = '—'; pnlEl.textContent = '—';
    btn.disabled = true; return;
  }

  const proceeds = price * shares;
  const pnl = (price - _sellLot.entry_price) * shares;
  proceedsEl.textContent = fmtUSD(proceeds);
  pnlEl.textContent = fmtUSDsigned(pnl);
  pnlEl.style.color = pnl >= 0 ? '#226F44' : '#922B21';
  btn.disabled = false;
}

function onSellPriceEdit(){ recalcSellProceedsFromPrice(); }
window.onSellPriceEdit = onSellPriceEdit;

async function submitSell(){
  if (!_sellLot || !sb || !S.user) return;
  const date = document.getElementById('sellDate').value;
  const amt = parseFloat(document.getElementById('sellAmount').value);
  const price = parseFloat(document.getElementById('sellPrevPrice').value);
  const p = priceOnOrBefore(_sellLot.ticker, date);
  if (!p){ toast('ไม่พบราคา', 'err'); return; }
  if (!isFinite(price) || price <= 0){ toast('ราคาไม่ถูกต้อง', 'err'); return; }
  if (_sellRange && (price < _sellRange.min - 0.005 || price > _sellRange.max + 0.005)){
    toast(`ราคาเกินช่วงที่อนุญาต ($${_sellRange.min.toFixed(2)} — $${_sellRange.max.toFixed(2)})`, 'err');
    return;
  }
  if (!isFinite(amt) || amt <= 0){ toast('จำนวนไม่ถูกต้อง', 'err'); return; }

  const m = lotMetrics(_sellLot);
  let shares;
  if (_sellMode === 'shares'){
    shares = amt;
  } else {
    shares = amt / price;
  }
  if (_sellAllFlag) shares = m.remaining;
  // Dust snap (same as preview) — keeps DB write consistent with what user saw
  else if (shares > m.remaining - DUST_SHARES) shares = m.remaining;
  if (shares > m.remaining + 1e-8){
    toast(`จำนวนเกินที่ถืออยู่ (สูงสุด ${fmtShares(m.remaining)} Shares)`, 'err');
    return;
  }

  const btn = document.getElementById('sellConfirmBtn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
  const { error } = await sb.from('portfolio_sells').insert({
    user_id: S.user.id,
    lot_id: _sellLot.id,
    exit_date: p.date,
    exit_price: price,
    shares_sold: shares,
  });
  btn.textContent = 'บันทึก'; btn.disabled = false;
  if (error){ toast('บันทึกล้มเหลว: '+error.message, 'err'); return; }
  const realized = (price - _sellLot.entry_price) * shares;
  toast(`ขายแล้ว · Realized ${fmtUSDsigned(realized)}`, realized >= 0 ? 'ok' : 'err');
  closeSellModal();
  await fetchLots();
  renderAll();
}
window.submitSell = submitSell;

/* ============================================================
   CONFIRM DIALOG (replaces native confirm)
============================================================ */
function showConfirm(opts){
  // opts: { title, text, okLabel, onOk }
  const m = document.getElementById('confirmModal');
  document.getElementById('confirmTitle').textContent = opts.title || 'ยืนยัน';
  document.getElementById('confirmText').innerHTML = opts.text || '';
  const ok = document.getElementById('confirmOkBtn');
  ok.textContent = opts.okLabel || 'ลบ';
  // Replace handler (clone to wipe old listeners)
  const fresh = ok.cloneNode(true);
  ok.parentNode.replaceChild(fresh, ok);
  fresh.addEventListener('click', async () => {
    fresh.disabled = true;
    fresh.textContent = 'กำลังลบ...';
    try { await opts.onOk(); }
    finally { closeConfirmModal(); }
  });
  m.classList.add('active');
}
function closeConfirmModal(){
  document.getElementById('confirmModal').classList.remove('active');
}
window.closeConfirmModal = closeConfirmModal;

/* ============================================================
   DELETE
============================================================ */
async function deleteSell(sellId){
  showConfirm({
    title: 'ลบรายการขายนี้?',
    text: 'รายการขายจะถูกลบและคำนวณ P&amp;L ใหม่ทันที',
    okLabel: 'ลบรายการขาย',
    onOk: async () => {
      const { error } = await sb.from('portfolio_sells').delete().eq('id', sellId);
      if (error){ toast('ลบล้มเหลว: '+error.message, 'err'); return; }
      toast('ลบแล้ว');
      await fetchLots();
      renderAll();
    }
  });
}
window.deleteSell = deleteSell;

async function confirmDeleteLot(lotId, ticker){
  showConfirm({
    title: `ลบไม้ ${ticker} นี้?`,
    text: 'การขายทั้งหมดของไม้นี้จะถูกลบด้วย — <strong>การกระทำนี้ย้อนกลับไม่ได้</strong>',
    okLabel: 'ลบไม้นี้',
    onOk: async () => {
      const { error } = await sb.from('portfolio_lots').delete().eq('id', lotId);
      if (error){ toast('ลบล้มเหลว: '+error.message, 'err'); return; }
      toast('ลบแล้ว');
      await fetchLots();
      renderAll();
    }
  });
}
window.confirmDeleteLot = confirmDeleteLot;

/* ============================================================
   RENDER: SOLD ITEMS
============================================================ */
function renderSells(){
  const wrap = document.getElementById('tabSells');
  // Flatten all sells across all lots, attach lot info
  const allSells = [];
  S.lots.forEach(lot => {
    lot.sells.forEach(s => {
      allSells.push({
        ...s,
        ticker: lot.ticker,
        entry_date: lot.entry_date,
        entry_price: lot.entry_price,
      });
    });
  });

  if (!allSells.length){
    wrap.innerHTML = `<div class="empty">
      <div class="empty-icon">💵</div>
      <div class="empty-text">ยังไม่มีการขาย</div>
      <div class="empty-sub">รายการขายของคุณจะแสดงที่นี่</div>
    </div>`;
    return;
  }

  // Sort newest first
  allSells.sort((a, b) => a.exit_date < b.exit_date ? 1 : (a.exit_date > b.exit_date ? -1 : (a.created_at < b.created_at ? 1 : -1)));

  // Stats
  const totalRealized = allSells.reduce((a, s) => a + (s.exit_price - s.entry_price) * s.shares_sold, 0);
  const totalProceeds = allSells.reduce((a, s) => a + s.exit_price * s.shares_sold, 0);
  const wins = allSells.filter(s => (s.exit_price - s.entry_price) * s.shares_sold > 0).length;
  const winRate = (wins / allSells.length) * 100;

  const statsHtml = `<div class="sells-stats">
    <div class="ss-cell">
      <div class="ss-label">Total Realized</div>
      <div class="ss-value ${pnlText(totalRealized)}">${fmtUSDsigned(totalRealized)}</div>
    </div>
    <div class="ss-cell">
      <div class="ss-label">จำนวนการขาย</div>
      <div class="ss-value">${allSells.length}</div>
    </div>
    <div class="ss-cell">
      <div class="ss-label">Win Rate</div>
      <div class="ss-value">${winRate.toFixed(0)}%</div>
    </div>
  </div>`;

  const cardsHtml = allSells.map(s => {
    const pnl = (s.exit_price - s.entry_price) * s.shares_sold;
    const proceeds = s.exit_price * s.shares_sold;
    const cost = s.entry_price * s.shares_sold;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    const cls = pnlText(pnl);
    // Hold period in days
    const d1 = new Date(s.entry_date + 'T00:00:00');
    const d2 = new Date(s.exit_date + 'T00:00:00');
    const days = Math.round((d2 - d1) / 86400000);
    const sector = S.sectors[s.ticker] || '';

    return `<div class="lot-card">
      <div class="lot-head">
        <div class="lot-head-left">
          <div class="lot-ticker-row">
            <span class="lot-ticker">${s.ticker}</span>
            <span class="lot-badge closed">SOLD</span>
          </div>
          <div class="lot-meta">
            ${sector ? sector + ' · ' : ''}ขาย ${s.exit_date} · ถือ ${days} วัน
          </div>
        </div>
        <div class="lot-pnl">
          <div class="lot-pnl-val ${cls}">${fmtUSDsigned(pnl)}</div>
          <div class="lot-pnl-pct ${cls}">${fmtPct(pnlPct)}</div>
        </div>
      </div>
      <div class="lot-detail-row">
        <div>
          <div class="lot-detail-label">จำนวนที่ขาย</div>
          <div class="lot-detail-val">${fmtShares(s.shares_sold)} Shares</div>
        </div>
        <div>
          <div class="lot-detail-label">ราคาขาย</div>
          <div class="lot-detail-val">$${s.exit_price.toFixed(2)}</div>
        </div>
        <div>
          <div class="lot-detail-label">ราคาซื้อ</div>
          <div class="lot-detail-val">$${s.entry_price.toFixed(2)}</div>
        </div>
        <div>
          <div class="lot-detail-label">เงินที่ได้รับ</div>
          <div class="lot-detail-val">${fmtUSD(proceeds)}</div>
        </div>
      </div>
      <div class="lot-actions">
        <button class="lot-btn delete" style="flex:1" onclick="deleteSell('${s.id}')">ลบรายการขายนี้</button>
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = statsHtml + `<div class="lots-list">${cardsHtml}</div>`;
}

/* ============================================================
   RENDER ALL + TF BAR
============================================================ */
function renderAll(){
  renderHero();
  renderLots();
  renderByTicker();
  renderByCategory();
  renderSells();
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
    setProgress(60);
  } catch(e){
    console.error(e);
    document.querySelector('.owl-loader-text').innerHTML = '<span style="color:#922B21">โหลดข้อมูลราคาล้มเหลว</span>';
    return;
  }
  // 3. sector CSV (non-fatal)
  await loadSectorCSV();
  setProgress(72);
  // 4. Phase 1: portfolios — load + auto-create default for fresh users
  await fetchPortfolios();
  await ensureDefaultPortfolio();
  // 4b. Phase 2: categories
  await fetchCategories();
  setProgress(82);
  // 5. Restore last-selected portfolio from localStorage
  let lastSelected = VIRTUAL_ALL;
  try { lastSelected = localStorage.getItem(lsKeyForUser()) || VIRTUAL_ALL; } catch(e){}
  if (lastSelected !== VIRTUAL_ALL && !S.portfolios.find(p => p.id === lastSelected)){
    lastSelected = VIRTUAL_ALL;  // fallback if previously-selected was deleted
  }
  S.selectedPortfolioId = lastSelected;
  // 6. user lots (filter applied automatically by fetchLots → applyPortfolioFilter)
  await fetchLots();
  setProgress(100);
  // 7. show
  setTimeout(() => {
    showApp();
    bindTfBar();
    renderPortTabs();
    updateCategoryTabVisibility();
    renderAll();
    // Close popup if user scrolls the tab bar horizontally (internal scroll — window scroll listener doesn't catch this)
    const tabsEl = document.getElementById('portTabs');
    if (tabsEl) tabsEl.addEventListener('scroll', closePortTabMenu, {passive:true});
  }, 250);
}

document.addEventListener('DOMContentLoaded', init);
})();
