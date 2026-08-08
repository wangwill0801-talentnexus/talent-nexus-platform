// ai-page-netlify/lib/cors.mjs
// CORS handling. Production should set ALLOWED_ORIGINS to a comma-separated
// list of exact origins. Broad '*' is TEST ONLY.
const TEST_OPEN_CORS = true; // flip to false in production; use ALLOWED_ORIGINS then.

export function corsHeaders(origin, methods = 'GET,POST,OPTIONS') {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  let allowOrigin = 'null';
  if (allowed.length && origin && allowed.includes(origin)) {
    allowOrigin = origin;
  } else if (TEST_OPEN_CORS && origin) {
    allowOrigin = origin; // TEST ONLY: reflect any origin
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

export function handleCors(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(event.headers.origin),
      body: ''
    };
  }
  return null;
}
