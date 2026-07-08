/**
 * Storage de transferências executadas pela tela "Controle de Transferências".
 * Para cada item enviado em uma saída do tipo TRANSFERENCIA ENTRE LOJAS:
 *   - Gravamos 1 linha em `transferencia_pendente`.
 *   - O status (pendente/confirmada) é DERIVADO em tempo de leitura por JOIN
 *     com `romaneio_item_confirmado` (mesmo Neon), que já é alimentada pela
 *     página de romaneios quando o destino confirma a entrada.
 *
 * Vantagens:
 *  - Sem trigger, sem polling, sem cron — single source of truth.
 *  - Confirmar entrada na página de romaneios já atualiza o status aqui.
 *
 * O cooldown de 7 dias por (origem, produto, cor) é derivado desta mesma tabela.
 */

import { hasPostgres, getNeonSql } from "@/lib/db/neon";
import { confirmarItem } from "@/lib/utils/romaneio-confirmacao-store";

let tableChecked = false;

export interface TransferenciaPendenteInsert {
  itemKey: string;
  produto: string;
  corDescricao: string | null;
  corCodigo: string | null;
  descricao: string | null;
  codigoBarra: string | null;
  origemCanonico: string;
  destinoCanonico: string;
  origemLabel: string | null;
  destinoLabel: string | null;
  romaneioSaida: string;
  quantidade: number;
}

export interface TransferenciaPendenteRow {
  id: number;
  companyKey: string;
  itemKey: string;
  produto: string;
  corDescricao: string | null;
  corCodigo: string | null;
  descricao: string | null;
  codigoBarra: string | null;
  origemCanonico: string;
  destinoCanonico: string;
  origemLabel: string | null;
  destinoLabel: string | null;
  romaneioSaida: string;
  quantidade: number;
  dataSaida: string;
  createdBy: string | null;
  qtdConfirmada: number;
  status: "pendente" | "confirmada";
}

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS transferencia_pendente (
      id BIGSERIAL PRIMARY KEY,
      company_key TEXT NOT NULL,
      item_key TEXT NOT NULL,
      produto TEXT NOT NULL,
      cor_descricao TEXT,
      cor_codigo TEXT,
      descricao TEXT,
      codigo_barra TEXT,
      origem_canonico TEXT NOT NULL,
      destino_canonico TEXT NOT NULL,
      origem_label TEXT,
      destino_label TEXT,
      romaneio_saida TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      data_saida TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_tp_company_origem_data
    ON transferencia_pendente (company_key, origem_canonico, produto, cor_codigo, data_saida DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_tp_company_destino_data
    ON transferencia_pendente (company_key, destino_canonico, data_saida DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_tp_company_romaneio
    ON transferencia_pendente (company_key, romaneio_saida)`;
  tableChecked = true;
}

function normCompany(c: string): string {
  return (c || "").trim().toLowerCase();
}

/**
 * Insere várias linhas (uma por item) em transação simples. Cada linha
 * representa um item enviado em um romaneio de saída.
 */
export async function insertTransferenciasPendentes(
  companyKey: string,
  romaneioSaida: string,
  createdBy: string | null,
  items: TransferenciaPendenteInsert[]
): Promise<void> {
  if (!hasPostgres()) {
    // Sem Neon configurado: feature degrade — não falhamos a saída, só logamos.
    console.warn("[transferencia-pendente] Neon não configurado; pulando insert.");
    return;
  }
  if (items.length === 0) return;

  const c = normCompany(companyKey);
  const rom = (romaneioSaida || "").trim();
  if (!c || !rom) return;

  const sql = getNeonSql();
  await ensureTable(sql);

  for (const it of items) {
    await sql`
      INSERT INTO transferencia_pendente (
        company_key, item_key, produto, cor_descricao, cor_codigo, descricao,
        codigo_barra, origem_canonico, destino_canonico, origem_label, destino_label,
        romaneio_saida, quantidade, created_by
      ) VALUES (
        ${c},
        ${it.itemKey},
        ${it.produto},
        ${it.corDescricao},
        ${it.corCodigo},
        ${it.descricao},
        ${it.codigoBarra},
        ${it.origemCanonico},
        ${it.destinoCanonico},
        ${it.origemLabel},
        ${it.destinoLabel},
        ${rom},
        ${it.quantidade},
        ${createdBy}
      )
    `;
  }
}

/** Uma transferência detectada FORA do app (direto no Linx), já canonizada. */
export interface TransferenciaDetectadaRegistro {
  romaneio: string;
  origemCanonico: string;
  destinoCanonico: string;
  origemLabel: string | null;
  destinoLabel: string | null;
  produto: string;
  corCodigo: string | null;
  corDescricao: string | null;
  descricao: string | null;
  codigoBarra: string | null;
  /** EMISSÃO da saída (ISO string) — usada como data_saida (janela de cooldown/histórico). */
  emissao: string;
  quantidade: number;
  /** Quantidade já recebida no destino (perna de entrada no Linx). */
  qtdEntrada: number;
}

/**
 * Registra transferências detectadas fora do app na MESMA tabela usada por uma
 * transferência executada pela tela (`transferencia_pendente`) — de modo que
 * elas passam a: (a) alimentar o cooldown (param a sugestão de reaparecer) e
 * (b) aparecer em "Realizadas". Quando a perna de entrada existe no Linx,
 * grava também a confirmação (romaneio_item_confirmado) para o status derivar
 * como "confirmada".
 *
 * Idempotência por ROMANEIO: se já existe qualquer linha em
 * `transferencia_pendente` com aquele romaneio_saida (seja de execução pela
 * tela, seja de uma detecção anterior), o romaneio inteiro é pulado. Isso evita
 * duplicar tanto transferências que a própria tela criou quanto re-execuções
 * desta detecção.
 */
export async function registrarTransferenciasDetectadas(
  companyKey: string,
  itens: TransferenciaDetectadaRegistro[]
): Promise<{ romaneiosInseridos: number; itensInseridos: number; itensConfirmados: number }> {
  const vazio = { romaneiosInseridos: 0, itensInseridos: 0, itensConfirmados: 0 };
  if (!hasPostgres()) return vazio;
  const c = normCompany(companyKey);
  if (!c || itens.length === 0) return vazio;

  const sql = getNeonSql();
  await ensureTable(sql);

  // Romaneios candidatos (dedup)
  const romaneios = Array.from(
    new Set(itens.map((it) => (it.romaneio || "").trim()).filter(Boolean))
  );
  if (romaneios.length === 0) return vazio;

  // Quais desses romaneios já existem em transferencia_pendente (qualquer origem)?
  const existentes = (await sql`
    SELECT DISTINCT romaneio_saida
    FROM transferencia_pendente
    WHERE company_key = ${c}
      AND romaneio_saida = ANY(${romaneios})
  `) as Array<{ romaneio_saida: string }>;
  const jaRegistrados = new Set(existentes.map((r) => (r.romaneio_saida || "").trim()));

  const novos = itens.filter((it) => !jaRegistrados.has((it.romaneio || "").trim()));
  if (novos.length === 0) return vazio;

  let itensInseridos = 0;
  let itensConfirmados = 0;
  const romaneiosTocados = new Set<string>();

  for (const it of novos) {
    const rom = (it.romaneio || "").trim();
    const qtd = Math.max(1, Math.floor(it.quantidade));
    await sql`
      INSERT INTO transferencia_pendente (
        company_key, item_key, produto, cor_descricao, cor_codigo, descricao,
        codigo_barra, origem_canonico, destino_canonico, origem_label, destino_label,
        romaneio_saida, quantidade, data_saida, created_by
      ) VALUES (
        ${c},
        ${`${it.produto}|${it.corCodigo ?? ""}|${it.origemCanonico}|${it.destinoCanonico}`},
        ${it.produto},
        ${it.corDescricao},
        ${it.corCodigo},
        ${it.descricao},
        ${it.codigoBarra},
        ${it.origemCanonico},
        ${it.destinoCanonico},
        ${it.origemLabel},
        ${it.destinoLabel},
        ${rom},
        ${qtd},
        COALESCE(${it.emissao || null}::timestamptz, NOW()),
        ${"DETECÇÃO AUTOMÁTICA"}
      )
    `;
    itensInseridos += 1;
    romaneiosTocados.add(rom);

    // Perna de entrada já recebida no Linx → grava confirmação (status "confirmada").
    const recebido = Math.max(0, Math.floor(it.qtdEntrada));
    if (recebido > 0) {
      await confirmarItem(
        c,
        rom,
        it.destinoCanonico,
        it.produto,
        it.corCodigo ?? "",
        Math.min(recebido, qtd),
        "DETECÇÃO AUTOMÁTICA"
      );
      itensConfirmados += 1;
    }
  }

  return {
    romaneiosInseridos: romaneiosTocados.size,
    itensInseridos,
    itensConfirmados,
  };
}

/**
 * Devolve chaves para o cooldown do frontend.
 *
 * Chave: `${produto}|${corCodigoOrEmpty}|${origemCanonicoUpper}` —
 * normalizada exatamente como o frontend monta para comparar antes de sugerir.
 *
 * Inclui qualquer transferência (pendente OU confirmada) cuja `data_saida`
 * esteja dentro da janela. O efeito desejado é evitar repetir a sugestão
 * logo após uma saída.
 */
export async function getCooldownKeys(
  companyKey: string,
  days: number
): Promise<string[]> {
  if (!hasPostgres()) return [];
  const c = normCompany(companyKey);
  if (!c) return [];
  const d = Math.max(1, Math.min(365, Math.floor(days)));

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = (await sql`
    SELECT DISTINCT produto, COALESCE(cor_codigo, '') AS cor_codigo, origem_canonico
    FROM transferencia_pendente
    WHERE company_key = ${c}
      AND data_saida >= NOW() - (INTERVAL '1 day' * ${d})
  `) as Array<{ produto: string; cor_codigo: string; origem_canonico: string }>;

  return rows.map(
    (r) =>
      `${(r.produto || "").trim()}|${(r.cor_codigo || "").trim()}|${(r.origem_canonico || "").trim().toUpperCase()}`
  );
}

/**
 * Lista transferências de uma empresa, opcionalmente filtradas, com o status
 * derivado por JOIN com `romaneio_item_confirmado`.
 *
 * Critério de "confirmada": soma de `qtde_confirmada` (no mesmo romaneio,
 * mesmo destino, produto, cor_produto) é >= quantidade da saída.
 */
export interface ListarTransferenciasFiltros {
  origemCanonico?: string | null;
  destinoCanonico?: string | null;
  produto?: string | null;
  status?: "pendente" | "confirmada" | null;
  sinceDays?: number | null;
  limit?: number;
  offset?: number;
}

export async function listarTransferencias(
  companyKey: string,
  filtros: ListarTransferenciasFiltros = {}
): Promise<{ items: TransferenciaPendenteRow[]; total: number }> {
  if (!hasPostgres()) return { items: [], total: 0 };
  const c = normCompany(companyKey);
  if (!c) return { items: [], total: 0 };

  const sql = getNeonSql();
  await ensureTable(sql);

  const limit = Math.max(1, Math.min(200, filtros.limit ?? 30));
  const offset = Math.max(0, filtros.offset ?? 0);
  const sinceDays = filtros.sinceDays != null ? Math.max(1, Math.min(3650, Math.floor(filtros.sinceDays))) : null;
  const origem = (filtros.origemCanonico || "").trim() || null;
  const destino = (filtros.destinoCanonico || "").trim() || null;
  const produto = (filtros.produto || "").trim() || null;

  // Selecionamos tudo + qtd_confirmada agregada. Como o `romaneio_item_confirmado`
  // pode ter múltiplas variantes de `cor_produto` (string vazia vs codigo), usamos
  // COALESCE para casar com o cor_codigo gravado em transferencia_pendente.
  const rowsRaw = (await sql`
    SELECT
      tp.id,
      tp.company_key,
      tp.item_key,
      tp.produto,
      tp.cor_descricao,
      tp.cor_codigo,
      tp.descricao,
      tp.codigo_barra,
      tp.origem_canonico,
      tp.destino_canonico,
      tp.origem_label,
      tp.destino_label,
      tp.romaneio_saida,
      tp.quantidade,
      tp.data_saida,
      tp.created_by,
      COALESCE((
        SELECT SUM(ric.qtde_confirmada)
        FROM romaneio_item_confirmado ric
        WHERE ric.company_key = tp.company_key
          AND ric.romaneio_id = tp.romaneio_saida
          AND ric.filial_destino = tp.destino_canonico
          AND ric.produto = tp.produto
          AND COALESCE(ric.cor_produto, '') = COALESCE(tp.cor_codigo, '')
      ), 0) AS qtd_confirmada
    FROM transferencia_pendente tp
    WHERE tp.company_key = ${c}
      AND (${sinceDays}::int IS NULL OR tp.data_saida >= NOW() - (INTERVAL '1 day' * ${sinceDays ?? 0}))
      AND (${origem}::text IS NULL OR tp.origem_canonico = ${origem})
      AND (${destino}::text IS NULL OR tp.destino_canonico = ${destino})
      AND (${produto}::text IS NULL OR tp.produto = ${produto})
    ORDER BY tp.data_saida DESC
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `) as Array<{
    id: number;
    company_key: string;
    item_key: string;
    produto: string;
    cor_descricao: string | null;
    cor_codigo: string | null;
    descricao: string | null;
    codigo_barra: string | null;
    origem_canonico: string;
    destino_canonico: string;
    origem_label: string | null;
    destino_label: string | null;
    romaneio_saida: string;
    quantidade: number;
    data_saida: string;
    created_by: string | null;
    qtd_confirmada: number | string;
  }>;

  const computedStatus = (qtdConfirmada: number, quantidade: number): "pendente" | "confirmada" =>
    qtdConfirmada >= quantidade && quantidade > 0 ? "confirmada" : "pendente";

  let mapped: TransferenciaPendenteRow[] = rowsRaw.map((r) => {
    const qtdConfirmada = Number(r.qtd_confirmada || 0);
    return {
      id: Number(r.id),
      companyKey: r.company_key,
      itemKey: r.item_key,
      produto: r.produto,
      corDescricao: r.cor_descricao,
      corCodigo: r.cor_codigo,
      descricao: r.descricao,
      codigoBarra: r.codigo_barra,
      origemCanonico: r.origem_canonico,
      destinoCanonico: r.destino_canonico,
      origemLabel: r.origem_label,
      destinoLabel: r.destino_label,
      romaneioSaida: r.romaneio_saida,
      quantidade: Number(r.quantidade || 0),
      dataSaida: r.data_saida,
      createdBy: r.created_by,
      qtdConfirmada,
      status: computedStatus(qtdConfirmada, Number(r.quantidade || 0)),
    };
  });

  // Filtro por status precisa acontecer depois do JOIN (não é coluna na tabela)
  if (filtros.status) {
    mapped = mapped.filter((row) => row.status === filtros.status);
  }

  // Pegamos limit+1 pra inferir se há mais. Devolvemos `total` como
  // approximate-count para esta página (cliente decide se mostra "próxima").
  const hasMore = mapped.length > limit;
  const items = hasMore ? mapped.slice(0, limit) : mapped;
  return { items, total: items.length + (hasMore ? 1 : 0) };
}

/** Retorna contadores por (origem, destino) dentro da janela.
 *  Usado pelas badges das tabs "Realizadas" em cada destinationGroup. */
export async function contadoresPorOrigemDestino(
  companyKey: string,
  sinceDays: number
): Promise<Array<{ origemCanonico: string; destinoCanonico: string; total: number }>> {
  if (!hasPostgres()) return [];
  const c = normCompany(companyKey);
  if (!c) return [];
  const days = Math.max(1, Math.min(3650, Math.floor(sinceDays)));

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = (await sql`
    SELECT origem_canonico, destino_canonico, COUNT(*)::int AS total
    FROM transferencia_pendente
    WHERE company_key = ${c}
      AND data_saida >= NOW() - (INTERVAL '1 day' * ${days})
    GROUP BY origem_canonico, destino_canonico
  `) as Array<{ origem_canonico: string; destino_canonico: string; total: number }>;

  return rows.map((r) => ({
    origemCanonico: r.origem_canonico,
    destinoCanonico: r.destino_canonico,
    total: Number(r.total || 0),
  }));
}

/** Conta quantos registros existem para um destino dentro da janela.
 *  Usado pelo badge da aba "Realizadas" em cada destinationHeader. */
export async function countByDestino(
  companyKey: string,
  destinoCanonico: string,
  sinceDays: number
): Promise<number> {
  if (!hasPostgres()) return 0;
  const c = normCompany(companyKey);
  const d = (destinoCanonico || "").trim();
  if (!c || !d) return 0;
  const days = Math.max(1, Math.min(3650, Math.floor(sinceDays)));

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = (await sql`
    SELECT COUNT(*)::int AS cnt
    FROM transferencia_pendente
    WHERE company_key = ${c}
      AND destino_canonico = ${d}
      AND data_saida >= NOW() - (INTERVAL '1 day' * ${days})
  `) as Array<{ cnt: number }>;
  return rows[0]?.cnt ?? 0;
}
