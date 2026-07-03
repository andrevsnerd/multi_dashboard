import sql from "mssql";

import { getFilialLabelForDisplay, getOperationalFilials } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { getFilialById } from "@/lib/config/filial-registry";
import { withRequest } from "@/lib/db/connection";
import { idForName } from "@/lib/server/filial-resolver";
import { parseBrasiliaDateTime } from "@/lib/utils/brasilia-datetime";

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

function normalizarFilial(valor: unknown): string {
  return String(valor ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
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

  // Canônica ATUAL (uma por grupo) de cada empresa — mesma fonte do resto do app
  // (grupo resolvido dinamicamente pela venda/emissão mais recente, ex.: rodízio
  // e-commerce MSC/AKS). MATRIZ fica de fora: não é loja de sincronização.
  const canonicasNomes = [
    ...getOperationalFilials(nerdConfig, "sales"),
    ...getOperationalFilials(scarfmeConfig, "sales"),
  ].filter((nome) => {
    const config = nome.toUpperCase().startsWith("NERD") ? nerdConfig : scarfmeConfig;
    return getFilialLabelForDisplay(config, nome).toUpperCase() !== "MATRIZ";
  });

  // Resolve cada canônica para o COD_FILIAL do registry. O match com a tabela FILIAIS
  // passa a ser por ID (exato), nunca por nome normalizado — necessário porque grupos
  // têm filiais cujo nome só difere por hífen ("SCARF ME - PAULISTA FFFR" 000112 vs
  // "SCARF ME PAULISTA FFFR" 000117): sob normalização colidiriam e a NÃO-canônica
  // (e linhas-lixo do ERP) entrariam junto.
  const canonicasCods: string[] = [];
  for (const nome of canonicasNomes) {
    const id = await idForName(nome);
    if (id) canonicasCods.push(id);
  }
  const canonicasCodSet = new Set(canonicasCods);
  const ordemCod = new Map(canonicasCods.map((id, i) => [id, i]));

  return withRequest(async (request) => {
    const agora = new Date();

    const filiaisResult = await request.query<{ COD_STR: string; FILIAL: string }>(`
      SELECT RTRIM(LTRIM(CAST(COD_FILIAL AS VARCHAR(50)))) AS COD_STR, FILIAL
      FROM FILIAIS WITH (NOLOCK)
    `);

    const filiaisDeduped = filiaisResult.recordset
      .map((row) => {
        const def = getFilialById(row.COD_STR);
        return {
          codFilial: Number(row.COD_STR),
          regId: def?.id ?? null,
          isEcommerce: def?.ecommerce === true,
          filial: normalizarFilial(row.FILIAL),
        };
      })
      .filter((row) => row.regId !== null && canonicasCodSet.has(row.regId))
      .sort(
        (a, b) =>
          (ordemCod.get(a.regId as string) ?? 10_000) - (ordemCod.get(b.regId as string) ?? 10_000)
      );

    const resultado: SincronizacaoFilial[] = [];

    for (const [index, filial] of filiaisDeduped.entries()) {
      const sufixo = `_${index}`;
      const isEcommerce = filial.isEcommerce;
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
      const dataVenda = parseBrasiliaDateTime(venda?.DATA_VENDA);
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
