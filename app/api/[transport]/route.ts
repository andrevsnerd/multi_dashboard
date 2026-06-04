import { createMcpHandler, withMcpAuth } from 'mcp-handler';

import { registerAllTools } from '@/lib/mcp/registry';
import { verifyMcpToken } from '@/lib/mcp/auth';

// Queries pesadas (vendas + estoque) podem demorar; alinhado às demais rotas.
export const maxDuration = 300;

/**
 * Servidor MCP remoto do multi-dashboard.
 *
 * Endpoint (Streamable HTTP):  /api/mcp
 * SSE está desabilitado (descontinuado pela spec do MCP).
 *
 * Auth: Bearer token (env MCP_API_TOKEN) via withMcpAuth. O cliente envia
 * `Authorization: Bearer <token>`.
 */
const handler = createMcpHandler(
  (server) => {
    registerAllTools(server);
  },
  {
    serverInfo: { name: 'multi-dashboard', version: '0.1.0' },
  },
  {
    basePath: '/api',
    maxDuration: 300,
    disableSse: true,
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
);

const authedHandler = withMcpAuth(handler, verifyMcpToken, { required: true });

/**
 * Permite passar o token via `?token=` (ou `?k=`) na URL, além do header
 * `Authorization: Bearer`. Necessário para conectores (Claude.ai/Desktop) que
 * só aceitam uma URL e não um header customizado, sem precisar de OAuth.
 * Quando presente e sem header de auth, normalizamos para o header esperado.
 * Use sempre HTTPS — o token vai na URL.
 */
function withUrlToken(
  next: (req: Request) => Promise<Response> | Response
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.headers.get('authorization')) return next(req);
    const urlToken =
      new URL(req.url).searchParams.get('token') || new URL(req.url).searchParams.get('k');
    if (!urlToken) return next(req);

    const headers = new Headers(req.headers);
    headers.set('authorization', `Bearer ${urlToken}`);

    // Reconstrói o Request preservando o corpo (POST). `new Request(req, {headers})`
    // não recarrega o body já em stream, então lemos o buffer e remontamos.
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const body = hasBody ? await req.arrayBuffer() : undefined;
    return next(new Request(req.url, { method: req.method, headers, body }));
  };
}

const exported = withUrlToken(authedHandler);

export { exported as GET, exported as POST, exported as DELETE };
