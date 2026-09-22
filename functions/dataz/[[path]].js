// functions/dataz/[[path]].js  (A173 · ทดลองเฉพาะหน้า Washout Sniper)
// สำเนาของ functions/data/[[path]].js ต่างกันจุดเดียว: content-type = text/plain
// เพื่อให้ Cloudflare บีบอัด (brotli/gzip) ตอนส่ง — text/csv ไม่ถูกบีบอัดอัตโนมัติ
// ไฟล์ 68.8 MB วิ่งผ่านเน็ตจริงเหลือราว 22 MB · เนื้อข้อมูลไม่เปลี่ยน (อ่าน R2 ก้อนเดียวกัน)
// เส้นทาง /data/ เดิมไม่ถูกแตะ — หน้าอื่นทุกหน้ายังใช้ /data/ ตามเดิม
// ย้อนกลับ: ลบโฟลเดอร์ functions/dataz/ ทั้งโฟลเดอร์ (หน้า Sniper ตกกลับ /data/ เอง)
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const key = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');

  if (!key || key.includes('..') || !key.endsWith('.csv')) {
    return new Response('Not found', { status: 404 });
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  if (!env.MARKET_DATA) {
    return new Response('R2 binding MARKET_DATA missing', { status: 500 });
  }

  const obj = await env.MARKET_DATA.get(key);
  if (!obj) return new Response('Not found in R2: ' + key, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('content-type', 'text/plain; charset=utf-8');   // ← จุดเดียวที่ต่างจาก /data/
  headers.set('cache-control', 'public, max-age=600');
  headers.set('access-control-allow-origin', '*');
  headers.set('x-jpt-route', 'dataz');

  const resp = new Response(obj.body, { headers });
  context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}
