/* lib/jpt-freeze-v1.js — ล็อกรายชื่อหุ้นของล็อตที่ออกโพยไปแล้ว (A193 · 29 ก.ย. 2026)
 *
 * ที่มา: ซ่อม split 23 ก.ย. (CRWD 4:1 · MNST 2:1 · APH 2:1 · FDX spin-off · BKNG แถวเสีย) ทำให้หน้ากลยุทธ์คำนวณย้อนหลังใหม่
 *        แล้วรายชื่อหุ้นของล็อตเก่าเปลี่ยน (repaint) — เช่นล็อต 1 ก.ย. DELL → CRWD ทั้งที่สมาชิกซื้อ DELL ไปแล้ว
 * จูนเลือก (29 ก.ย.): ล็อกทุกล็อตก่อน 1 ก.ย. ให้เหมือนที่หน้าแสดงเมื่อ 2 ก.ย. · ตั้งแต่ล็อต 1 ต.ค. ใช้ข้อมูลใหม่
 *
 * วิธี: "เลือกหุ้นด้วยข้อมูลเดิม · คิดกำไรขาดทุนด้วยข้อมูลจริง"
 *   - ไฟล์ล็อก ./freeze/<ไฟล์ข้อมูล>_freeze_20260831.csv = เฉพาะแถวที่ค่าต่างจากข้อมูลปัจจุบัน (ค่าเดิม ณ ไฟล์ sp500 วันที่ 2 ก.ย.)
 *   - ฟังก์ชันจัดอันดับที่ห่อด้วย wrapRank(): ถ้าวันจัดอันดับ ≤ UPTO → มองข้อมูลผ่าน "มุมมอง 2 ก.ย." (ข้อมูลจริง + แถวในไฟล์ล็อก)
 *     หลังจากนั้น / ส่วนอื่นของหน้า (ราคาซื้อขาย มูลค่าพอร์ต กราฟ DD) = ข้อมูลจริงเสมอ
 *   - cache ผลรวม volume (state.volPrefix) ในมุมมองล็อก = สำเนาที่คำนวณใหม่เฉพาะหุ้นในไฟล์ล็อก
 * โหลดไฟล์ล็อกไม่ได้ = throw "/freeze/ ..." (ไม่เงียบ — ไม่งั้นรายชื่อจะ repaint โดยไม่มีใครรู้)
 * ⚠️ ห้ามแก้ไฟล์นี้ทับ — ซ่อมข้อมูลรอบใหม่ = ทำ v2 ที่รองรับหลายชุด (UPTO หลายวัน) แล้วย้ายทีละหน้า
 *
 * ใช้:  await jptFreeze.load([fileUrl, histUrl, hist1996Url]);           // หลังโหลดข้อมูล ก่อน processData/runBacktest
 *       rankStocks = jptFreeze.wrapRank(rankStocks, () => state);        // ครั้งเดียว ต่อจากประกาศฟังก์ชัน
 *       sniperRankLB6 = jptFreeze.wrapSeriesRank(sniperRankLB6);         // หน้าตระกูล Sniper (S, t, topN)
 */
(function () {
  'use strict';
  if (window.jptFreeze && window.jptFreeze.version === 1) return;

  var UPTO = '2026-08-31';   // วันจัดอันดับสุดท้ายที่ล็อก (= ล็อต 1 ก.ย. 2026)
  var FILES = {
    'input_sp500_daily.csv': './freeze/input_sp500_daily_freeze_20260831.csv',
    'input_sp500_daily_since2001.csv': './freeze/input_sp500_daily_since2001_freeze_20260831.csv',
    'input_sp500_daily_since1996.csv': './freeze/input_sp500_daily_since1996_freeze_20260831.csv'
  };

  var over = null;       // { date: { ticker: {o,h,l,c,v} } }
  var overTickers = {};  // ticker → 1
  var loaded = {};       // freeze file path → true
  var info = { rows: 0, files: [] };

  function baseName(u) { return String(u || '').split('?')[0].split('/').pop(); }

  async function fetchText(path) {
    var lastErr;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var r = await fetch(path + '?v=20260831', attempt ? { cache: 'reload' } : undefined);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var t = await r.text();
        if (!/^﻿?\s*Ticker,Date,/i.test(t.slice(0, 100))) throw new Error('ไม่ใช่ไฟล์ล็อก (อาจเป็นหน้า HTML)');
        return t;
      } catch (e) {
        lastErr = e;
        await new Promise(function (res) { setTimeout(res, 800 * (attempt + 1)); });
      }
    }
    throw lastErr;
  }

  function parseInto(t) {
    var lines = t.split('\n'), n = 0;
    for (var i = 1; i < lines.length; i++) {
      var row = lines[i].split(',');
      if (row.length < 7) continue;
      var tk = row[0].trim(), d = row[1].trim();
      if (!over[d]) over[d] = {};
      over[d][tk] = { o: parseFloat(row[2]), h: parseFloat(row[3]), l: parseFloat(row[4]), c: parseFloat(row[5]), v: parseFloat(row[6]) };
      overTickers[tk] = 1; n++;
    }
    return n;
  }

  async function load(dataUrls) {
    var paths = [];
    (dataUrls || []).forEach(function (u) { var p = FILES[baseName(u)]; if (p && !loaded[p] && paths.indexOf(p) < 0) paths.push(p); });
    if (!paths.length) return info;
    var texts;
    try {
      texts = await Promise.all(paths.map(fetchText));
    } catch (e) {
      throw new Error('/freeze/ โหลดไฟล์ล็อกรายชื่อไม่สำเร็จ · ' + ((e && e.message) || e));
    }
    if (!over) over = {};
    texts.forEach(function (t, i) { info.rows += parseInto(t); loaded[paths[i]] = true; info.files.push(paths[i]); });
    viewCache = null; prefixCache = null;
    return info;
  }

  // ---- มุมมอง 2 ก.ย. ----
  var viewCache = null;    // { src: marketData, view: Proxy }
  var prefixCache = null;  // { src: volPrefix, md: marketData, dates: sortedDates, prefix }

  function makeView(M) {
    var merged = new Map();  // date → plain object (ข้อมูลจริงของวันนั้น + แถวล็อก) · สร้างเมื่อถูกอ่านครั้งแรก
    return new Proxy(M, {
      get: function (target, key) {
        var o = (typeof key === 'string') ? over[key] : null;
        var real = target[key];
        if (!o || !real || key > UPTO) return real;
        var m = merged.get(key);
        if (!m) {
          m = Object.assign({}, real);
          for (var tk in o) if (real[tk]) m[tk] = Object.assign({}, real[tk], o[tk]);
          merged.set(key, m);
        }
        return m;
      }
    });
  }
  function viewOf(M) {
    if (!viewCache || viewCache.src !== M) viewCache = { src: M, view: makeView(M) };
    return viewCache.view;
  }
  function frozenPrefix(P, M, dates) {
    if (prefixCache && prefixCache.src === P && prefixCache.md === M && prefixCache.dates === dates) return prefixCache.prefix;
    var V = viewOf(M), out = Object.assign({}, P);
    Object.keys(overTickers).forEach(function (t) {
      if (!P[t]) return;
      var N = dates.length, cum = new Float64Array(N), total = 0;
      for (var i = 0; i < N; i++) { var dd = V[dates[i]]; if (dd && dd[t]) total += dd[t].v; cum[i] = total; }
      out[t] = cum;
    });
    prefixCache = { src: P, md: M, dates: dates, prefix: out };
    return out;
  }

  function active(dateStr) { return !!over && !!dateStr && dateStr <= UPTO; }

  function withView(state, fn) {
    var M = state.marketData, P = state.volPrefix;
    state.marketData = viewOf(M);
    if (P) state.volPrefix = frozenPrefix(P, M, state.sortedDates);
    try { return fn(); }
    finally { state.marketData = M; state.volPrefix = P; }
  }

  // ห่อฟังก์ชันจัดอันดับ: argument แรก = index วันจัดอันดับใน state.sortedDates
  function wrapRank(fn, getState) {
    if (fn && fn.__jptFrozen) return fn;
    var w = function (endIdx) {
      var st = getState(), self = this, args = arguments;
      var d = st && st.sortedDates ? st.sortedDates[endIdx] : null;
      if (!active(d)) return fn.apply(self, args);
      return withView(st, function () { return fn.apply(self, args); });
    };
    w.__jptFrozen = true;
    return w;
  }

  // ---- หน้าตระกูล Sniper: ข้อมูลเป็นอาร์เรย์ S = { dates, tickers, m, closeA, volA, ... } (buildSniperSeries) ----
  // สำเนา closeA/volA ที่แทนค่าหุ้นในไฟล์ล็อก (เฉพาะวัน ≤ UPTO) — ใช้ตอนจัดอันดับเท่านั้น · S ตัวจริงไม่ถูกแตะ
  function frozenSeries(S) {
    if (S.__jptFrozen) return S.__jptFrozen;
    var m = S.m, tIdx = {}, closeA = S.closeA.slice(), volA = S.volA ? S.volA.slice() : S.volA;
    S.tickers.forEach(function (t, j) { tIdx[t] = j; });
    for (var i = 0; i < S.dates.length; i++) {
      var d = S.dates[i];
      if (d > UPTO) break;
      var o = over[d];
      if (!o) continue;
      for (var tk in o) {
        var j = tIdx[tk];
        if (j === undefined) continue;
        if (isFinite(closeA[i * m + j]) && isFinite(o[tk].c)) closeA[i * m + j] = o[tk].c;
        if (volA && isFinite(o[tk].v)) volA[i * m + j] = o[tk].v;
      }
    }
    var F = Object.assign({}, S, { closeA: closeA, volA: volA });
    Object.defineProperty(S, '__jptFrozen', { value: F, enumerable: false, configurable: true });
    return F;
  }
  // ห่อฟังก์ชันจัดอันดับแบบ (S, t, ...) — t = index ใน S.dates
  function wrapSeriesRank(fn) {
    if (fn && fn.__jptFrozen) return fn;
    var w = function (S, t) {
      if (!S || !S.dates || !active(S.dates[t])) return fn.apply(this, arguments);
      var args = Array.prototype.slice.call(arguments);
      args[0] = frozenSeries(S);
      return fn.apply(this, args);
    };
    w.__jptFrozen = true;
    return w;
  }

  // ---- หน้า Buy the Dip: "วันสัญญาณ" ก็คำนวณจากหุ้นทั้งตลาด (breadth / dip / fear) → การซ่อมทำให้วันสัญญาณเลื่อน ----
  // ห่อ buildSniperSeries(): สร้างชุดจริง R (ใช้คิดราคา/กำไรขาดทุน) + ชุดมุมมอง 2 ก.ย. F (ใช้แค่สัญญาณ)
  //   สัญญาณ ≤ UPTO เอาจาก F · หลัง UPTO เอาจาก R · อาร์เรย์รายวันยาว n (breadth/ddArr/dipArr/...) ช่วง ≤ UPTO เอาจาก F
  //   closeA/openA/volA/สถานะล่าสุด = R เสมอ
  var IDX_KEYS = ['signals', 'ddSignals', 'conflSignals'];
  var PAR_KEYS = { signals: ['sigKinds'], conflSignals: ['conflReasons'] };
  function lastIdxUpTo(dates) {
    var cut = -1;
    for (var i = 0; i < dates.length; i++) { if (dates[i] <= UPTO) cut = i; else break; }
    return cut;
  }
  function mergeSignals(R, F) {
    var cut = lastIdxUpTo(R.dates), out = {};
    IDX_KEYS.forEach(function (k) {
      if (!Array.isArray(R[k]) || !Array.isArray(F[k])) return;
      var fSel = [], rSel = [];
      F[k].forEach(function (t, i) { if (t <= cut) fSel.push(i); });
      R[k].forEach(function (t, i) { if (t > cut) rSel.push(i); });
      out[k] = fSel.map(function (i) { return F[k][i]; }).concat(rSel.map(function (i) { return R[k][i]; }));
      (PAR_KEYS[k] || []).forEach(function (p) {
        if (!Array.isArray(R[p]) || !Array.isArray(F[p])) return;
        out[p] = fSel.map(function (i) { return F[p][i]; }).concat(rSel.map(function (i) { return R[p][i]; }));
      });
    });
    Object.keys(R).forEach(function (k) {
      if (k === 'dates' || k === 'tickers' || out[k]) return;
      var v = R[k], f = F[k];
      if (!v || !f || typeof v.length !== 'number' || v.length !== R.n || f.length !== R.n) return;
      if (!(Array.isArray(v) || ArrayBuffer.isView(v))) return;
      for (var i = 0; i <= cut; i++) v[i] = f[i];
    });
    Object.keys(out).forEach(function (k) { R[k] = out[k]; });
    return R;
  }
  function wrapSeriesBuild(fn, getState) {
    if (fn && fn.__jptFrozen) return fn;
    var w = function () {
      var st = getState();
      if (!over || !st || st._sniper) return fn.apply(this, arguments);
      var R = fn.apply(this, arguments);
      st._sniper = null;
      var F;
      try { F = withView(st, function () { return fn(); }); }
      finally { st._sniper = R; }
      return mergeSignals(R, F);
    };
    w.__jptFrozen = true;
    return w;
  }

  window.jptFreeze = {
    version: 1,
    UPTO: UPTO,
    load: load,
    active: active,
    withView: withView,
    wrapRank: wrapRank,
    wrapSeriesRank: wrapSeriesRank,
    wrapSeriesBuild: wrapSeriesBuild,
    info: info,
    isFreezeError: function (err) { return !!(err && /^\/freeze\//.test(err.message || '')); }
  };
})();
