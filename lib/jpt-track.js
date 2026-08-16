/* ============================================================================
   jpt-track.js — ตัวเก็บสถิติกลางของหน้า Tool & Kit
   ใส่ในหน้าไหนก็ได้ด้วยบรรทัดเดียว (วางก่อน </body>):

     <script defer src="/lib/jpt-track.js" data-page="gold-momentum-6m"></script>

   data-page ต้องตรงกับรายชื่อในตาราง page_events_pages ฝั่ง Supabase
   ไม่งั้น RPC จะทิ้ง event เงียบๆ (กันคนยิงมั่ว)

   เก็บอะไรบ้าง
     page_view   ครั้งเดียวตอนโหลด
     click       ทุกปุ่ม/ลิงก์ — เก็บ "ข้อความบนปุ่ม" ไม่ใช่ค่าที่ผู้ใช้พิมพ์
     download    ลิงก์ที่มี attribute download หรือลงท้ายด้วยไฟล์ (.ex5 .zip .pdf …)
     scroll_50 / scroll_90
     session_end เวลาที่แท็บ "เปิดอยู่จริง" (สลับแท็บทิ้งไว้ไม่นับ)

   ไม่เก็บ: ค่าใน input/textarea/select, ตัวเลขที่ผู้ใช้กรอก, อีเมล, ตัวตนใดๆ
            visitor_id เป็น UUID สุ่มใน localStorage ของเครื่องนั้น ไม่ผูกกับบัญชี

   ยิงเองจากโค้ดหน้าอื่นได้: window.JPTtrack('tool_open','ชื่อเครื่องมือ')
   ปิดการเก็บบางส่วนของหน้า: ใส่ data-no-track บน element ครอบ
   ตั้งป้ายเอง:               ใส่ data-track="ชื่อที่อยากเห็นในรายงาน"
   ============================================================================ */
(function () {
  'use strict';

  var SB  = 'https://rcdukwwcbyryauhqlzmx.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZHVrd3djYnlyeWF1aHFsem14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MTY0MDAsImV4cCI6MjA4NTQ5MjQwMH0.rprPmudJYyb6dyhXb9Z9GrtQWEeIX99A2Wrj55PvS54';

  var MAX_EVENTS   = 250;   // เพดานต่อ session ฝั่ง client (ฝั่ง DB กันอีกชั้นที่ 400/ชม.)
  var DEDUPE_MS    = 700;   // คลิกซ้ำป้ายเดิมภายในเวลานี้ นับครั้งเดียว
  var LABEL_MAX    = 80;

  /* ---------- หา data-page จาก tag ของตัวเอง ---------- */
  var me = document.currentScript || (function () {
    var s = document.querySelectorAll('script[data-page]');
    return s.length ? s[s.length - 1] : null;
  })();
  var PAGE = me && me.getAttribute('data-page');
  if (!PAGE) return;                      // ไม่ระบุหน้า = ไม่ทำงาน

  /* ---------- id ผู้ใช้/รอบการเข้า ---------- */
  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = (c === 'x') ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }
  var vid, sid;
  try {
    vid = localStorage.getItem('jpt_vid');  if (!vid) { vid = uuid(); localStorage.setItem('jpt_vid', vid); }
    sid = sessionStorage.getItem('jpt_sid'); if (!sid) { sid = uuid(); sessionStorage.setItem('jpt_sid', sid); }
  } catch (e) { return; }                 // ปิดคุกกี้/โหมดส่วนตัว = ไม่เก็บ

  /* ---------- บริบท ---------- */
  var ua = navigator.userAgent || '';
  var device = /iPad|Tablet/i.test(ua) ? 'tablet'
             : (/Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile' : 'desktop');
  var refHost = 'direct';
  try {
    if (document.referrer) {
      var rh = new URL(document.referrer).hostname;
      if (rh && rh !== location.hostname) refHost = rh;
    }
  } catch (e) {}
  var utm = null;
  try { utm = new URLSearchParams(location.search).get('utm_source') || null; } catch (e) {}

  /* ---------- ตัวส่ง ---------- */
  var count = 0;
  function send(type, detail, dwell, keep) {
    if (count >= MAX_EVENTS) return;
    count++;
    try {
      fetch(SB + '/rest/v1/rpc/track_page_event', {
        method: 'POST', keepalive: !!keep, mode: 'cors',
        headers: { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY },
        body: JSON.stringify({
          p_page: PAGE, p_visitor: vid, p_session: sid, p_type: type,
          p_detail: detail || null, p_referrer_host: refHost, p_utm_source: utm,
          p_device: device, p_dwell_sec: (dwell || null)
        })
      }).catch(function () {});
    } catch (e) {}
  }
  window.JPTtrack = function (type, detail) { send(type, detail); };

  send('page_view');

  /* ---------- เวลาที่อยู่หน้านี้จริง ---------- */
  var acc = 0, t0 = Date.now(),
      visible = (document.visibilityState !== 'hidden'), lastSent = -99;
  function tick() { if (visible) acc += Date.now() - t0; t0 = Date.now(); }
  function flush() {
    tick();
    var s = Math.round(acc / 1000);
    if (s - lastSent < 3) return;
    lastSent = s;
    send('session_end', null, s, true);
  }
  document.addEventListener('visibilitychange', function () {
    tick(); visible = (document.visibilityState !== 'hidden');
    if (!visible) flush();
  });
  window.addEventListener('pagehide', flush);

  /* ---------- scroll ---------- */
  var hit50 = false, hit90 = false;
  window.addEventListener('scroll', function () {
    if (hit50 && hit90) return;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 200) return;
    var p = window.scrollY / h;
    if (!hit50 && p >= 0.5) { hit50 = true; send('scroll_50'); }
    if (!hit90 && p >= 0.9) { hit90 = true; send('scroll_90'); }
  }, { passive: true });

  /* ---------- คลิก ---------- */
  var FILE_RE = /\.(ex5|ex4|mq5|mq4|zip|rar|pdf|csv|xlsx|xls|png|jpg)(\?|$)/i;
  var SKIP_TAG = { INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1 };

  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX); }

  function labelOf(el) {
    var t = el.getAttribute('data-track');
    if (t) return clean(t);

    // ข้อความบนปุ่ม — ตัดข้อความของ input ที่ผู้ใช้พิมพ์ออกเสมอ
    var txt = '';
    try {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('input,textarea,select'), function (n) {
        n.parentNode && n.parentNode.removeChild(n);
      });
      txt = clean(c.innerText || c.textContent || '');
    } catch (e) {}

    if (!txt) txt = clean(el.getAttribute('aria-label') || el.getAttribute('title') || '');
    if (!txt) {
      var img = el.querySelector && el.querySelector('img[alt]');
      if (img) txt = clean(img.getAttribute('alt'));
    }
    if (!txt && el.id) txt = '#' + el.id;
    if (!txt && typeof el.className === 'string' && el.className)
      txt = '.' + el.className.split(/\s+/)[0];
    return txt || el.tagName.toLowerCase();
  }

  var lastLabel = '', lastTs = 0;

  document.addEventListener('click', function (ev) {
    try {
      var src = ev.target;
      if (!src || src.nodeType !== 1) return;
      if (SKIP_TAG[src.tagName]) return;
      if (src.closest('[data-no-track]')) return;

      var el = src.closest('a,button,[role="button"],[data-track]');
      if (!el) return;

      var isA   = el.tagName === 'A';
      var href  = isA ? (el.getAttribute('href') || '') : '';
      var lab   = labelOf(el);
      var type  = 'click';

      if (isA && href && href !== '#') {
        var file = '';
        try { file = new URL(el.href, location.href).pathname.split('/').pop() || ''; } catch (e) {}
        if (el.hasAttribute('download') || FILE_RE.test(href)) type = 'download';
        if (file) lab = lab + ' → ' + decodeURIComponent(file).slice(0, 48);
      }

      lab = (type === 'download' ? '⬇ ' : (isA ? '🔗 ' : '▸ ')) + lab;
      lab = lab.slice(0, 150);

      var now = Date.now();
      if (lab === lastLabel && now - lastTs < DEDUPE_MS) return;
      lastLabel = lab; lastTs = now;

      send(type, lab, null, type === 'download');
    } catch (e) {}
  }, true);
})();
