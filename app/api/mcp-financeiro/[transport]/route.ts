import { createMcpHandler, withMcpAuth } from 'mcp-handler';

import { verifyMcpFinanceiroToken } from '@/lib/mcp/auth';
import { registerFinanceiroTools } from '@/lib/mcp/financeiro';
import { withUrlToken } from '@/lib/mcp/url-token';

export const maxDuration = 120;

/**
 * Servidor MCP do FINANCEIRO — conector separado do MCP geral (/api/mcp).
 *
 * Endpoint (Streamable HTTP):  /api/mcp-financeiro/mcp
 *
 * Auth: Bearer token PRÓPRIO (env MCP_FINANCEIRO_TOKEN), também aceito em `?token=`.
 * O token do MCP geral não abre este servidor.
 */
const handler = createMcpHandler(
  (server) => {
    registerFinanceiroTools(server);
  },
  {
    serverInfo: { name: 'multi-dashboard-financeiro', version: '0.1.0' },
  },
  {
    basePath: '/api/mcp-financeiro',
    maxDuration: 120,
    disableSse: true,
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
);

const exported = withUrlToken(withMcpAuth(handler, verifyMcpFinanceiroToken, { required: true }));

export { exported as GET, exported as POST, exported as DELETE };
