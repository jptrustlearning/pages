// functions/data/[[path]].js
// Serves market-data CSVs from the R2 bucket (binding: MARKET_DATA) at
// app.jptrustlearning.com/data/<filename>, replacing raw.githubusercontent.com
// (which rate-limits per-IP -> 429). Responses are cached at the Cloudflare edge.
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const key = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');

  // allow only flat .csv keys; block path traversal
  if (!key || key.includes('..') || key.includes('/') || !key.endsWith('.csv')) {
    return new Response('Not found', { status: 404 });
  }

  // 1) edge cache hit -> return immediately (no R2 read)
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  if (!env.MARKET_DATA) {
    return new Response('R2 binding MARKET_DATA missing', { status: 500 });
  }

  // 2) miss -> read from R2
  const obj = await env.MARKET_DATA.get(key);
  if (!obj) return new Response('Not found in R2: ' + key, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('content-type', 'text/csv; charset=utf-8');
  headers.set('cache-control', 'public, max-age=600');
  headers.set('access-control-allow-origin', '*');

  const resp = new Response(obj.body, { headers });
  context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}
