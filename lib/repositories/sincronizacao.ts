import sql from "mssql";

import { resolveCompany, getFilialLabelForDisplay } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { withRequest } from "@/lib/db/connection";

const SINCRONIZACAO_FILIAIS = [
  "SCARF ME - HIGIENOPOLIS 2",
  "SCARF ME - PAULISTA RSR",
  "SCARF ME - PAULISTA FFFR",
  "SCARFME LLL - GALEAO RJ",
  "MSC COMERCIO DE LENCOS LT",
  "GUARULHOS - RSR",
  "IGUATEMI SP - JJJ",
  "MORUMBI - JJJ",
  "NERD CENTER NORTE",
  "NERD ELDORADO",
  "NERD HIGIENOPOLIS",
  "NERD LEBLON",
  "NERD MORUMBI RDRRRJ",
  "NERD MORUMBI RDRX",
  "NERD MORUMBI RDRRX",
  "NERD VILLA LOBOS",
  "OSCAR FREIRE - FSZ",
  "VILLA LOBOS - LLL",
] as const;

const SINCRONIZACAO_FILIAIS_NORMALIZADAS = SINCRONIZACAO_FILIAIS.map((f) => normalizarChaveFilial(f));
const SINCRONIZACAO_FILIAIS_EXCLUIDAS = [
  "NERD MORUMBI - RDRRX",
  "NERD",
  "NERD HIGIENOPOLIS RDRRX",
  "NERD MORUMBI",
  "SCARF ME- HIGIENOPOLIS",
] as const;
const SINCRONIZACAO_FILIAL_OCULTA_EXATA = "NERD MORUMBI RDRRRJ";
const SINCRONIZACAO_FILIAIS_EXCLUIDAS_NORMALIZADAS = new Set(
  SINCRONIZACAO_FILIAIS_EXCLUIDAS.map((f) => normalizarFilial(f))
);

export type SincronizacaoStatus = "OK" | "ATENCAO" | "ATRASADO" | "SEM_VENDAS";

export interface SincronizacaoFilial {
  codFilial: number;
  filial: string;
  displayName: string;
  status: SincronizacaoStatus;
  ultimaVenda: string | null;
  deltaDescricao: string;
  vendasHoje: number;
  ticket: string | null;
  valorTicket: number;
  vendedor: string | null;
  itens: number | null;
  nfNumero: string | null;
  nfSerie: string | null;
}

function parseSqlDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  // SQL returns "YYYY-MM-DD HH:mm:ss"; parse as local time to avoid UTC day shift.
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizarFilial(valor: unknown): string {
  return String(valor ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarChaveFilial(valor: unknown): string {
  return normalizarFilial(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classificarStatus(ultimaVenda: Date | null, agora: Date): SincronizacaoStatus {
  if (!ultimaVenda) {
    return "SEM_VENDAS";
  }

  const deltaMs = agora.getTime() - ultimaVenda.getTime();
  const horas12 = 12 * 60 * 60 * 1000;
  const limiteAtencao = (24 + 23) * 60 * 60 * 1000 + 59 * 60 * 1000;

  if (deltaMs <= horas12) {
    return "OK";
  }
  if (deltaMs <= limiteAtencao) {
    return "ATENCAO";
  }
  return "ATRASADO";
}

function formatarDelta(ultimaVenda: Date | null, agora: Date): string {
  if (!ultimaVenda) {
    return "-";
  }

  const deltaHoras = Math.floor((agora.getTime() - ultimaVenda.getTime()) / (1000 * 60 * 60));
  if (deltaHoras < 24) {
    return `${deltaHoras} hora(s)`;
  }
  const deltaDias = Math.floor((agora.getTime() - ultimaVenda.getTime()) / (1000 * 60 * 60 * 24));
  return `${deltaDias} dia(s)`;
}

export async function fetchSincronizacaoFiliais(): Promise<{
  geradoEm: string;
  totalFiliais: number;
  filiais: SincronizacaoFilial[];
}> {
  const [nerdConfig, scarfmeConfig] = await Promise.all([
    resolveCompanyDynamic('nerd'),
    resolveCompanyDynamic('scarfme'),
  ]);

  function getDisplayName(filialName: string): string {
    const config = filialName.toUpperCase().startsWith('NERD') ? nerdConfig : scarfmeConfig;
    return getFilialLabelForDisplay(config, filialName);
  }

  return withRequest(async (request) => {
    const agora = new Date();
    const consideradas = new Set(SINCRONIZACAO_FILIAIS_NORMALIZADAS);
    const ordem = new Map(SINCRONIZACAO_FILIAIS_NORMALIZADAS.map((f, i) => [f, i]));
    const ecommerceFiliais = new Set(
      (resolveCompany("scarfme")?.ecommerceFilials ?? []).map((f) => normalizarChaveFilial(f))
    );

    const filiaisResult = await request.query<{ COD_FILIAL: number; FILIAL: string }>(`
      SELECT COD_FILIAL, FILIAL
      FROM FILIAIS WITH (NOLOCK)
    `);

    const filiais = filiaisResult.recordset
      .map((row) => ({
        codFilial: Number(row.COD_FILIAL),
        filial: normalizarFilial(row.FILIAL),
        filialKey: normalizarChaveFilial(row.FILIAL),
      }))
      .filter((row) => {
        if (!Number.isFinite(row.codFilial)) {
          return false;
        }
        if (row.filial === SINCRONIZACAO_FILIAL_OCULTA_EXATA) {
          return false;
        }
        if (SINCRONIZACAO_FILIAIS_EXCLUIDAS_NORMALIZADAS.has(row.filial)) {
          return false;
        }

        if (consideradas.has(row.filialKey)) {
          return true;
        }

        // Tolerar pequenas diferenças de cadastro no ERP, como espaços ou sufixos extras.
        for (const filialBase of SINCRONIZACAO_FILIAIS_NORMALIZADAS) {
          if (row.filialKey.includes(filialBase) || filialBase.includes(row.filialKey)) {
            return true;
          }
        }

        return false;
      })
      .sort((a, b) => (ordem.get(a.filialKey) ?? 10_000) - (ordem.get(b.filialKey) ?? 10_000));

    const resultado: SincronizacaoFilial[] = [];

    for (const [index, filial] of filiais.entries()) {
      const sufixo = `_${index}`;
      const isEcommerce = ecommerceFiliais.has(filial.filialKey);
      const dataVendaQuery = isEcommerce
        ? `
          SELECT CONVERT(VARCHAR(19), MAX(f.EMISSAO), 120) AS DATA_VENDA
          FROM FATURAMENTO f WITH (NOLOCK)
          WHERE RTRIM(LTRIM(ISNULL(f.FILIAL, ''))) = @filialNome
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        `
        : `
          SELECT TOP 1
            CONVERT(VARCHAR(19), v.DATA_VENDA, 120) AS DATA_VENDA
          FROM LOJA_VENDA v WITH (NOLOCK)
          WHERE v.CODIGO_FILIAL = @codFilial
          ORDER BY v.DATA_VENDA DESC
        `;

      const ultimaVendaResult = isEcommerce
        ? await request
            .input("filialNome", sql.VarChar, filial.filial)
            .query<{ DATA_VENDA: string | null }>(dataVendaQuery)
        : await request
            .input(`codFilial${sufixo}`, sql.Int, filial.codFilial)
            .query<{ DATA_VENDA: string | null }>(dataVendaQuery.replace("@codFilial", `@codFilial${sufixo}`));

      const venda = ultimaVendaResult.recordset[0];
      const dataVenda = parseSqlDateTime(venda?.DATA_VENDA);
      const ticket = null;
      const valorTicket = 0;
      const vendedor = null;
      const lancamentoCaixa = null;
      const terminal = "";
      const ctbLancamento = "";

      let itens: number | null = null;
      if (!isEcommerce && ticket) {
        const codFilialItensParam = `codFilialItens${sufixo}`;
        const ticketItensParam = `ticketItens${sufixo}`;
        const itensResult = await request
          .input(codFilialItensParam, sql.Int, filial.codFilial)
          .input(ticketItensParam, sql.VarChar, ticket)
          .query<{ ITENS: number | null }>(`
            SELECT
              SUM(
                CASE
                  WHEN vp.QTDE IS NULL THEN 0
                  WHEN (ISNULL(vp.QTDE, 0) - ISNULL(vp.QTDE_CANCELADA, 0)) < 0 THEN 0
                  ELSE (ISNULL(vp.QTDE, 0) - ISNULL(vp.QTDE_CANCELADA, 0))
                END
              ) AS ITENS
            FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
            WHERE vp.CODIGO_FILIAL = @${codFilialItensParam}
              AND vp.TICKET = @${ticketItensParam}
          `);
        const itensBruto = itensResult.recordset[0]?.ITENS;
        itens = typeof itensBruto === "number" ? Math.trunc(itensBruto) : null;
      }

      let nfNumero: string | null = null;
      let nfSerie: string | null = null;
      const codFilialStr = String(filial.codFilial).padStart(6, "0");

      try {
        if (isEcommerce) {
          const codFilialEcommerceParam = `filialEcommerce${sufixo}`;
          const satResult = await request
            .input(codFilialEcommerceParam, sql.VarChar, filial.filial)
            .query<{ NUMERO: string | null; SERIE: string | null }>(`
              SELECT TOP 1
                CAST(f.NF_SAIDA AS VARCHAR(20)) AS NUMERO,
                CAST(f.SERIE_NF AS VARCHAR(10)) AS SERIE
              FROM FATURAMENTO f WITH (NOLOCK)
              WHERE RTRIM(LTRIM(ISNULL(f.FILIAL, ''))) = @${codFilialEcommerceParam}
                AND f.NOTA_CANCELADA = 0
                AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
              ORDER BY f.EMISSAO DESC, f.NF_SAIDA DESC, f.SERIE_NF DESC
            `);

          const sat = satResult.recordset[0];
          if (sat?.NUMERO) {
            nfNumero = sat.NUMERO.trim();
            nfSerie = sat.SERIE?.trim() || null;
          }
        } else {
        const codFilialSatParam = `codFilialSat${sufixo}`;
        const lancamentoCaixaParam = `lancamentoCaixa${sufixo}`;
        const terminalSatParam = `terminalSat${sufixo}`;
        const satResult = await request
          .input(codFilialSatParam, sql.VarChar, codFilialStr)
          .input(lancamentoCaixaParam, sql.VarChar, String(lancamentoCaixa ?? ""))
          .input(terminalSatParam, sql.VarChar, terminal)
          .query<{ NUMERO: string | null; SERIE: string | null }>(`
            SELECT TOP 1
              CAST(c.CF_NUMERO AS VARCHAR(20)) AS NUMERO,
              CAST(c.SERIE_NF AS VARCHAR(10)) AS SERIE
            FROM LOJA_CF_SAT c WITH (NOLOCK)
            WHERE RTRIM(LTRIM(ISNULL(c.CODIGO_FILIAL, ''))) = @${codFilialSatParam}
              AND c.LANCAMENTO_CAIXA = @${lancamentoCaixaParam}
              AND RTRIM(LTRIM(ISNULL(c.TERMINAL, ''))) = @${terminalSatParam}
            ORDER BY c.EMISSAO DESC
          `);

        const sat = satResult.recordset[0];
        if (sat?.NUMERO) {
          nfNumero = sat.NUMERO.trim();
          nfSerie = sat.SERIE?.trim() || null;
        }
        }
      } catch {
        // Mantem comportamento do script: falha ao buscar SAT nao interrompe fluxo.
      }

      if (!isEcommerce && !nfNumero && ctbLancamento) {
        try {
          const codFilialNfeParam = `codFilialNfe${sufixo}`;
          const ctbLancamentoParam = `ctbLancamento${sufixo}`;
          const nfeResult = await request
            .input(codFilialNfeParam, sql.VarChar, codFilialStr)
            .input(ctbLancamentoParam, sql.VarChar, ctbLancamento)
            .query<{ NUMERO: string | null; SERIE: string | null }>(`
              SELECT TOP 1
                RTRIM(ISNULL(n.NF_NUMERO, '')) AS NUMERO,
                CAST(n.SERIE_NF AS VARCHAR(10)) AS SERIE
              FROM LOJA_NOTA_FISCAL n WITH (NOLOCK)
              WHERE RTRIM(LTRIM(ISNULL(n.CODIGO_FILIAL, ''))) = @${codFilialNfeParam}
                AND RTRIM(LTRIM(ISNULL(n.CTB_LANCAMENTO, ''))) = @${ctbLancamentoParam}
              ORDER BY n.EMISSAO DESC
            `);

          const nfe = nfeResult.recordset[0];
          if (nfe?.NUMERO) {
            nfNumero = nfe.NUMERO.trim();
            nfSerie = nfe.SERIE?.trim() || null;
          }
        } catch {
          // Mantem comportamento do script: falha ao buscar NFe nao interrompe fluxo.
        }
      }

      const codFilialHojeParam = `codFilialHoje${sufixo}`;
      const vendasHojeResult = isEcommerce
        ? await request
            .input(`filialHoje${sufixo}`, sql.VarChar, filial.filial)
            .query<{ QTD: number | null }>(`
              SELECT COUNT(DISTINCT CONCAT(f.NF_SAIDA, '-', f.SERIE_NF)) AS QTD
              FROM FATURAMENTO f WITH (NOLOCK)
              WHERE RTRIM(LTRIM(ISNULL(f.FILIAL, ''))) = @filialHoje${sufixo}
                AND CAST(f.EMISSAO AS DATE) = CAST(GETDATE() AS DATE)
                AND f.NOTA_CANCELADA = 0
                AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            `)
        : await request
            .input(codFilialHojeParam, sql.Int, filial.codFilial)
            .query<{ QTD: number | null }>(`
              SELECT COUNT(1) AS QTD
              FROM LOJA_VENDA v WITH (NOLOCK)
              WHERE v.CODIGO_FILIAL = @${codFilialHojeParam}
                AND CAST(v.DATA_VENDA AS DATE) = CAST(GETDATE() AS DATE)
            `);
      const vendasHoje = Number(vendasHojeResult.recordset[0]?.QTD ?? 0);
      const status = classificarStatus(dataVenda, agora);

      resultado.push({
        codFilial: filial.codFilial,
        filial: filial.filial,
        displayName: getDisplayName(filial.filial),
        status,
        ultimaVenda: dataVenda ? dataVenda.toISOString() : null,
        deltaDescricao: formatarDelta(dataVenda, agora),
        vendasHoje,
        ticket,
        valorTicket,
        vendedor,
        itens,
        nfNumero,
        nfSerie,
      });
    }

    return {
      geradoEm: agora.toISOString(),
      totalFiliais: resultado.length,
      filiais: resultado,
    };
  });
}
