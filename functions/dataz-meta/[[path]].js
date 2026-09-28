// functions/dataz-meta/[[path]].js  (A191 · ใช้คู่กับ /dataz/ — ไม่แตะ functions/dataz/ และ functions/data/)
// ตอบ "ป้ายรุ่น" ของไฟล์ใน R2 เป็น JSON เล็กๆ { key, etag, size, uploaded } โดยไม่ส่งเนื้อไฟล์
// หน้ากลยุทธ์ที่เก็บไฟล์ไว้ในเครื่องจะถามที่นี่ก่อน: etag ตรงกับของในเครื่อง = ไม่ต้องดาวน์โหลด 22.9 MB ซ้ำ
// ไม่ใช้ edge cache (ป้ายรุ่นต้องสดเสมอ) · R2 head() อ่านแค่ metadata
// ย้อนกลับ: หน้าที่ใช้กลับไป backup ของหน้านั้น (ไฟล์นี้อยู่เฉยๆ ได้ ไม่มีใครเรียก = ไม่มีผล)
export async function onRequestGet(context) {
  const { env, params } = context;
  const key = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');

  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-jpt-route': 'dataz-meta'
  };

  if (!key || key.includes('..') || !key.endsWith('.csv')) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
  }
  if (!env.MARKET_DATA) {
    return new Response(JSON.stringify({ error: 'R2 binding MARKET_DATA missing' }), { status: 500, headers });
  }

  const head = await env.MARKET_DATA.head(key);
  if (!head) {
    return new Response(JSON.stringify({ error: 'not found in R2', key }), { status: 404, headers });
  }

  return new Response(JSON.stringify({
    key,
    etag: head.httpEtag,
    size: head.size,
    uploaded: head.uploaded ? new Date(head.uploaded).toISOString() : null
  }), { headers });
}
