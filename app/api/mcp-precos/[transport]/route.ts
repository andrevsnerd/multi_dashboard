import { createMcpHandler, withMcpAuth } from 'mcp-handler';

import { verifyMcpPrecosToken } from '@/lib/mcp/auth';
import { registerPrecosTools } from '@/lib/mcp/precos';
import { withUrlToken } from '@/lib/mcp/url-token';

export const maxDuration = 300;

/**
 * Servidor MCP de PREÇOS — o Programar Preços sem a tela (montar, agendar, aplicar,
 * reverter). Conector separado do MCP geral (/api/mcp), que é só leitura.
 *
 * Endpoint (Streamable HTTP):  /api/mcp-precos/mcp
 *
 * Auth: token POR PESSOA (env MCP_PRECOS_TOKENS="usuario=token;..."), também aceito em
 * `?token=`. A permissão é conferida a cada chamada contra o usuário no /admin.
 */
const handler = createMcpHandler(
  (server) => {
    registerPrecosTools(server);
  },
  {
    serverInfo: { name: 'multi-dashboard-precos', version: '0.1.0' },
  },
  {
    basePath: '/api/mcp-precos',
    maxDuration: 300,
    disableSse: true,
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
);

const exported = withUrlToken(withMcpAuth(handler, verifyMcpPrecosToken, { required: true }));

export { exported as GET, exported as POST, exported as DELETE };
