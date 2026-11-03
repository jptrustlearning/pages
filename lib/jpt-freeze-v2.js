/* lib/jpt-freeze-v2.js — ล็อกรายชื่อหุ้นของล็อตที่ออกโพยไปแล้ว · รองรับหลายชุด (3 พ.ย. 2026)
 *
 * ต่อจาก v1 (A193 · ห้ามแก้ v1 ทับ) — v1 ล็อกได้ชุดเดียว (วันจัดอันดับ ≤ 2026-08-31 · ค่า ณ ไฟล์ sp500 วันที่ 2 ก.ย.)
 * v2 = หลายชุดเรียงตามวัน: ชุดที่ k ล็อกวันจัดอันดับ ≤ SETS[k].upto ด้วยค่า ณ วันที่ทำชุดนั้น
 *   ชุด 0  upto 2026-08-31  ./freeze/*_freeze_20260831.csv   (ไฟล์เดิมของ v1 ไม่แตะ · ล็อตถึง 1 ก.ย. 2026)
 *   ชุด 1  upto 2026-10-30  ./freeze/input_sp500_daily_freeze_20261030.csv  (ค่า ณ sp500 `6a0170b` = ข้อมูลที่หน้าแสดงวันที่ 2 พ.ย. · ล็อต 1 ต.ค. + 2 พ.ย. 2026)
 * วันจัดอันดับ d ใช้ทุกชุดที่ upto ≥ d · แถวเดียวกันมีหลายชุด = ชุดที่เก่ากว่า (upto น้อยกว่า) ชนะ
 *   (ชุดใหม่บันทึกค่าก่อนการแก้ข้อมูลรอบหลัง · ชุดเก่าบันทึกค่าก่อนรอบก่อน → ซ้อนกันได้ค่าดั้งเดิม)
 * วิธีเหมือน v1: "เลือกหุ้นด้วยข้อมูลเดิม · คิดกำไรขาดทุนด้วยข้อมูลจริง"
 *   - ไฟล์ล็อก = เฉพาะแถวที่ค่าต่างจากข้อมูลตอนทำไฟล์ · ห่อเฉพาะฟังก์ชันจัดอันดับ (wrapRank)
 *   - ราคาซื้อขาย มูลค่าพอร์ต กราฟ DD = ข้อมูลจริงเสมอ
 * โหลดไฟล์ล็อกไม่ได้ = throw "/freeze/ ..." (ไม่เงียบ)
 * ขอบเขต: wrapRank (หน้าตระกูล rank) เท่านั้น · หน้าตระกูล Sniper (wrapSeriesRank / wrapSeriesBuild) ยังใช้ v1
 * ⚠️ ห้ามแก้ไฟล์นี้ทับ — เพิ่มชุดใหม่ = ทำ v3
 *
 * ใช้:  await jptFreeze.load([fileUrl, histUrl, hist1996Url]);
 *       rankStocks = jptFreeze.wrapRank(rankStocks, () => state);
 */
(function () {
  'use strict';
  if (window.jptFreeze && window.jptFreeze.version === 2) return;

  var SETS = [
    { upto: '2026-08-31', tag: '20260831', files: {
        'input_sp500_daily.csv': './freeze/input_sp500_daily_freeze_20260831.csv',
        'input_sp500_daily_since2001.csv': './freeze/input_sp500_daily_since2001_freeze_20260831.csv',
        'input_sp500_daily_since1996.csv': './freeze/input_sp500_daily_since1996_freeze_20260831.csv' } },
    { upto: '2026-10-30', tag: '20261030', files: {
        'input_sp500_daily.csv': './freeze/input_sp500_daily_freeze_20261030.csv' } }
  ];
  var UPTO = SETS[SETS.length - 1].upto;   // วันจัดอันดับสุดท้ายที่ล็อก (ทุกชุด)

  var over = SETS.map(function () { return null; });         // ชุด k: { date: { ticker: {o,h,l,c,v} } }
  var overTickers = SETS.map(function () { return {}; });    // ชุด k: ticker → 1
  var loaded = {};                                           // freeze file path → true
  var info = { rows: 0, files: [], sets: SETS.map(function (s) { return { upto: s.upto, rows: 0 }; }) };

  function baseName(u) { return String(u || '').split('?')[0].split('/').pop(); }

  async function fetchText(path, tag) {
    var lastErr;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var r = await fetch(path + '?v=' + tag, attempt ? { cache: 'reload' } : undefined);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var t = await r.text();
        if (!/^\uFEFF?\s*Ticker,Date,/i.test(t.slice(0, 100))) throw new Error('ไม่ใช่ไฟล์ล็อก (อาจเป็นหน้า HTML)');
        return t;
      } catch (e) {
        lastErr = e;
        await new Promise(function (res) { setTimeout(res, 800 * (attempt + 1)); });
      }
    }
    throw lastErr;
  }

  function parseInto(k, t) {
    var lines = t.split('\n'), n = 0, upto = SETS[k].upto;
    if (!over[k]) over[k] = {};
    for (var i = 1; i < lines.length; i++) {
      var row = lines[i].split(',');
      if (row.length < 7) continue;
      var tk = row[0].trim(), d = row[1].trim();
      if (d > upto) continue;   // ชุดนี้ล็อกเฉพาะวัน ≤ upto
      if (!over[k][d]) over[k][d] = {};
      over[k][d][tk] = { o: parseFloat(row[2]), h: parseFloat(row[3]), l: parseFloat(row[4]), c: parseFloat(row[5]), v: parseFloat(row[6]) };
      overTickers[k][tk] = 1; n++;
    }
    return n;
  }

  async function load(dataUrls) {
    var jobs = [];
    (dataUrls || []).forEach(function (u) {
      var b = baseName(u);
      SETS.forEach(function (s, k) {
        var p = s.files[b];
        if (p && !loaded[p] && !jobs.some(function (j) { return j.path === p; })) jobs.push({ k: k, path: p, tag: s.tag });
      });
    });
    if (!jobs.length) return info;
    var texts;
    try {
      texts = await Promise.all(jobs.map(function (j) { return fetchText(j.path, j.tag); }));
    } catch (e) {
      throw new Error('/freeze/ โหลดไฟล์ล็อกรายชื่อไม่สำเร็จ · ' + ((e && e.message) || e));
    }
    texts.forEach(function (t, i) {
      var j = jobs[i], n = parseInto(j.k, t);
      info.rows += n; info.sets[j.k].rows += n; loaded[j.path] = true; info.files.push(j.path);
    });
    viewCache = {}; prefixCache = {};
    return info;
  }

  // ชุดแรก (เก่าสุด) ที่ครอบวัน d · -1 = ไม่ล็อก
  function levelOf(d) {
    if (!d) return -1;
    for (var k = 0; k < SETS.length; k++) if (over[k] && d <= SETS[k].upto) return k;
    return -1;
  }
  function active(dateStr) { return levelOf(dateStr) >= 0; }

  // ---- มุมมองระดับ L = ข้อมูลจริง + แถวชุด k ≥ L (ชุดเก่ากว่าทับชุดใหม่กว่า) ----
  var viewCache = {};    // L → { src: marketData, view: Proxy }
  var prefixCache = {};  // L → { src: volPrefix, md: marketData, dates: sortedDates, prefix }

  function makeView(M, L) {
    var merged = new Map();
    return new Proxy(M, {
      get: function (target, key) {
        var real = target[key];
        if (typeof key !== 'string' || !real) return real;
        var hit = false;
        for (var k = L; k < SETS.length; k++) if (over[k] && over[k][key]) { hit = true; break; }
        if (!hit) return real;
        var m = merged.get(key);
        if (!m) {
          m = Object.assign({}, real);
          for (var k2 = SETS.length - 1; k2 >= L; k2--) {     // ใหม่ → เก่า · ตัวที่เขียนทีหลัง (เก่ากว่า) ชนะ
            var o = over[k2] && over[k2][key];
            if (!o) continue;
            for (var tk in o) if (real[tk]) m[tk] = Object.assign({}, real[tk], o[tk]);
          }
          merged.set(key, m);
        }
        return m;
      }
    });
  }
  function viewOf(M, L) {
    var c = viewCache[L];
    if (!c || c.src !== M) { c = viewCache[L] = { src: M, view: makeView(M, L) }; }
    return c.view;
  }
  function frozenPrefix(P, M, dates, L) {
    var c = prefixCache[L];
    if (c && c.src === P && c.md === M && c.dates === dates) return c.prefix;
    var V = viewOf(M, L), out = Object.assign({}, P), tks = {};
    for (var k = L; k < SETS.length; k++) for (var t in overTickers[k]) tks[t] = 1;
    Object.keys(tks).forEach(function (t) {
      if (!P[t]) return;
      var N = dates.length, cum = new Float64Array(N), total = 0;
      for (var i = 0; i < N; i++) { var dd = V[dates[i]]; if (dd && dd[t]) total += dd[t].v; cum[i] = total; }
      out[t] = cum;
    });
    prefixCache[L] = { src: P, md: M, dates: dates, prefix: out };
    return out;
  }

  function withView(state, L, fn) {
    var M = state.marketData, P = state.volPrefix;
    state.marketData = viewOf(M, L);
    if (P) state.volPrefix = frozenPrefix(P, M, state.sortedDates, L);
    try { return fn(); }
    finally { state.marketData = M; state.volPrefix = P; }
  }

  // ห่อฟังก์ชันจัดอันดับ: argument แรก = index วันจัดอันดับใน state.sortedDates
  function wrapRank(fn, getState) {
    if (fn && fn.__jptFrozen) return fn;
    var w = function (endIdx) {
      var st = getState(), self = this, args = arguments;
      var d = st && st.sortedDates ? st.sortedDates[endIdx] : null;
      var L = levelOf(d);
      if (L < 0) return fn.apply(self, args);
      return withView(st, L, function () { return fn.apply(self, args); });
    };
    w.__jptFrozen = true;
    return w;
  }

  window.jptFreeze = {
    version: 2,
    UPTO: UPTO,
    SETS: SETS.map(function (s) { return { upto: s.upto, tag: s.tag }; }),
    load: load,
    active: active,
    levelOf: levelOf,
    wrapRank: wrapRank,
    info: info,
    isFreezeError: function (err) { return !!(err && /^\/freeze\//.test(err.message || '')); }
  };
})();
