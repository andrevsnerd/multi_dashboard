/**
 * CONFERÊNCIA PARCIAL AGUARDANDO A LOGÍSTICA (regra do dono, 11/11/2026).
 *
 * Quando a loja (gerente) confirma uma saída com menos do que saiu — item a
 * menos ou item não conferido — nada é lançado no Linx. A conferência dela fica
 * guardada aqui, com status `pendente`, e o romaneio ganha o selo amarelo
 * "Aguardando logística". A logística (ou admin) abre o romaneio, vê os números
 * da loja já preenchidos, corrige o que for preciso e aprova: aí sai UMA entrada
 * só, com tudo. Antes, a parcial virava uma entrada com parte dos itens e o resto
 * ficava pendurado (034125: 4 de 15 itens confirmados, os outros 11 precisaram de
 * uma segunda entrada à mão).
 *
 * Uma linha por saída × destino. Reenviar depois de cancelar sobrescreve.
 */

import { hasPostgres, getNeonSql } from "@/lib/db/neon";

export type StatusRevisao = "pendente" | "aprovada" | "cancelada";

export interface ItemRevisao {
  produto: string;
  corProduto: string;
  /** Quantidade que saiu no romaneio. */
  qtdeEnviada: number;
  /** Quantidade que a loja conferiu (0 = não conferido / não chegou). */
  qtdeConferida: number;
  /** Peça P/M/G: o que a loja conferiu em cada tamanho {posição: qtd}. */
  tamanhos?: Record<number, number> | null;
}

export interface RevisaoConferencia {
  companyKey: string;
  romaneioId: string;
  filialDestino: string;
  filialOrigem: string;
  dataRomaneio: string;
  status: StatusRevisao;
  itens: ItemRevisao[];
  pecasEnviadas: number;
  pecasConferidas: number;
  enviadoPor: string;
  enviadoEm: string;
  resolvidoPor: string;
  resolvidoEm: string | null;
  romaneioEntrada: string;
}

export interface ResumoRevisaoPendente {
  enviadoPor: string;
  enviadoEm: string;
  pecasEnviadas: number;
  pecasConferidas: number;
}

let tableChecked = false;
let tablePromise: Promise<void> | null = null;
async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  if (!tablePromise) {
    tablePromise = (async () => {
      const cols = (await sql`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'romaneio_conferencia_revisao'
      `) as Array<{ column_name: string }>;
      if (cols.length === 0) {
        try {
          await sql`
            CREATE TABLE IF NOT EXISTS romaneio_conferencia_revisao (
              company_key      TEXT NOT NULL,
              romaneio_id      TEXT NOT NULL,
              filial_destino   TEXT NOT NULL,
              filial_origem    TEXT NOT NULL,
              data_romaneio    TEXT NOT NULL DEFAULT '',
              status           TEXT NOT NULL,
              itens            JSONB NOT NULL,
              pecas_enviadas   INTEGER NOT NULL,
              pecas_conferidas INTEGER NOT NULL,
              enviado_por      TEXT NOT NULL,
              enviado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              resolvido_por    TEXT NOT NULL DEFAULT '',
              resolvido_em     TIMESTAMPTZ,
              romaneio_entrada TEXT NOT NULL DEFAULT '',
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

function chaves(companyKey: string, romaneioId: string, filialDestino: string) {
  return {
    c: (companyKey || "").trim().toLowerCase(),
    r: (romaneioId || "").trim(),
    fd: (filialDestino || "").trim(),
  };
}

function iso(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function linhaParaRevisao(row: Record<string, unknown>): RevisaoConferencia {
  const itensRaw = typeof row.itens === "string" ? JSON.parse(row.itens) : row.itens;
  return {
    companyKey: String(row.company_key ?? ""),
    romaneioId: String(row.romaneio_id ?? ""),
    filialDestino: String(row.filial_destino ?? ""),
    filialOrigem: String(row.filial_origem ?? ""),
    dataRomaneio: String(row.data_romaneio ?? ""),
    status: String(row.status ?? "pendente") as StatusRevisao,
    itens: Array.isArray(itensRaw) ? (itensRaw as ItemRevisao[]) : [],
    pecasEnviadas: Number(row.pecas_enviadas) || 0,
    pecasConferidas: Number(row.pecas_conferidas) || 0,
    enviadoPor: String(row.enviado_por ?? ""),
    enviadoEm: iso(row.enviado_em),
    resolvidoPor: String(row.resolvido_por ?? ""),
    resolvidoEm: iso(row.resolvido_em) || null,
    romaneioEntrada: String(row.romaneio_entrada ?? ""),
  };
}

/** A revisão desta saída × destino (qualquer status), ou null. */
export async function getRevisao(
  companyKey: string,
  romaneioId: string,
  filialDestino: string
): Promise<RevisaoConferencia | null> {
  if (!hasPostgres()) return null;
  const { c, r, fd } = chaves(companyKey, romaneioId, filialDestino);
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = (await sql`
    SELECT * FROM romaneio_conferencia_revisao
    WHERE company_key = ${c} AND romaneio_id = ${r} AND filial_destino = ${fd}
  `) as Array<Record<string, unknown>>;
  return rows[0] ? linhaParaRevisao(rows[0]) : null;
}

/**
 * Grava a conferência parcial da loja como `pendente`. Recusa (devolve false)
 * se já existe uma aprovada: aí a entrada já foi lançada.
 */
export async function enviarRevisao(p: {
  companyKey: string;
  romaneioId: string;
  filialDestino: string;
  filialOrigem: string;
  dataRomaneio: string;
  itens: ItemRevisao[];
  enviadoPor: string;
}): Promise<boolean> {
  if (!hasPostgres()) throw new Error("Banco de revisões indisponível (sem DATABASE_URL).");
  const { c, r, fd } = chaves(p.companyKey, p.romaneioId, p.filialDestino);
  const pecasEnviadas = p.itens.reduce((s, it) => s + it.qtdeEnviada, 0);
  const pecasConferidas = p.itens.reduce((s, it) => s + it.qtdeConferida, 0);
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = (await sql`
    INSERT INTO romaneio_conferencia_revisao AS t
      (company_key, romaneio_id, filial_destino, filial_origem, data_romaneio, status, itens,
       pecas_enviadas, pecas_conferidas, enviado_por, enviado_em, resolvido_por, resolvido_em, romaneio_entrada)
    VALUES
      (${c}, ${r}, ${fd}, ${(p.filialOrigem || "").trim()}, ${(p.dataRomaneio || "").trim()}, 'pendente',
       ${JSON.stringify(p.itens)}::jsonb, ${pecasEnviadas}, ${pecasConferidas}, ${p.enviadoPor}, NOW(), '', NULL, '')
    ON CONFLICT (company_key, romaneio_id, filial_destino)
    DO UPDATE SET
      filial_origem = EXCLUDED.filial_origem,
      data_romaneio = EXCLUDED.data_romaneio,
      status = 'pendente',
      itens = EXCLUDED.itens,
      pecas_enviadas = EXCLUDED.pecas_enviadas,
      pecas_conferidas = EXCLUDED.pecas_conferidas,
      enviado_por = EXCLUDED.enviado_por,
      enviado_em = NOW(),
      resolvido_por = '',
      resolvido_em = NULL,
      romaneio_entrada = ''
    WHERE t.status <> 'aprovada'
    RETURNING romaneio_id
  `) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

/** Fecha a revisão pendente (aprovada pela logística ou cancelada). False se não havia pendente. */
export async function resolverRevisao(p: {
  companyKey: string;
  romaneioId: string;
  filialDestino: string;
  status: "aprovada" | "cancelada";
  resolvidoPor: string;
  romaneioEntrada?: string;
}): Promise<boolean> {
  if (!hasPostgres()) return false;
  const { c, r, fd } = chaves(p.companyKey, p.romaneioId, p.filialDestino);
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = (await sql`
    UPDATE romaneio_conferencia_revisao
    SET status = ${p.status}, resolvido_por = ${p.resolvidoPor}, resolvido_em = NOW(),
        romaneio_entrada = ${(p.romaneioEntrada || "").trim()}
    WHERE company_key = ${c} AND romaneio_id = ${r} AND filial_destino = ${fd} AND status = 'pendente'
    RETURNING romaneio_id
  `) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

/** Revisões pendentes da empresa, por "romaneioId|filialDestino" — só leitura do Neon (listagem). */
export async function getRevisoesPendentes(companyKey: string): Promise<Map<string, ResumoRevisaoPendente>> {
  const mapa = new Map<string, ResumoRevisaoPendente>();
  if (!hasPostgres()) return mapa;
  const c = (companyKey || "").trim().toLowerCase();
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = (await sql`
    SELECT romaneio_id, filial_destino, enviado_por, enviado_em, pecas_enviadas, pecas_conferidas
    FROM romaneio_conferencia_revisao
    WHERE company_key = ${c} AND status = 'pendente'
  `) as Array<Record<string, unknown>>;
  for (const row of rows) {
    mapa.set(`${row.romaneio_id}|${row.filial_destino}`, {
      enviadoPor: String(row.enviado_por ?? ""),
      enviadoEm: iso(row.enviado_em),
      pecasEnviadas: Number(row.pecas_enviadas) || 0,
      pecasConferidas: Number(row.pecas_conferidas) || 0,
    });
  }
  return mapa;
}
