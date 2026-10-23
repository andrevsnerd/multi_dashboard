/**
 * Resultado da conferência de cada saída confirmada — calculado UMA vez, quando a
 * confirmação muda (confirmar, confirmar tudo, desconfirmar), e gravado no Neon.
 * A listagem de romaneios só lê daqui para pintar o selo "Parcialmente
 * confirmado 30/32"; nunca recalcula contra o Linx.
 *
 * A comparação é item a item (produto×cor): o total de peças não basta. No 033750
 * duas cores vieram trocadas (5+1 saíram, 4+2 chegaram) e o total bateu 74/74.
 * A saída original nunca é alterada pela confirmação (divergência vira romaneio
 * novo na origem), então comparar com ela continua valendo depois.
 */

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import { fetchQtdeItensSaidas } from "@/lib/repositories/logSaidas";
import { getConfirmados } from "@/lib/utils/romaneio-confirmacao-store";

export interface ConferenciaRomaneio {
  /** Itens (produto×cor) confirmados exatamente com a quantidade do romaneio. */
  itensOk: number;
  itensTotal: number;
  pecasConfirmadas: number;
  pecasRomaneio: number;
}

let tableChecked = false;
let tablePromise: Promise<void> | null = null;
async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  if (!tablePromise) {
    tablePromise = (async () => {
      const cols = (await sql`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'romaneio_conferencia'
      `) as Array<{ column_name: string }>;
      if (cols.length === 0) {
        try {
          await sql`
            CREATE TABLE IF NOT EXISTS romaneio_conferencia (
              company_key       TEXT NOT NULL,
              romaneio_id       TEXT NOT NULL,
              filial_destino    TEXT NOT NULL,
              filial_origem     TEXT NOT NULL,
              itens_ok          INTEGER NOT NULL,
              itens_total       INTEGER NOT NULL,
              pecas_confirmadas INTEGER NOT NULL,
              pecas_romaneio    INTEGER NOT NULL,
              divergente        BOOLEAN NOT NULL,
              updated_at        TIMESTAMPTZ DEFAULT NOW(),
              PRIMARY KEY (company_key, romaneio_id, filial_destino)
            )
          `;
        } catch (e) {
          // Outra instância criou ao mesmo tempo (ver memória ensure-table-ddl-corrida).
          const code = (e as { code?: string })?.code ?? "";
          if (!["23505", "42P07"].includes(code)) throw e;
        }
      }
      tableChecked = true;
    })().catch((e) => {
      tablePromise = null;
      throw e;
    });
  }
  return tablePromise;
}

/**
 * Recalcula e grava a conferência de UMA saída: 1 leitura no Neon + 1 consulta ao
 * Linx só deste romaneio. `filialOrigem` vem da confirmação; na desconfirmação
 * (que não manda a origem) vale a gravada da última vez.
 *
 * Nunca derruba a confirmação: quem chama ignora erro (o selo é só aviso).
 */
export async function atualizarConferenciaRomaneio(p: {
  companyKey: string;
  romaneioId: string;
  filialDestino: string;
  filialOrigem?: string;
}): Promise<void> {
  if (!hasPostgres()) return; // sem Neon não há listagem com selo
  const c = (p.companyKey || "").trim().toLowerCase();
  const r = (p.romaneioId || "").trim();
  const fd = (p.filialDestino || "").trim();
  if (!c || !r || !fd) return;

  const sql = getNeonSql();
  await ensureTable(sql);

  const confirmados = await getConfirmados(c, r, fd);
  if (confirmados.size === 0) {
    await sql`DELETE FROM romaneio_conferencia WHERE company_key = ${c} AND romaneio_id = ${r} AND filial_destino = ${fd}`;
    return;
  }

  let origem = (p.filialOrigem || "").trim();
  if (!origem) {
    const atual = (await sql`
      SELECT filial_origem FROM romaneio_conferencia
      WHERE company_key = ${c} AND romaneio_id = ${r} AND filial_destino = ${fd}
    `) as Array<{ filial_origem: string }>;
    origem = (atual[0]?.filial_origem ?? "").trim();
  }
  if (!origem) return; // trânsito do Linx (sem saída de origem) não tem selo

  const linx = await fetchQtdeItensSaidas([r], [origem]);
  const itensRomaneio = linx.get(`${r}|${origem.toUpperCase()}`);
  if (!itensRomaneio || itensRomaneio.size === 0) return;

  let itensOk = 0;
  let pecasRomaneio = 0;
  for (const [item, qtde] of itensRomaneio) {
    pecasRomaneio += qtde;
    if ((confirmados.get(item) ?? 0) === qtde) itensOk += 1;
  }
  const pecasConfirmadas = [...confirmados.values()].reduce((s, q) => s + q, 0);
  const extras = [...confirmados.keys()].some((item) => !itensRomaneio.has(item));
  const divergente = itensOk < itensRomaneio.size || extras;

  await sql`
    INSERT INTO romaneio_conferencia
      (company_key, romaneio_id, filial_destino, filial_origem, itens_ok, itens_total,
       pecas_confirmadas, pecas_romaneio, divergente, updated_at)
    VALUES
      (${c}, ${r}, ${fd}, ${origem}, ${itensOk}, ${itensRomaneio.size},
       ${pecasConfirmadas}, ${pecasRomaneio}, ${divergente}, NOW())
    ON CONFLICT (company_key, romaneio_id, filial_destino)
    DO UPDATE SET
      filial_origem = EXCLUDED.filial_origem,
      itens_ok = EXCLUDED.itens_ok,
      itens_total = EXCLUDED.itens_total,
      pecas_confirmadas = EXCLUDED.pecas_confirmadas,
      pecas_romaneio = EXCLUDED.pecas_romaneio,
      divergente = EXCLUDED.divergente,
      updated_at = NOW()
  `;
}

/** Saídas confirmadas com alteração, por "romaneioId|filialDestino" — só leitura do Neon. */
export async function getConferenciasDivergentes(
  companyKey: string
): Promise<Map<string, ConferenciaRomaneio>> {
  const mapa = new Map<string, ConferenciaRomaneio>();
  if (!hasPostgres()) return mapa;
  const c = (companyKey || "").trim().toLowerCase();

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT romaneio_id, filial_destino, itens_ok, itens_total, pecas_confirmadas, pecas_romaneio
    FROM romaneio_conferencia
    WHERE company_key = ${c} AND divergente
  `;
  for (const row of rows) {
    mapa.set(`${row.romaneio_id}|${row.filial_destino}`, {
      itensOk: Number(row.itens_ok) || 0,
      itensTotal: Number(row.itens_total) || 0,
      pecasConfirmadas: Number(row.pecas_confirmadas) || 0,
      pecasRomaneio: Number(row.pecas_romaneio) || 0,
    });
  }
  return mapa;
}
