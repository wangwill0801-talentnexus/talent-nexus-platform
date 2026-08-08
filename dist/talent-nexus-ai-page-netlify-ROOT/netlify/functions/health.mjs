// ai-page-netlify/netlify/functions/health.mjs
import { handleCors } from '../../lib/cors.mjs';
import { authStatus } from '../../lib/auth.mjs';

export const handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': event.headers.origin || '*' },
    body: JSON.stringify({
      ok: true,
      service: 'Talent Nexus Resume AI',
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      mockMode: process.env.AI_MOCK_MODE === 'true',
      auth: authStatus()
    })
  };
};
