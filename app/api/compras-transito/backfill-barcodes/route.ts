import { NextResponse } from "next/server";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import { fillMissingBarcodes, type BarcodeItemLike } from "@/lib/server/compra-transito-barcodes";

export const maxDuration = 300;

/**
 * Backfill de código de barras nas compras em trânsito já salvas.
 *
 * SEGURO POR DESENHO:
 *  - lê os itens CRUS do banco (sem normalizar) e só ADICIONA `codigoBarra` onde falta;
 *  - grava APENAS a coluna `items` (não toca em título, status, datas, created_by);
 *  - compras sem item a preencher não são tocadas;
 *  - `dryRun` é o padrão: só grava quando o body traz `confirm: true`.
 *
 * Uso:
 *   curl -X POST .../api/compras-transito/backfill-barcodes -H 'content-type: application/json' -d '{}'                 # prévia (dry-run)
 *   curl -X POST .../api/compras-transito/backfill-barcodes -H 'content-type: application/json' -d '{"confirm":true}'   # aplica
 *   (opcional) {"company":"scarfme"} para restringir a uma empresa.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: boolean; company?: string };
    const aplicar = body.confirm === true;
    const companyFilter = typeof body.company === "string" && body.company.trim() ? body.company.trim() : null;

    if (!hasPostgres()) {
      return NextResponse.json({ error: "Neon não configurado." }, { status: 400 });
    }

    const sql = getNeonSql();
    const rows = (companyFilter
      ? await sql`SELECT id, company_key, items FROM compras_transito WHERE company_key = ${companyFilter}`
      : await sql`SELECT id, company_key, items FROM compras_transito`) as Array<{
      id: string;
      company_key: string;
      items: unknown;
    }>;

    let comprasVarridas = 0;
    let comprasAlteradas = 0;
    let itensPreenchidos = 0;
    let itensAindaSemBarcode = 0;
    const detalhe: Array<{ id: string; company: string; preenchidos: number; semBarcode: number }> = [];

    for (const row of rows) {
      comprasVarridas += 1;
      const rawItems = Array.isArray(row.items) ? (row.items as BarcodeItemLike[]) : [];
      if (rawItems.length === 0) continue;

      const { items: filledItems, filled } = await fillMissingBarcodes(rawItems);

      // Itens que continuam sem barcode (produto sem cadastro em PRODUTOS_BARRA, etc.).
      const semBarcode = filledItems.filter(
        (it) => String(it.produto ?? "").trim() && !(it.codigoBarra && String(it.codigoBarra).trim())
      ).length;
      itensAindaSemBarcode += semBarcode;

      if (filled === 0) continue;

      comprasAlteradas += 1;
      itensPreenchidos += filled;
      detalhe.push({ id: row.id, company: row.company_key, preenchidos: filled, semBarcode });

      if (aplicar) {
        // Grava SÓ a coluna items. Não mexe em updated_at/confirmed_at/status/title/created_by.
        await sql`UPDATE compras_transito SET items = ${JSON.stringify(filledItems)}::jsonb WHERE id = ${row.id}`;
      }
    }

    return NextResponse.json({
      success: true,
      aplicado: aplicar,
      dryRun: !aplicar,
      escopo: companyFilter ?? "todas as empresas",
      comprasVarridas,
      comprasAlteradas,
      itensPreenchidos,
      itensAindaSemBarcode,
      detalhe,
      ...(aplicar ? {} : { aviso: "Prévia (dry-run). Reenvie com {\"confirm\":true} para gravar." }),
    });
  } catch (error) {
    console.error("[compra-transito backfill-barcodes] erro:", error);
    return NextResponse.json(
      { error: "Erro no backfill de códigos de barras", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
