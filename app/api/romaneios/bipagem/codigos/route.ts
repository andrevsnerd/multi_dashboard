import { NextResponse } from "next/server";

import { query } from "@/lib/db/connection";

export const maxDuration = 30;

/**
 * Todos os códigos de barra dos produtos de um romaneio, numa consulta só.
 *
 * A conferência por bipagem resolve cada leitura NO NAVEGADOR contra este mapa:
 * o gerente bipa peça atrás de peça e não pode esperar uma ida ao banco por
 * bipe (nem perder a peça se a rede piscar). Só o código que não está aqui —
 * peça de fora do romaneio ou código inexistente — vai ao /bipar para dizer o quê.
 *
 * PRODUTOS_BARRA.TAMANHO é a posição da grade (P/M/G): é o que deixa o bipe
 * cair no tamanho certo.
 *
 * POST { produtos: string[] } → { codigos: [{ codigo, produto, cor, tamanho }] }
 */

function lit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { produtos?: unknown };
    const produtos = [
      ...new Set(
        (Array.isArray(body.produtos) ? body.produtos : [])
          .map((p) => String(p ?? "").trim())
          .filter((p) => p.length > 0 && p.length <= 60)
      ),
    ];
    if (produtos.length === 0) return NextResponse.json({ codigos: [] });

    const codigos: Array<{ codigo: string; produto: string; cor: string; tamanho: number | null }> = [];
    for (let i = 0; i < produtos.length; i += 500) {
      const fatia = produtos.slice(i, i + 500);
      const rows = await query<{ CODIGO: string; PRODUTO: string; COR: string | null; TAMANHO: number | null }>(`
        SELECT
          LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) AS CODIGO,
          LTRIM(RTRIM(CAST(pb.PRODUTO AS VARCHAR(50))))       AS PRODUTO,
          LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20))))   AS COR,
          TRY_CONVERT(INT, pb.TAMANHO)                        AS TAMANHO
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CAST(pb.PRODUTO AS VARCHAR(50)))) IN (${fatia.map(lit).join(",")})
          AND LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) <> ''
      `);
      for (const r of rows) {
        const tamanho = Number(r.TAMANHO);
        codigos.push({
          codigo: (r.CODIGO || "").trim(),
          produto: (r.PRODUTO || "").trim(),
          cor: (r.COR || "").trim(),
          tamanho: Number.isInteger(tamanho) && tamanho >= 1 ? tamanho : null,
        });
      }
    }
    return NextResponse.json({ codigos });
  } catch (err) {
    console.error("POST romaneios/bipagem/codigos:", err);
    return NextResponse.json({ error: "Erro ao carregar os códigos de barra do romaneio." }, { status: 500 });
  }
}
