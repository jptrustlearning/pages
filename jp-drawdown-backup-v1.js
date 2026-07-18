/* =============================================================================
 * jp-drawdown.js — สถิติฝั่งขาลง (downside analytics)
 * -----------------------------------------------------------------------------
 * Max Drawdown บอกได้แค่จุดที่แย่ที่สุดจุดเดียว ชุดนี้บอกว่า "ปกติแล้วเจ็บแค่ไหน"
 * และ "เจ็บบ่อยแค่ไหน" ซึ่งแยกกลยุทธ์ออกจากกันได้ดีกว่ามาก
 *
 * ใช้ร่วมกันทุกหน้ากลยุทธ์ — รับ state.equityCurve ([{date, equity}]) และ
 * state.universeDaily ([{date, val}]) เป็น benchmark ทางเลือก
 *
 * JPDrawdown.compute(curve)                 -> ค่าสถิติ
 * JPDrawdown.render(containerId, curve, bench)
 * ========================================================================== */
(function () {
  'use strict';

  var TRADING_DAYS = 252;

  function val(p) {
    if (p == null) return null;
    if (typeof p === 'number') return p;
    if (p.equity != null) return p.equity;
    if (p.val != null) return p.val;
    if (p.value != null) return p.value;
    return null;
  }

  /* ---------- ชุด drawdown รายวัน: (มูลค่า / ยอดสูงสุดที่เคยทำได้) - 1 ---------- */
  function ddSeries(curve) {
    var peak = -Infinity, out = [], i, v;
    for (i = 0; i < curve.length; i++) {
      v = val(curve[i]);
      if (v == null || !isFinite(v)) continue;
      if (v > peak) peak = v;
      out.push({ date: curve[i].date, dd: peak > 0 ? (v / peak - 1) * 100 : 0 });
    }
    return out;
  }

  /* ---------- แยกเป็น "รอบ" — ช่วงต่อเนื่องที่อยู่ต่ำกว่ายอดเดิม ---------- */
  function findEpisodes(dds, minDepth) {
    var eps = [], i = 0, n = dds.length, j, t;
    while (i < n) {
      if (dds[i].dd < -1e-9) {
        j = i; t = i;
        while (j < n && dds[j].dd < -1e-9) {
          if (dds[j].dd < dds[t].dd) t = j;
          j++;
        }
        eps.push({
          start: dds[i].date,
          trough: dds[t].date,
          depth: -dds[t].dd,
          days: j - i,
          recovered: j < n
        });
        i = j;
      } else i++;
    }
    return eps.filter(function (e) { return e.depth >= (minDepth || 5); });
  }

  function compute(curve) {
    if (!curve || curve.length < 20) return null;

    var dds = ddSeries(curve);
    if (dds.length < 20) return null;

    var vals = dds.map(function (x) { return x.dd; });
    var under = vals.filter(function (v) { return v < -1e-9; });

    var maxDD = Math.min.apply(null, vals);
    var sum = 0, sq = 0, i;
    for (i = 0; i < vals.length; i++) { sum += vals[i]; sq += vals[i] * vals[i]; }
    var avgAll = sum / vals.length;
    var avgUnder = under.length ? under.reduce(function (a, b) { return a + b; }, 0) / under.length : 0;
    var pctUnder = 100 * under.length / vals.length;
    var ulcer = Math.sqrt(sq / vals.length);

    /* ผลตอบแทนรายวัน -> Sortino (ต่อปี, เกณฑ์ 0) */
    var rets = [], a, b;
    for (i = 1; i < curve.length; i++) {
      a = val(curve[i - 1]); b = val(curve[i]);
      if (a > 0 && b != null && isFinite(b)) rets.push(b / a - 1);
    }
    var mean = rets.length ? rets.reduce(function (x, y) { return x + y; }, 0) / rets.length : 0;
    var dsq = 0;
    for (i = 0; i < rets.length; i++) if (rets[i] < 0) dsq += rets[i] * rets[i];
    var dsd = rets.length ? Math.sqrt(dsq / rets.length) : 0;
    var sortino = dsd > 0 ? (mean * TRADING_DAYS) / (dsd * Math.sqrt(TRADING_DAYS)) : NaN;

    var years = curve.length / TRADING_DAYS;
    var first = val(curve[0]), last = val(curve[curve.length - 1]);
    var cagr = (first > 0 && years > 0) ? (Math.pow(last / first, 1 / years) - 1) * 100 : NaN;
    var calmar = (maxDD < 0 && isFinite(cagr)) ? cagr / Math.abs(maxDD) : NaN;

    var eps = findEpisodes(dds, 5);
    var deep10 = eps.filter(function (e) { return e.depth >= 10; }).length;
    var deep20 = eps.filter(function (e) { return e.depth >= 20; }).length;
    var avgEp = eps.length ? eps.reduce(function (s, e) { return s + e.depth; }, 0) / eps.length : 0;
    var longest = eps.length ? Math.max.apply(null, eps.map(function (e) { return e.days; })) : 0;

    return {
      maxDD: maxDD, avgAll: avgAll, avgUnder: avgUnder, pctUnder: pctUnder,
      ulcer: ulcer, sortino: sortino, calmar: calmar, cagr: cagr,
      nEp: eps.length, deep10: deep10, deep20: deep20,
      avgEp: avgEp, longest: longest,
      currentDD: vals[vals.length - 1],
      top: eps.slice().sort(function (x, y) { return y.depth - x.depth; }).slice(0, 3),
      days: curve.length
    };
  }

  /* ---------- ตัด benchmark ให้ตรงช่วงวันของกลยุทธ์ ---------- */
  function alignBench(bench, curve) {
    if (!bench || !bench.length || !curve || !curve.length) return null;
    var a = curve[0].date, b = curve[curve.length - 1].date;
    var out = bench.filter(function (x) { return x.date >= a && x.date <= b; });
    return out.length > 20 ? out : null;
  }

  var CSS_ID = 'jpdd-style';
  var CSS = [
    '.jpdd-wrap{margin-top:22px}',
    '.jpdd-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 4px}',
    '.jpdd-kicker{font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--gold-deep,#B8860B);font-weight:600}',
    '.jpdd-title{font-size:15px;font-weight:700;color:var(--gold-deep,#B8860B)}',
    '.jpdd-lead{font-size:12px;line-height:1.7;color:var(--text-muted,#8a8a8a);margin:0 0 14px}',
    '.jpdd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}',
    '.jpdd-cmp{font-size:10.5px;color:var(--text-muted,#8a8a8a);margin-top:3px;letter-spacing:.2px}',
    '.jpdd-tbl{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}',
    '.jpdd-tbl th{text-align:left;font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;',
    '  color:var(--gold-deep,#B8860B);font-weight:600;padding:7px 8px;border-bottom:1px solid rgba(212,175,55,.28)}',
    '.jpdd-tbl td{padding:8px;border-bottom:1px solid rgba(212,175,55,.12)}',
    '.jpdd-tbl td.num{text-align:right;white-space:nowrap}',
    '.jpdd-note{font-size:11px;line-height:1.75;color:var(--text-muted,#8a8a8a);margin-top:12px;',
    '  padding:10px 12px;border:1px dashed rgba(212,175,55,.3);border-radius:10px}'
  ].join('');

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function pct(v, d) { return (v == null || !isFinite(v)) ? '—' : v.toFixed(d == null ? 1 : d) + '%'; }
  function num(v, d) { return (v == null || !isFinite(v)) ? '—' : v.toFixed(d == null ? 2 : d); }
  function thDate(iso) {
    if (!iso) return '—';
    var m = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    var p = iso.split('-');
    return parseInt(p[2], 10) + ' ' + m[parseInt(p[1], 10) - 1] + ' ' + (parseInt(p[0], 10) + 543);
  }

  function box(label, value, sub, cmp, cls) {
    return '<div class="stat-box">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-val' + (cls ? ' ' + cls : '') + '">' + value + '</div>' +
      '<div class="stat-sub">' + sub + '</div>' +
      (cmp ? '<div class="jpdd-cmp">' + cmp + '</div>' : '') +
      '</div>';
  }

  function render(containerId, curve, bench) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var m = compute(curve);
    if (!m) { el.innerHTML = ''; return; }
    ensureCss();

    var bm = null, aligned = alignBench(bench, curve);
    if (aligned) bm = compute(aligned);
    var vs = function (mine, theirs, d, suffix) {
      if (!bm || theirs == null || !isFinite(theirs)) return '';
      return 'SPY ' + (suffix === '%' ? pct(theirs, d) : num(theirs, d));
    };

    var html = '<div class="jpdd-wrap">' +
      '<div class="jpdd-head"><span class="jpdd-kicker">Downside</span>' +
      '<span class="jpdd-title">สถิติฝั่งขาลง</span></div>' +
      '<p class="jpdd-lead">Max Drawdown บอกแค่จุดที่แย่ที่สุดจุดเดียวในประวัติทั้งหมด ' +
      'ตัวเลขชุดนี้บอกว่า<strong>ปกติแล้วพอร์ตจมลึกแค่ไหน</strong> และ<strong>จมบ่อยแค่ไหน</strong> ' +
      'ซึ่งเป็นสิ่งที่ต้องอยู่กับมันจริง ๆ ทุกวัน · คำนวณจากมูลค่าพอร์ตรายวัน ' + m.days.toLocaleString() + ' วัน</p>';

    html += '<div class="jpdd-grid stats-grid">';
    html += box('Max Drawdown', pct(m.maxDD), 'จุดที่แย่ที่สุด — เคยลึกสุดเท่านี้',
      vs(m.maxDD, bm && bm.maxDD, 1, '%'), 'text-red');
    html += box('Average Drawdown', pct(m.avgAll), 'เฉลี่ยทุกวัน — ต่ำกว่ายอดเดิมโดยทั่วไปเท่านี้',
      vs(m.avgAll, bm && bm.avgAll, 1, '%'), 'text-red');
    html += box('Avg DD ตอนใต้น้ำ', pct(m.avgUnder), 'เฉลี่ยเฉพาะวันที่ยังไม่ทำยอดใหม่',
      vs(m.avgUnder, bm && bm.avgUnder, 1, '%'), 'text-red');
    html += box('เวลาที่อยู่ใต้ยอด', pct(m.pctUnder, 0), 'สัดส่วนวันที่พอร์ตยังไม่กลับไปยอดเดิม',
      vs(m.pctUnder, bm && bm.pctUnder, 0, '%'));
    html += box('Ulcer Index', num(m.ulcer), 'รวมความลึกกับความนานเป็นตัวเดียว — ยิ่งต่ำยิ่งดี',
      vs(m.ulcer, bm && bm.ulcer, 2));
    html += box('Sortino Ratio', num(m.sortino), 'ผลตอบแทนต่อความผันผวนเฉพาะขาลง — ยิ่งสูงยิ่งดี',
      vs(m.sortino, bm && bm.sortino, 2), 'text-green');
    html += box('Calmar Ratio', num(m.calmar), 'ผลตอบแทนต่อปี ÷ Max Drawdown — ยิ่งสูงยิ่งดี',
      vs(m.calmar, bm && bm.calmar, 2), 'text-green');
    html += box('สถานะตอนนี้', pct(m.currentDD),
      m.currentDD < -0.05 ? 'ยังต่ำกว่ายอดเดิมอยู่' : 'อยู่ที่ยอดสูงสุด', '',
      m.currentDD < -0.05 ? 'text-red' : 'text-green');
    html += '</div>';

    html += '<div class="jpdd-grid stats-grid" style="margin-top:10px">';
    html += box('รอบที่ลึกเกิน 5%', m.nEp.toLocaleString(), 'จำนวนครั้งที่จมลึกเกิน 5%',
      bm ? 'SPY ' + bm.nEp : '');
    html += box('รอบที่ลึกเกิน 10%', m.deep10.toLocaleString(), 'จำนวนครั้งที่จมลึกเกิน 10%',
      bm ? 'SPY ' + bm.deep10 : '');
    html += box('รอบที่ลึกเกิน 20%', m.deep20.toLocaleString(), 'จำนวนครั้งที่จมลึกเกิน 20%',
      bm ? 'SPY ' + bm.deep20 : '');
    html += box('ความลึกเฉลี่ยต่อรอบ', pct(m.avgEp), 'เฉลี่ยของก้นแต่ละรอบที่ลึกเกิน 5%',
      bm ? 'SPY ' + pct(bm.avgEp) : '', 'text-red');
    html += box('จมนานที่สุด', m.longest.toLocaleString() + ' วัน', 'รอบที่ใช้เวลากลับสู่ยอดเดิมนานสุด',
      bm ? 'SPY ' + bm.longest + ' วัน' : '');
    html += '</div>';

    if (m.top.length) {
      html += '<table class="jpdd-tbl"><thead><tr>' +
        '<th>รอบที่ลึกที่สุด</th><th>เริ่มลง</th><th>ก้น</th>' +
        '<th class="num">ลึก</th><th class="num">กินเวลา</th></tr></thead><tbody>';
      m.top.forEach(function (e, i) {
        html += '<tr><td>อันดับ ' + (i + 1) + (e.recovered ? '' : ' · ยังไม่ฟื้น') + '</td>' +
          '<td>' + thDate(e.start) + '</td>' +
          '<td>' + thDate(e.trough) + '</td>' +
          '<td class="num text-red">-' + e.depth.toFixed(1) + '%</td>' +
          '<td class="num">' + e.days.toLocaleString() + ' วัน</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div class="jpdd-note">' +
      '<strong>วิธีอ่าน</strong> — สองกลยุทธ์อาจมี Max Drawdown เท่ากัน แต่ตัวที่ <strong>Average Drawdown</strong> ' +
      'และ <strong>Ulcer Index</strong> ต่ำกว่า คือตัวที่โผล่พ้นน้ำเร็วกว่าและถือได้สบายใจกว่า ' +
      'ส่วน <strong>Sortino</strong> ต่างจาก Sharpe ตรงที่ไม่นับความผันผวนขาขึ้นเป็นความเสี่ยง ' +
      '· Sortino คิดแบบรายปีที่เกณฑ์ 0% · ตัวเลขทั้งหมดมาจากการทดสอบย้อนหลัง ไม่ใช่การรับประกันผลในอนาคต' +
      '</div></div>';

    el.innerHTML = html;
  }

  window.JPDrawdown = { compute: compute, render: render, ddSeries: ddSeries, findEpisodes: findEpisodes };
})();
