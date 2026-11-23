import "server-only";

import sql from "mssql";
import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { naturezaValidada, naturezaValidadaFilial, PADROES, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { CatalogoNotas, NaturezaCatalogo, PadroesNatureza } from "@/lib/faturamento-ecommerce/types";
import { nameForId } from "@/lib/server/filial-resolver";
import { filiaisNotaDaEmpresa } from "./filiais-nota";

/**
 * Catálogo de notas — o que cada filial emissora da página JÁ fez no Linx (desde 01/01/2025),
 * para a tela oferecer as mesmas opções: as naturezas usadas (a mais comum para o tipo de
 * cliente vem por padrão, as outras ficam disponíveis) e, por natureza, o valor mais comum de
 * cada campo do cabeçalho (condição, frete, transportadora, info. pagamento, volume, cód. de
 * transação, consumidor final).
 *
 * Ficam de fora NF cancelada e NF para filial do próprio grupo (abastecimento/transferência,
 * feito por outra rotina do Linx — a página bloqueia esse destinatário).
 *
 * As pernas do rodízio do e-commerce entram juntas (mesmo regime, mesma operação); cada filial
 * extra (Matriz) tem o seu próprio catálogo.
 */

const DESDE = "2025-01-01";
const TTL_MS = 15 * 60 * 1000;
const cache = new Map<EmpresaFat, { em: number; dados: CatalogoNotas }>();

interface Linha {
  filial: string;
  nat: string;
  descr: string;
  tipoOp: string;
  ind: number;
  uf: string;
  cf: boolean;
  trans: string;
  cond: string;
  frete: string;
  transp: string;
  redesp: string;
  info: string;
  volume: string;
  /** 1 = NF de produto (FATURAMENTO_PROD); 0 = itens avulsos/materiais (outro form, outro cód. de transação). */
  prod: number;
  paraFilial: number;
  tab: string | null;
  n: number;
}

/** Valor mais frequente (ponderado pela contagem). */
function moda<T extends string | boolean>(pares: [T | null | undefined, number][]): T | null {
  const m = new Map<T, number>();
  for (const [v, n] of pares) if (v !== null && v !== undefined && v !== "") m.set(v, (m.get(v) ?? 0) + n);
  let melhor: T | null = null;
  let max = -1;
  for (const [v, n] of m) if (n > max) [melhor, max] = [v, n];
  return melhor;
}

export async function fetchCatalogoNotas(empresa: EmpresaFat, opts: { semCache?: boolean } = {}): Promise<CatalogoNotas> {
  const c = cache.get(empresa);
  if (!opts.semCache && c && Date.now() - c.em < TTL_MS) return c.dados;

  const filiais = await filiaisNotaDaEmpresa(empresa);
  const extras = PADROES[empresa].nota.filiaisExtras;
  const linhas = await withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    const nomes = filiais.map((f, i) => {
      req.input(`f${i}`, sql.VarChar(25), f);
      return `@f${i}`;
    });
    req.input("desde", sql.DateTime, new Date(`${DESDE}T00:00:00`));
    const r = await req.query(`
      SELECT LTRIM(RTRIM(F.FILIAL)) AS filial, LTRIM(RTRIM(F.NATUREZA_SAIDA)) AS nat, LTRIM(RTRIM(MAX(N.DESC_NATUREZA))) AS descr, LTRIM(RTRIM(MAX(N.TIPO_OPERACAO))) AS tipoOp,
             ISNULL(C.INDICADOR_FISCAL_TERCEIRO, 8) AS ind, CASE WHEN C.UF = CF.UF THEN 'dentro' ELSE 'fora' END AS uf,
             ISNULL(F.INDICA_CONSUMIDOR_FINAL, 0) AS cf, LTRIM(RTRIM(F.COD_TRANSACAO)) AS trans,
             LTRIM(RTRIM(F.CONDICAO_PGTO)) AS cond, LTRIM(RTRIM(F.TIPO_FRETE)) AS frete,
             LTRIM(RTRIM(F.TRANSPORTADORA)) AS transp, LTRIM(RTRIM(F.TRANSP_REDESPACHO)) AS redesp,
             LTRIM(RTRIM(F.INFO_PGTO)) AS info, LTRIM(RTRIM(F.TIPO_VOLUME)) AS volume,
             ISNULL(PX.ok, 0) AS prod, CASE WHEN FX.FILIAL IS NULL THEN 0 ELSE 1 END AS paraFilial, VT.tab,
             COUNT(*) AS n
        FROM FATURAMENTO F WITH (NOLOCK)
        JOIN CADASTRO_CLI_FOR C WITH (NOLOCK) ON C.NOME_CLIFOR = F.NOME_CLIFOR
        JOIN CADASTRO_CLI_FOR CF WITH (NOLOCK) ON CF.NOME_CLIFOR = F.FILIAL
        LEFT JOIN NATUREZAS_SAIDAS N WITH (NOLOCK) ON N.NATUREZA_SAIDA = F.NATUREZA_SAIDA
        LEFT JOIN FILIAIS FX WITH (NOLOCK) ON FX.FILIAL = F.NOME_CLIFOR
        OUTER APPLY (SELECT TOP 1 1 AS ok FROM FATURAMENTO_PROD P WITH (NOLOCK)
                      WHERE P.FILIAL = F.FILIAL AND P.NF_SAIDA = F.NF_SAIDA AND P.SERIE_NF = F.SERIE_NF) PX
        OUTER APPLY (SELECT TOP 1 LTRIM(RTRIM(V.CODIGO_TAB_PRECO)) AS tab FROM FATURAMENTO_PROD P2 WITH (NOLOCK)
                      JOIN VENDAS V WITH (NOLOCK) ON V.PEDIDO = P2.PEDIDO
                      WHERE P2.FILIAL = F.FILIAL AND P2.NF_SAIDA = F.NF_SAIDA AND P2.SERIE_NF = F.SERIE_NF) VT
       WHERE F.FILIAL IN (${nomes.join(",")}) AND F.NOTA_CANCELADA = 0 AND F.EMISSAO >= @desde
       GROUP BY F.FILIAL, F.NATUREZA_SAIDA, C.INDICADOR_FISCAL_TERCEIRO, CASE WHEN C.UF = CF.UF THEN 'dentro' ELSE 'fora' END,
                F.INDICA_CONSUMIDOR_FINAL, F.COD_TRANSACAO, F.CONDICAO_PGTO, F.TIPO_FRETE, F.TRANSPORTADORA,
                F.TRANSP_REDESPACHO, F.INFO_PGTO, F.TIPO_VOLUME, PX.ok, CASE WHEN FX.FILIAL IS NULL THEN 0 ELSE 1 END, VT.tab`);
    return r.recordset as Linha[];
  });

  // Grupo de catálogo: cada filial extra é o seu; as pernas do rodízio formam um só.
  const extraDe = new Map<string, (typeof extras)[number]>();
  for (const x of extras) {
    const nome = await nameForId(x.codFilial);
    if (nome) extraDe.set(nome, x);
  }
  const grupoDe = (filial: string) => (extraDe.has(filial) ? `extra:${filial}` : "rodizio");
  const simplesDoGrupo = (g: string) => (g === "rodizio" ? true : (extraDe.get(g.slice(6))?.simplesNacional ?? true));

  // Chave natureza|destino: NF para filial do grupo (abastecimento) tem padrões e catálogo próprios.
  const porGrupo = new Map<string, Map<string, Linha[]>>();
  for (const l of linhas) {
    const g = grupoDe(l.filial);
    if (!porGrupo.has(g)) porGrupo.set(g, new Map());
    const m = porGrupo.get(g)!;
    const k = `${l.nat}|${Number(l.paraFilial) ? "filial" : "cliente"}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(l);
  }

  const catalogoDoGrupo = (g: string): NaturezaCatalogo[] => {
    const m = porGrupo.get(g) ?? new Map<string, Linha[]>();
    return [...m.entries()]
      .map(([chave, ls]): NaturezaCatalogo => {
        const [nat, destino] = chave.split("|") as [string, "cliente" | "filial"];
        const porClasse: Record<string, number> = {};
        for (const l of ls) porClasse[`${l.ind}|${l.uf}`] = (porClasse[`${l.ind}|${l.uf}`] ?? 0) + l.n;
        const consumidorFinal: Record<string, boolean> = {};
        for (const ind of new Set(ls.map((l) => String(l.ind)))) {
          consumidorFinal[ind] = moda(ls.filter((l) => String(l.ind) === ind).map((l) => [Boolean(l.cf), l.n] as [boolean, number])) ?? false;
        }
        consumidorFinal["*"] = moda(ls.map((l) => [Boolean(l.cf), l.n] as [boolean, number])) ?? false;
        const padroes: PadroesNatureza = {
          condicaoPgto: moda(ls.map((l) => [l.cond, l.n])),
          tipoFrete: moda(ls.map((l) => [l.frete, l.n])),
          transportadora: moda(ls.map((l) => [l.transp, l.n])),
          transpRedespacho: moda(ls.map((l) => [l.redesp, l.n])),
          infoPgto: moda(ls.map((l) => [l.info, l.n])),
          tipoVolume: moda(ls.map((l) => [l.volume, l.n])),
          // Cód. de transação = o do form de PRODUTO (a página só emite produto): NF de itens avulsos/
          // materiais usa outro (130.01/199.10: FATURAMENTO_026), mesmo na mesma natureza.
          codTransacao: moda(ls.filter((l) => Number(l.prod) === 1).map((l) => [l.trans, l.n])) ?? moda(ls.map((l) => [l.trans, l.n])),
          tabPreco: moda(ls.map((l) => [l.tab, l.n])),
          codTransacaoMaterial: moda(ls.filter((l) => Number(l.prod) === 0).map((l) => [l.trans, l.n])),
        };
        return {
          natureza: nat,
          descricao: ls.find((l) => l.descr)?.descr ?? "",
          tipoOperacao: ls.find((l) => l.tipoOp)?.tipoOp ?? "",
          nfs: ls.reduce((s, l) => s + l.n, 0),
          nfsMaterial: ls.filter((l) => Number(l.prod) === 0).reduce((s, l) => s + l.n, 0),
          // NF para filial do grupo só grava quando a natureza estiver validada PARA esse destino.
          validada: destino === "filial" ? naturezaValidadaFilial(simplesDoGrupo(g), nat) : naturezaValidada(simplesDoGrupo(g), nat),
          destino,
          porClasse,
          consumidorFinal,
          padroes,
        };
      })
      .sort((a, b) => b.nfs - a.nfs);
  };

  // Uma entrada por filial emissora (a tela procura pelo nome da filial escolhida).
  const dados: CatalogoNotas = {};
  for (const f of filiais) dados[f] = catalogoDoGrupo(grupoDe(f));
  cache.set(empresa, { em: Date.now(), dados });
  return dados;
}

const cacheSobre4 = new Map<EmpresaFat, { em: number; dados: Record<string, boolean> }>();

/**
 * Costume de cada filial emissora para FATURAMENTO.DESCONTO_SOBRE_4: quando o desconto é digitado
 * em % e não há desconto na condição de pagamento, o form do Linx repete o % ali — nas pernas da
 * Scarf Me quase sempre (185 de 189 NFs desde 24/10/2026), na NERD nunca. As pernas do rodízio
 * contam juntas (como no catálogo). Só NFs depois da atualização do Linx de 24/10/2026.
 */
export async function fetchCostumeDescontoSobre4(empresa: EmpresaFat): Promise<Record<string, boolean>> {
  const c = cacheSobre4.get(empresa);
  if (c && Date.now() - c.em < TTL_MS) return c.dados;
  const filiais = await filiaisNotaDaEmpresa(empresa);
  const extras = new Set<string>();
  for (const x of PADROES[empresa].nota.filiaisExtras) {
    const nome = await nameForId(x.codFilial);
    if (nome) extras.add(nome);
  }
  const linhas = await withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    const nomes = filiais.map((f, i) => {
      req.input(`s${i}`, sql.VarChar(25), f);
      return `@s${i}`;
    });
    const r = await req.query(`
      SELECT LTRIM(RTRIM(FILIAL)) AS filial,
             SUM(CASE WHEN ABS(ISNULL(DESCONTO_SOBRE_4, 0) - PORC_DESCONTO) < 0.0001 THEN 1 ELSE 0 END) AS repete,
             COUNT(*) AS n
        FROM FATURAMENTO WITH (NOLOCK)
       WHERE FILIAL IN (${nomes.join(",")}) AND NOTA_CANCELADA = 0 AND DATA_PARA_TRANSFERENCIA >= '2026-10-24'
         AND PORC_DESCONTO_DIGITADO = 1 AND ISNULL(DESCONTO, 0) <> 0 AND ISNULL(DESCONTO_COND_PGTO, 0) = 0
       GROUP BY FILIAL`);
    return r.recordset as { filial: string; repete: number; n: number }[];
  });
  const grupo = (f: string) => (extras.has(f) ? `extra:${f}` : "rodizio");
  const soma = new Map<string, { repete: number; n: number }>();
  for (const l of linhas) {
    const g = soma.get(grupo(l.filial)) ?? { repete: 0, n: 0 };
    g.repete += Number(l.repete);
    g.n += Number(l.n);
    soma.set(grupo(l.filial), g);
  }
  const dados: Record<string, boolean> = {};
  for (const f of filiais) {
    const g = soma.get(grupo(f));
    dados[f] = Boolean(g && g.repete * 2 > g.n);
  }
  cacheSobre4.set(empresa, { em: Date.now(), dados });
  return dados;
}
