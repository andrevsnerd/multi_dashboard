import 'server-only';

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * Verificação de token Bearer para o servidor MCP.
 *
 * Fase 1: token estático compartilhado (env `MCP_API_TOKEN`). O cliente MCP
 * (Claude Code / API / conector) envia `Authorization: Bearer <token>`.
 *
 * Fail-closed: se `MCP_API_TOKEN` não estiver configurado, NADA é autorizado.
 * Em fase posterior trocamos por OAuth 2.1 (exigido pelo conector web do
 * Claude.ai) e amarramos o token ao usuário/empresas permitidas do users-store.
 */
export async function verifyMcpToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  const expected = (process.env.MCP_API_TOKEN || '').trim();
  if (!expected) {
    console.error('[mcp] MCP_API_TOKEN não configurado — todas as requisições serão negadas.');
    return undefined;
  }

  if (!bearerToken || bearerToken.trim() !== expected) {
    return undefined;
  }

  return {
    token: bearerToken,
    clientId: 'multi-dashboard-mcp',
    scopes: ['read'],
  };
}
