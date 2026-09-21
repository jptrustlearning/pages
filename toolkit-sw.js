/* toolkit-sw.js — service worker ของแอป Tool&Kit (A154)
   scope = /jptrust-toolkit เท่านั้น · ไม่เกี่ยวกับ sw.js ของแอปสมาชิก (scope /)
   หน้าที่มีอย่างเดียว: ถ้าเปิดแอปตอนไม่มีเน็ต ให้ขึ้นหน้าที่โหลดไว้ครั้งล่าสุดแทนหน้าจอขาว
   ไม่แตะคำขออื่นเลย (CSV · JSON · TradingView · ฟอนต์) — ข้อมูลทุกการ์ดยังดึงสดเหมือนเดิม
   ปิดฉุกเฉิน: แทนไฟล์นี้ด้วย self.registration.unregister() แล้ว push */
const CACHE = 'jpt-toolkit-v1';
const SHELL = '/jptrust-toolkit';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('jpt-toolkit-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      /* เก็บเฉพาะหน้าที่ได้มาตรงๆ — response ที่ผ่าน redirect ห้ามเอาไปตอบ navigation */
      if (res.ok && !res.redirected && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(SHELL, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(SHELL);
      if (hit) return hit;
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Tool&amp;Kit</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;' +
        'background:#F5F3EF;color:#1F1B1C;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
        '<div><p style="font-size:17px;font-weight:600;margin:0 0 6px">ยังไม่ได้เชื่อมต่ออินเทอร์เน็ต</p>' +
        '<p style="font-size:14px;color:#8B847E;margin:0">ต่อเน็ตแล้วเปิดแอปใหม่อีกครั้ง</p></div>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});
