import 'server-only';

import { createHash, timingSafeEqual } from 'crypto';

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

/**
 * Token do MCP do FINANCEIRO (/api/mcp-financeiro/mcp), separado do MCP geral: ali saem
 * folha, retiradas dos sócios, fornecedores e resultado, então só recebe esse token quem
 * pode ver o Controle Financeiro. Fail-closed como o outro: sem `MCP_FINANCEIRO_TOKEN`,
 * nada é autorizado — e o token do MCP geral NÃO abre este.
 */
export async function verifyMcpFinanceiroToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  const expected = (process.env.MCP_FINANCEIRO_TOKEN || '').trim();
  if (!expected) {
    console.error('[mcp-financeiro] MCP_FINANCEIRO_TOKEN não configurado — todas as requisições serão negadas.');
    return undefined;
  }

  if (!bearerToken || bearerToken.trim() !== expected) {
    return undefined;
  }

  return {
    token: bearerToken,
    clientId: 'multi-dashboard-mcp-financeiro',
    scopes: ['read'],
  };
}

/**
 * Token do MCP de PREÇOS (/api/mcp-precos/mcp). Diferente dos outros dois, este GRAVA
 * preço no Linx, então o token não é compartilhado: cada pessoa tem o seu, amarrado a um
 * usuário do /admin.
 *
 *   MCP_PRECOS_TOKENS="andre=<token>;maria=<token>"
 *
 * Aqui só se descobre QUEM é. O que a pessoa pode fazer é conferido a cada chamada
 * (lib/mcp/precos.ts) contra o cadastro atual: tirar o "Programar Preços" do usuário no
 * /admin, rebaixar a função ou excluí-lo corta o acesso na hora, sem mexer no token.
 * Fail-closed: sem a env, nada é autorizado.
 */
export async function verifyMcpPrecosToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  const recebido = (bearerToken || '').trim();
  if (!recebido) return undefined;

  const username = usuarioDoTokenPrecos(recebido);
  if (!username) return undefined;

  return {
    token: recebido,
    clientId: `multi-dashboard-mcp-precos:${username}`,
    scopes: ['read', 'write'],
    extra: { username },
  };
}

function digest(valor: string): Buffer {
  return createHash('sha256').update(valor).digest();
}

/** Usuário dono do token, ou null. Comparação em tempo constante. */
function usuarioDoTokenPrecos(token: string): string | null {
  const bruto = (process.env.MCP_PRECOS_TOKENS || '').trim();
  if (!bruto) {
    console.error('[mcp-precos] MCP_PRECOS_TOKENS não configurado — todas as requisições serão negadas.');
    return null;
  }

  const alvo = digest(token);
  let dono: string | null = null;
  for (const par of bruto.split(/[;\n,]+/)) {
    const i = par.indexOf('=');
    if (i <= 0) continue;
    const usuario = par.slice(0, i).trim();
    const segredo = par.slice(i + 1).trim();
    // Token curto demais é chute fácil: ignora a entrada inteira.
    if (!usuario || segredo.length < 24) continue;
    if (timingSafeEqual(digest(segredo), alvo) && !dono) dono = usuario;
  }
  return dono;
}
