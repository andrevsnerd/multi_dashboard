"use client";

/**
 * Cache em sessionStorage da lista de produtos por chave do filtro de giro.
 *
 * Escrito pela tela de Controle de Estoque (onde o giro é calculado) e lido pela
 * tela de Estoque Detalhado, que reaproveita a lista para pular a CTE pesada de
 * giro no servidor.
 *
 * A lista reflete estoque/vendas no momento do cálculo, então tem TTL curto:
 * passado o TTL, o consumidor recebe `null` e refaz a consulta completa (caminho
 * correto e fresco). Mexe APENAS na chave `giroProdutosPorChave_*` — nunca toca
 * em nada salvo (compras salvas/trânsito vivem no servidor; carrinho e sessão
 * ficam em outras chaves).
 */

const TTL_MS = 5 * 60 * 1000; // 5 min — alinhado ao cache de giro do servidor

type GiroSessionPayload = {
  ts: number;
  data: Record<string, string[]>;
};

function buildKey(companyKey: string, giro: string | number): string {
  return `giroProdutosPorChave_${companyKey}_${giro}`;
}

export function setGiroSessionCache(
  companyKey: string,
  giro: string | number,
  data: Record<string, string[]>,
): void {
  try {
    const payload: GiroSessionPayload = { ts: Date.now(), data };
    sessionStorage.setItem(buildKey(companyKey, giro), JSON.stringify(payload));
  } catch {
    // sessionStorage pode falhar (modo privado, quota) — ignorar
  }
}

export function getGiroSessionCache(
  companyKey: string,
  giro: string | number,
): Record<string, string[]> | null {
  try {
    const key = buildKey(companyKey, giro);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;

    // Formato novo (com TTL)
    if (
      parsed &&
      typeof parsed === "object" &&
      "ts" in parsed &&
      "data" in parsed
    ) {
      const payload = parsed as GiroSessionPayload;
      if (Date.now() - payload.ts > TTL_MS) {
        sessionStorage.removeItem(key);
        return null;
      }
      return payload.data ?? null;
    }

    // Formato antigo (sem TTL), gravado antes desta mudança: descartar para
    // forçar uma consulta fresca uma única vez.
    sessionStorage.removeItem(key);
    return null;
  } catch {
    return null;
  }
}
