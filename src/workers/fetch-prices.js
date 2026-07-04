/**
 * src/workers/fetch-prices.js
 *
 * Cloudflare Worker — proxy to Apify Checkers scraper.
 * Receives POST with pantryItem, calls Apify actor, returns products.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
  });
}

async function handleRefreshPrices(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid-json' }, 400);
  }

  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse({ error: 'missing-ids' }, 400);
  }

  if (!env.PRICE_SERVER_URL) {
    return jsonResponse({ error: 'price-server-unavailable' }, 502);
  }

  try {
    const url = `${env.PRICE_SERVER_URL}/api/prices?ids=${encodeURIComponent(ids.join(','))}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`price server returned ${resp.status}`);
    const data = await resp.json();
    return jsonResponse(data, 200);
  } catch (err) {
    console.error('[Worker] refresh-prices error:', err.message);
    return jsonResponse({ error: 'price-server-unavailable' }, 502);
  }
}

export default {
  async fetch(request, env, context) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return textResponse('Method not allowed', 405);
    }

    const { pathname } = new URL(request.url);
    if (pathname === '/api/refresh-prices') {
      return handleRefreshPrices(request, env);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return textResponse('Invalid JSON', 400);
    }

    const { pantryItem } = body;
    if (!pantryItem || !pantryItem.canonicalName) {
      return textResponse('Missing pantryItem.canonicalName', 400);
    }

    const apiKey = env.APIFY_KEY;
    if (!apiKey) {
      return textResponse('Apify API key not configured', 500);
    }

    try {
      const hint = pantryItem.searchHints?.[0] ?? '';
      const searchTerm = hint
        ? `${pantryItem.canonicalName} ${hint}`
        : pantryItem.canonicalName;
      const maxItems = pantryItem.priceOptionCount ?? 5;
      const searchUrl = `https://www.checkers.co.za/search?Search=${encodeURIComponent(searchTerm)}`;

      console.log(`[Worker] Apify fetch: "${searchTerm}" (maxItems: ${maxItems})`);
      console.log(`[Worker] Search URL: ${searchUrl}`);
      console.log(`[Worker] Apify actor: tXYgrsQcGx4ReKqdW`);

      const apifyUrl = new URL(
        'https://api.apify.com/v2/acts/tXYgrsQcGx4ReKqdW/run-sync-get-dataset-items'
      );
      apifyUrl.searchParams.append('token', apiKey);
      apifyUrl.searchParams.append('timeout', '20');
      apifyUrl.searchParams.append('memory', '4096');

      const resp = await fetch(apifyUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxItems, startUrl: searchUrl }),
      });

      console.log(`[Worker] Apify response status: ${resp.status}`);

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`[Worker] Apify error ${resp.status}: ${errorText}`);
        return textResponse(`Apify returned ${resp.status}: ${errorText}`, resp.status);
      }

      const products = await resp.json();
      console.log(`[Worker] Apify returned ${Array.isArray(products) ? products.length : 0} products`);

      if (!Array.isArray(products)) {
        return jsonResponse([], 200);
      }

      return jsonResponse(products, 200);
    } catch (err) {
      console.error('[Worker] fetch-prices error:', err.message);
      return textResponse(`Error: ${err.message}`, 500);
    }
  },
};
