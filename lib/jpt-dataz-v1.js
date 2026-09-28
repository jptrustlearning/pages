/* lib/jpt-dataz-v1.js — ตัวโหลดข้อมูลตลาดร่วมของหน้ากลยุทธ์ (A192 · 29 ก.ย. 2026)
 *
 * กติกาจูน: โหลดจาก /dataz/ อย่างเดียว ไม่มีทางสำรอง /data/ — ถ้า /dataz/ ไม่ไหว = เปลี่ยนวิธี ไม่ถอยกลับ
 * ⚠️ ห้ามแก้ไฟล์นี้ทับ — จะเปลี่ยนพฤติกรรมให้ทำ lib/jpt-dataz-v2.js แล้วค่อยย้ายทีละหน้า (หน้าเก่ายังชี้ v1 ได้)
 *
 * สูตรเดียวกับ sp500-rolling-6m-momentum.html (A191 · จูนเทสผ่านบนมือถือ 29 ก.ย.):
 *   1) หาของในเครื่อง: caches.match(/dataz/<ไฟล์>) ค้นทุก cache (ของเรา jpt-dataz-v1 + สำเนาที่ sw.js เก็บเอง)
 *   2) มีของ → GET /dataz-meta/<ไฟล์> (no-store) → etag ตรง (ตัด W/ และ ") = ใช้ของในเครื่อง ไม่ดาวน์โหลดซ้ำ
 *   3) ไม่มี / ไม่ตรง / meta ล้ม → โหลด /dataz/ (timeout หัว + ลองซ้ำ 429/5xx/เน็ต · retry ใช้ cache:'reload')
 *   4) เนื้อไฟล์ต้องขึ้นต้นด้วย header CSV (กัน index.html 200) · error ทุกแบบขึ้นต้น "/dataz/" ⇒ หน้าแสดงป้าย "/dataz/ ERROR"
 *   5) commit() เก็บลง jpt-dataz-v1 หลังหน้าคำนวณผ่านแล้วเท่านั้น (ข้ามถ้าหน้าอยู่ใต้ sw.js เพราะ sw เก็บให้แล้ว)
 *   6) forget(urls) ลบของในเครื่องตอนโหลดพัง ⇒ กดลองใหม่ได้ของสด
 * ⚠️ sw.js ตอน activate รุ่นใหม่ลบทุก cache ที่ไม่ใช่ของมัน ⇒ bump sw.js = ลูกค้าโหลดใหม่ 1 รอบ (ไม่พัง)
 *
 * ใช้:  const t = await jptDataz.text('https://app.jptrustlearning.com/data/input_sp500_daily.csv', { label:'SP500', timeoutMs:30000, maxRetries:3 });
 *       jptDataz.commit();  jptDataz.forget();  (ไม่ใส่ = ลบทุกไฟล์ที่หน้านี้ขอ)  jptDataz.forget([url1, url2]);  jptDataz.fromDevice(url);  jptDataz.isDatazError(err)
 */
(function () {
  'use strict';
  if (window.jptDataz && window.jptDataz.version === 1) return;

  var CACHE = 'jpt-dataz-v1';
  var CSV_HEAD = /^﻿?\s*ticker,/i;
  var pending = [];
  var route = {};
  var touched = {};   // ทุกไฟล์ที่หน้านี้ขอผ่าน text() — forget() ไม่ใส่ argument = ลบของพวกนี้

  function toDataz(url) { return String(url).replace('/data/', '/dataz/'); }
  function normEtag(e) { return e ? String(e).replace(/^W\//, '').replace(/"/g, '').trim() : ''; }
  function looksCsv(t, re) { return (re || CSV_HEAD).test(String(t).slice(0, 200)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function resilientFetch(url, opts) {
    opts = opts || {};
    var label = opts.label || 'data';
    var timeoutMs = opts.timeoutMs || 25000;
    var maxRetries = (opts.maxRetries != null) ? opts.maxRetries : 3;
    var lastErr;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      let controller = new AbortController();
      let timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        var fopts = { signal: controller.signal };
        if (attempt > 0) fopts.cache = 'reload';   // retries bypass poisoned/partial cache + stale edge
        var res = await fetch(url, fopts);
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          var ra = parseInt(res.headers.get('retry-after') || '0', 10);
          var wait = ra > 0 ? ra * 1000 : Math.min(1000 * Math.pow(2, attempt), 8000) + Math.random() * 500;
          if (attempt < maxRetries) { await sleep(wait); continue; }
          throw new Error(label + ' HTTP ' + res.status);
        }
        if (!res.ok) throw new Error(label + ' HTTP ' + res.status);
        if (typeof opts.onResponse === 'function') { try { opts.onResponse(res); } catch (e) {} }
        return await res.text();
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (attempt < maxRetries) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), 8000) + Math.random() * 500);
          continue;
        }
      }
    }
    throw lastErr || new Error(label + ' failed');
  }

  async function metaEtag(fastUrl) {
    var ctrl = new AbortController();
    var tm = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      var r = await fetch(fastUrl.split('?')[0].replace('/dataz/', '/dataz-meta/'), { cache: 'no-store', signal: ctrl.signal });
      if (!r.ok) return '';
      var j = await r.json();
      return normEtag(j && j.etag);
    } catch (e) { return ''; } finally { clearTimeout(tm); }
  }

  async function text(url, opts) {
    opts = opts || {};
    var fastUrl = toDataz(url).split('?')[0];
    var re = opts.expect || CSV_HEAD;
    touched[fastUrl] = 1;
    // 1–2) ของในเครื่อง + ถามรุ่น
    try {
      if (window.caches) {
        var hit = await caches.match(fastUrl, { ignoreSearch: true, ignoreVary: true });
        var have = hit ? normEtag(hit.headers.get('x-jpt-etag') || hit.headers.get('etag')) : '';
        if (have) {
          var now = await metaEtag(fastUrl);
          if (now && now === have) {
            var ct = await hit.text();
            if (looksCsv(ct, re)) { route[url] = 'dataz-cache'; return ct; }
          }
        }
      }
    } catch (e) { /* อ่านของในเครื่องไม่ได้ → โหลดใหม่ */ }
    // 3) /dataz/ อย่างเดียว
    var t, etag = '';
    try {
      t = await resilientFetch(fastUrl, {
        label: opts.label, timeoutMs: opts.timeoutMs, maxRetries: opts.maxRetries,
        onResponse: function (r) { etag = normEtag(r.headers.get('etag')); }
      });
    } catch (e) {
      throw new Error('/dataz/ ' + ((e && e.message) || String(e)) + ' · ' + fastUrl);
    }
    // 4) ต้องเป็น CSV จริง (Pages ไม่มี 404.html ⇒ path ผิดได้ index.html 200)
    if (!looksCsv(t, re)) throw new Error('/dataz/ ได้ข้อมูลที่ไม่ใช่ CSV (อาจเป็นหน้า HTML) · ' + fastUrl);
    route[url] = 'dataz';
    if (etag) pending.push({ key: fastUrl, text: t, etag: etag });
    return t;
  }

  function commit() {
    var items = pending; pending = [];
    try {
      if (!window.caches || !items.length) return;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) return;
      caches.open(CACHE).then(function (c) {
        return Promise.all(items.map(function (it) {
          return c.put(it.key, new Response(it.text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-jpt-etag': it.etag } }));
        }));
      }).catch(function () {});
    } catch (e) {}
  }

  function forget(urls) {
    pending = [];
    try {
      if (!window.caches) return;
      var keys = urls ? urls.filter(Boolean).map(function (u) { return toDataz(u).split('?')[0]; }) : Object.keys(touched);
      if (!keys.length) return;
      caches.keys().then(function (names) {
        return Promise.all(names.map(function (n) {
          return caches.open(n).then(function (c) {
            return Promise.all(keys.map(function (k) { return c.delete(k, { ignoreSearch: true, ignoreVary: true }); }));
          });
        }));
      }).catch(function () {});
    } catch (e) {}
  }

  // สำหรับหน้าที่เขียนแบบ fetch(url) → res.ok → res.text(): แทนแค่ตัว fetch ได้เลย (ไม่ copy ข้อความซ้ำ)
  // พังแล้ว throw เสมอ (ไม่มี .catch(() => null) แบบเดิม) ⇒ หน้าไปเข้า catch แล้วขึ้น "/dataz/ ERROR"
  async function fetchLike(url, opts) {
    var t = await text(url, opts);
    return { ok: true, status: 200, url: url, text: function () { return Promise.resolve(t); } };
  }

  // นับว่ามีอย่างน้อย n บรรทัด โดยไม่ต้อง split ทั้งไฟล์ (กันไฟล์โดนตัดครึ่ง/หน้า error)
  function enoughLines(t, n) {
    var i = -1, c = 0; t = String(t);
    while (c < n) { i = t.indexOf('\n', i + 1); if (i === -1) return false; c++; }
    return true;
  }

  window.jptDataz = {
    version: 1,
    text: text,
    fetchLike: fetchLike,
    enoughLines: enoughLines,
    commit: commit,
    forget: forget,
    route: route,
    fromDevice: function (url) { return route[url] === 'dataz-cache'; },
    isDatazError: function (err) { return !!(err && /^\/dataz\//.test(err.message || '')); }
  };
})();
