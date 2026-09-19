/* ============================================================================
   hero-scanner.js — แถบค้นหาหุ้นใน hero หน้าแรก (public)
   ----------------------------------------------------------------------------
   อ่าน sector-latest.json (สร้างจาก sp500/scripts/gen_sector_latest.py ซึ่ง
   พอร์ตตรงมาจาก compute() ของ pages/sector-rotation.html — quadrant ตรงกัน)
   โครง markup + CSS อยู่ใน index.html แล้ว ไฟล์นี้เติมข้อมูลกับพฤติกรรมอย่างเดียว
   ถ้า fetch ล้ม: ซ่อนทั้งบล็อกเงียบๆ hero กลับไปหน้าตาเดิม ไม่มีลิงก์ตาย
   ============================================================================ */
(function () {
  'use strict';

  var root = document.getElementById('heroScanner');
  if (!root) return;

  var QS = {
    lead:   { th: 'นำตลาด',   d: 'แข็งกว่าตลาด และโมเมนตัมความแข็งยังเป็นบวก' },
    improv: { th: 'กำลังฟื้น', d: 'ยังอ่อนกว่าตลาด แต่โมเมนตัมกลับมาเป็นบวกแล้ว' },
    weak:   { th: 'เริ่มแผ่ว', d: 'ยังแข็งกว่าตลาด แต่โมเมนตัมเริ่มหมุนลง' },
    lag:    { th: 'อ่อนแรง',  d: 'อ่อนกว่าตลาด และโมเมนตัมยังเป็นลบ' }
  };
  var TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var PICKS = ['NVDA', 'AAPL', 'JPM', 'XOM', 'LLY'];
  var MAXROWS = 7;

  var D = null, ALL = [], st = { q: '', sel: null, filter: null, cursor: -1 };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    tape: $('scnTape'), input: $('scnInput'), clear: $('scnClear'),
    picks: $('scnPicks'), filters: $('scnFilters'), idle: $('scnIdle'), panel: $('scnPanel')
  };

  /* ---------- format ---------- */
  function pct(v, dg) {
    if (v === null || v === undefined) return '—';
    return (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(dg === undefined ? 2 : dg) + '%';
  }
  function sign(v) { return v > 0 ? 'up' : (v < 0 ? 'dn' : 'fl'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function thDate(iso) { var p = iso.split('-'); return parseInt(p[2], 10) + ' ' + TH_M[parseInt(p[1], 10) - 1] + ' ' + p[0]; }

  function sparkSvg(arr, cls) {
    var n = arr.length, pts = [], i;
    for (i = 0; i < n; i++) pts.push((i / (n - 1) * 100).toFixed(1) + ',' + (100 - arr[i]).toFixed(1));
    return '<svg class="scn-spark ' + cls + '" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + pts.join(' ') + '" vector-effect="non-scaling-stroke"/></svg>';
  }

  /* โลโก้: logos/<TICKER>.png (452 ไฟล์) — ไม่มีไฟล์ = onerror ถอด img ทิ้ง เหลืออักษรย่อข้างหลัง */
  function logo(tk, cls) {
    return '<span class="scn-logo ' + cls + '"><i>' + tk.charAt(0) + '</i>' +
      '<img src="logos/' + tk + '.png" alt="" loading="lazy" onerror="this.remove()"></span>';
  }

  /* RRG หาง 8 สัปดาห์ — map ให้พอดีกรอบ 120x120 โดยไม่ล็อกสเกลตายตัว */
  function rrgSvg(tail, q) {
    if (!tail || tail.length < 2) return '';
    var m = 0, i;
    for (i = 0; i < tail.length; i++) m = Math.max(m, Math.abs(tail[i][0] - 100), Math.abs(tail[i][1] - 100));
    m = Math.max(m, 1.2) * 1.25;
    var k = 46 / m, pts = [];
    for (i = 0; i < tail.length; i++) pts.push((60 + (tail[i][0] - 100) * k).toFixed(1) + ',' + (60 - (tail[i][1] - 100) * k).toFixed(1));
    var h = tail[tail.length - 1], hx = (60 + (h[0] - 100) * k).toFixed(1), hy = (60 - (h[1] - 100) * k).toFixed(1);
    return '<svg class="scn-rrg q-' + q + '" viewBox="0 0 120 120" role="img" aria-label="ตำแหน่งบนแผนที่การหมุน 8 สัปดาห์ล่าสุด">' +
      '<rect class="qa" x="8" y="8" width="52" height="52"/><rect class="qb" x="60" y="8" width="52" height="52"/>' +
      '<rect class="qc" x="8" y="60" width="52" height="52"/><rect class="qd" x="60" y="60" width="52" height="52"/>' +
      '<rect class="fr" x="8" y="8" width="104" height="104" rx="6"/>' +
      '<line class="ax" x1="60" y1="8" x2="60" y2="112"/><line class="ax" x1="8" y1="60" x2="112" y2="60"/>' +
      '<polyline class="tl" points="' + pts.join(' ') + '"/>' +
      '<circle class="hd2" cx="' + hx + '" cy="' + hy + '" r="10"/><circle class="hd" cx="' + hx + '" cy="' + hy + '" r="5"/></svg>';
  }

  /* ---------- search ---------- */
  function hitList() {
    var out = [];
    if (st.filter) {
      D.groups.forEach(function (g) {
        if (g.q !== st.filter) return;
        g.tk.forEach(function (t) { if (D.ticks[t] && out.indexOf(t) < 0) out.push(t); });
      });
      out.sort(function (a, b) { return (D.ticks[b].m || 0) - (D.ticks[a].m || 0); });
      return out;
    }
    var q = st.q.trim().toUpperCase();
    if (!q) return out;
    out = ALL.filter(function (t) { return t.indexOf(q) === 0; });
    ALL.forEach(function (t) { if (t.indexOf(q) > 0 && out.indexOf(t) < 0) out.push(t); });
    return out;
  }

  /* ---------- render ---------- */
  function rowHtml(tk, i) {
    var k = D.ticks[tk];
    var pills = k.g.slice(0, 2).map(function (gi) {
      var g = D.groups[gi];
      return '<span class="scn-pill q-' + g.q + '"><i></i>' + QS[g.q].th + '</span>';
    }).join('');
    return '<button type="button" class="scn-row" data-tk="' + tk + '" data-i="' + i + '">' +
      logo(tk, 'sm') +
      '<span class="scn-tk">' + tk + '</span>' +
      '<span class="scn-grp">' + esc(k.g.map(function (gi) { return D.groups[gi].n; }).join('  ·  ')) + '</span>' +
      '<span class="scn-sp">' + sparkSvg(k.s, sign(k.m)) + '</span>' +
      '<span class="scn-num d1 ' + sign(k.d) + '">' + pct(k.d) + '</span>' +
      '<span class="scn-num m1 b ' + sign(k.m) + '">' + pct(k.m) + '</span>' +
      '<span class="scn-num q1 ' + sign(k.q) + '">' + pct(k.q) + '</span>' +
      '<span class="scn-pills">' + pills + '</span>' +
      '<svg class="scn-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>' +
      '</button>';
  }

  function groupHtml(gi, self) {
    var g = D.groups[gi], bcls = g.breadth >= 50 ? 'lead' : (g.breadth >= 30 ? 'weak' : 'lag');
    var peers = g.tk.slice(0, 12).map(function (t) {
      var k = D.ticks[t];
      return '<button type="button" class="scn-peer' + (t === self ? ' me' : '') + '" data-tk="' + t + '">' +
        logo(t, 'xs') + '<b>' + t + '</b>' +
        '<span class="' + (k ? sign(k.m) : 'fl') + '">' + (k ? pct(k.m, 1) : '—') + '</span></button>';
    }).join('') + (g.tk.length > 12 ? '<span class="scn-more">+' + (g.tk.length - 12) + '</span>' : '');

    return '<div class="scn-gcard">' +
      '<div class="scn-ghead"><div>' +
        '<h4>' + esc(g.n) + '</h4>' +
        '<span class="scn-pill q-' + g.q + '"><i></i>' + QS[g.q].th + '</span>' +
        '<p>' + QS[g.q].d + '</p></div>' +
        '<div class="scn-rrgwrap">' + rrgSvg(g.tail, g.q) + '<span>8 สัปดาห์</span></div>' +
      '</div>' +
      '<div class="scn-stats">' +
        '<span><em>กลุ่ม 1M</em><b class="' + sign(g.r1m) + '">' + pct(g.r1m) + '</b></span>' +
        '<span><em>vs SPY</em><b class="' + sign(g.vs) + '">' + pct(g.vs) + '</b></span>' +
        '<span><em>Breadth</em><b class="pl"><span>' + g.breadth + '%</span>' +
          '<span class="scn-bar"><i class="' + bcls + '" style="width:' + g.breadth + '%"></i></span></b></span>' +
        '<span><em>เงิน 5D/20D</em><b class="' + (g.dvol >= 1.10 ? 'hot' : 'fl') + '">' + g.dvol.toFixed(2) + '×</b></span>' +
      '</div>' +
      '<div class="scn-etfs"><em>ETF อ้างอิง</em>' +
        g.etf.split(' · ').map(function (e) { return '<span>' + esc(e) + '</span>'; }).join('') + '</div>' +
      '<div class="scn-peers"><em>หุ้นในกลุ่ม · ' + g.tk.length + ' ตัว <s>ตัวเลข = 1 เดือน</s></em>' +
        '<div>' + peers + '</div></div>' +
      '</div>';
  }

  function detailHtml(tk) {
    var k = D.ticks[tk];
    var stats = [['1 วัน', k.d], ['1 เดือน', k.m], ['3 เดือน', k.q]].map(function (p) {
      return '<span><em>' + p[0] + '</em><b class="' + sign(p[1]) + '">' + pct(p[1]) + '</b></span>';
    }).join('');
    return '<div class="scn-detail">' +
      '<div class="scn-dhead">' +
        '<button type="button" class="scn-back" id="scnBack" aria-label="กลับไปผลการค้นหา"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>' +
        logo(tk, 'lg') +
        '<span class="scn-dtk">' + tk + '<s>อยู่ใน ' + k.g.length + ' กลุ่มธีม</s></span>' +
        '<span class="scn-dsp">' + sparkSvg(k.s, sign(k.m)) + '</span>' +
        '<span class="scn-dstats">' + stats + '</span>' +
      '</div>' +
      '<div class="scn-gcards' + (k.g.length > 1 ? ' two' : '') + '">' +
        k.g.map(function (gi) { return groupHtml(gi, tk); }).join('') + '</div>' +
      '<div class="scn-dfoot">' +
        '<a class="scn-cta" href="https://app.jptrustlearning.com/sector-rotation" target="_blank" rel="noopener">เปิดแผนที่การหมุนกลุ่ม' +
        '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
        '<span>คำนวณจากราคาปิดรายวันแบบถ่วงน้ำหนักเท่ากัน · อัปเดตหลังตลาดสหรัฐฯ ปิด · เพื่อการศึกษา ไม่ใช่คำแนะนำซื้อขาย</span>' +
      '</div></div>';
  }

  function render() {
    var hits = hitList(), q = st.q.trim();
    el.clear.hidden = !q;
    el.idle.hidden = !!(st.sel || hits.length || q || st.filter);

    Array.prototype.forEach.call(el.filters.children, function (b) {
      b.classList.toggle('on', b.dataset.k === st.filter);
      b.setAttribute('aria-pressed', b.dataset.k === st.filter ? 'true' : 'false');
    });

    if (st.sel && D.ticks[st.sel]) {
      el.panel.hidden = false;
      el.panel.innerHTML = detailHtml(st.sel);
      return;
    }
    if (!hits.length && !q) { el.panel.hidden = true; el.panel.innerHTML = ''; return; }

    el.panel.hidden = false;
    if (!hits.length) {
      el.panel.innerHTML = '<div class="scn-empty"><b>ไม่พบ “' + esc(q) + '”</b>' +
        '<p>กลุ่มธีมสร้างจากหุ้นสมาชิก S&amp;P 500 เท่านั้น — หุ้นนอกดัชนี และกลุ่มที่ยังมีตัวแทนไม่พอ (Quantum, China Tech, Solar) จึงยังไม่อยู่ในรายการ</p></div>';
      return;
    }
    var shown = hits.slice(0, MAXROWS);
    el.panel.innerHTML =
      '<div class="scn-thead"><span class="l"></span><span class="tk">TICKER</span><span class="grp">กลุ่มธีม</span>' +
      '<span class="sp">20 วัน</span><span class="n n1">1D</span><span class="n n2">1M</span><span class="n n3">3M</span>' +
      '<span class="pl">ROTATION</span><span class="c"></span></div>' +
      shown.map(rowHtml).join('') +
      '<div class="scn-pfoot"><span>พบ ' + hits.length + ' ตัว' + (hits.length > MAXROWS ? ' · แสดง ' + MAXROWS + ' แถวแรก' : '') + '</span>' +
      '<a href="https://app.jptrustlearning.com/sector-rotation" target="_blank" rel="noopener">แผนที่การหมุนกลุ่มทั้ง ' + D.groups.length + ' กลุ่ม →</a></div>';
    moveCursor(0, true);
  }

  function moveCursor(i, silent) {
    var rows = el.panel.querySelectorAll('.scn-row');
    if (!rows.length) { st.cursor = -1; return; }
    st.cursor = Math.max(0, Math.min(i, rows.length - 1));
    Array.prototype.forEach.call(rows, function (r, n) { r.classList.toggle('on', n === st.cursor); });
    if (!silent) rows[st.cursor].scrollIntoView({ block: 'nearest' });
  }

  function set(patch) { Object.keys(patch).forEach(function (k) { st[k] = patch[k]; }); render(); }

  /* ---------- chrome ---------- */
  function paintChrome() {
    el.tape.innerHTML =
      [['1D', D.spy.r1d], ['1M', D.spy.r1m], ['3M', D.spy.r3m]].map(function (p) {
        return '<span class="scn-t"><em>SPY ' + p[0] + '</em><b class="' + sign(p[1]) + '">' + pct(p[1]) + '</b></span>';
      }).join('') +
      '<span class="scn-sep"></span><span class="scn-asof">ข้อมูลปิด ' + thDate(D.as_of) + '</span>';

    el.picks.innerHTML = '<span class="scn-hint">ลองดู</span>' +
      PICKS.filter(function (t) { return D.ticks[t]; })
        .map(function (t) { return '<button type="button" class="scn-pick" data-tk="' + t + '">' + t + '</button>'; }).join('');

    var cnt = { lead: 0, improv: 0, weak: 0, lag: 0 };
    D.groups.forEach(function (g) { cnt[g.q]++; });
    el.filters.innerHTML = ['lead', 'improv', 'weak', 'lag'].map(function (k) {
      return '<button type="button" class="scn-f q-' + k + '" data-k="' + k + '" aria-pressed="false">' +
        '<i></i>' + QS[k].th + '<b>' + cnt[k] + '</b></button>';
    }).join('');

    var lead = D.groups.slice().sort(function (a, b) { return b.vs - a.vs; }).slice(0, 3);
    el.idle.innerHTML = '<em>เงินไหลเข้ากลุ่มไหน</em>' +
      lead.map(function (g) {
        return '<span class="scn-ld"><i class="q-' + g.q + '"></i>' + esc(g.n) +
          '<b class="' + sign(g.vs) + '">' + pct(g.vs, 1) + '</b></span>';
      }).join('') + '<s>เทียบ SPY · 1 เดือน</s>';
  }

  /* ---------- events ---------- */
  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('scn-pick')) return set({ q: b.dataset.tk, sel: null, filter: null, cursor: -1 }), el.input.value = b.dataset.tk, void 0;
    if (b.classList.contains('scn-f')) return set({ filter: st.filter === b.dataset.k ? null : b.dataset.k, q: '', sel: null }), el.input.value = '', void 0;
    if (b.id === 'scnClear') return set({ q: '', sel: null, filter: null }), el.input.value = '', el.input.focus(), void 0;
    if (b.id === 'scnBack') return set({ sel: null });
    if (b.dataset.tk) return set({ sel: b.dataset.tk });
  });

  el.input.addEventListener('input', function () { set({ q: el.input.value, sel: null, filter: null }); });

  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(st.cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(st.cursor - 1); }
    else if (e.key === 'Enter') {
      var r = el.panel.querySelectorAll('.scn-row')[st.cursor];
      if (r) { e.preventDefault(); set({ sel: r.dataset.tk }); }
    } else if (e.key === 'Escape') {
      if (st.sel) set({ sel: null });
      else { el.input.value = ''; set({ q: '', filter: null }); }
    }
  });

  /* "/" โฟกัสช่องค้นหา — ไม่แย่งคีย์ตอนผู้ใช้พิมพ์อยู่ในช่องอื่น */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    e.preventDefault(); el.input.focus(); el.input.select();
  });

  /* ---------- boot ---------- */
  var dayKey = new Date().toISOString().slice(0, 10);
  fetch('sector-latest.json?v=' + dayKey)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (j) {
      D = j; ALL = Object.keys(D.ticks).sort();
      paintChrome();
      root.classList.add('ready');
      render();
    })
    .catch(function () { root.remove(); });
})();
