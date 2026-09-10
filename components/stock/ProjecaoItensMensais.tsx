"use client";

import { useMemo } from "react";

import {
  indiceDoModo,
  montarPerfil,
  projetarHorizonte,
  projetarMesCheio,
  type MesSerie,
  type ModoProjecao,
} from "@/lib/utils/projecao-realista";
import { REGRAS_CURVA, REGRA_LABEL, type RegraProjecao } from "@/lib/utils/projecao-regras";

import styles from "./ProjecaoCompraPage.module.css";

/**
 * Projeção ITEM A ITEM, com os meses em colunas — o mesmo desenho da tabela mensal do
 * escopo, só que uma linha por produto × cor em vez de uma linha para o agregado.
 *
 * Serve a dois usos:
 *   - conferir um recorte item a item, quando o total do escopo esconde quem está puxando;
 *   - avaliar uma COMPRA SALVA: ali a lista de linhas vem da compra (não das vendas), e as
 *     colunas "Qtd salva" e "Diferença" dizem se o que foi pedido cobre a projeção.
 *
 * Por que as linhas vêm da compra e não da consulta, nesse segundo caso: um item que a
 * compra pediu e que NÃO vendeu nada no período não volta da consulta de vendas — e ele é
 * justamente o que se quer enxergar. Some da tabela seria esconder o pior caso.
 */

const MES_NOME = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export interface ItemProjecao {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  codigoBarra: string;
  grade: string;
  estoque?: number;
  mensal?: MesSerie[];
  /** Consumo nas janelas de N dias — usado pelas regras "Ritmo N dias". */
  janelas?: Record<string, number>;
}

/** Um item da compra salva importada. */
export interface ItemCompra {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  qtdManual: number;
  custoUnitario?: number;
}

interface Props {
  itens: ItemProjecao[];
  /** Quando veio de uma compra salva, é ela que manda nas linhas. */
  compra?: { title: string; items: ItemCompra[] } | null;
  dataBase: string;
  diasHorizonte: number;
  regra: RegraProjecao;
  carregando?: boolean;
  /** Escopo grande demais: o servidor não mandou o detalhe mensal. */
  omitido?: boolean;
  maxItens?: number;
}

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function chave(produto: string, cor: string | null | undefined): string {
  return `${(produto ?? "").trim()}||${(cor ?? "").trim()}`;
}

/**
 * Segunda chave, com o código de cor sem zero à esquerda. O Linx devolve a mesma cor ora
 * como '06' ora como '6' conforme a fonte, e casar só por string perderia a linha —
 * ver [[cor-produto-formato-duas-fontes]].
 */
function chaveFrouxa(produto: string, cor: string | null | undefined): string {
  const c = (cor ?? "").trim();
  const numero = Number(c);
  const normal = c !== "" && Number.isFinite(numero) ? String(numero) : c.toUpperCase();
  return `${(produto ?? "").trim()}||${normal}`;
}

interface LinhaItem {
  key: string;
  produto: string;
  cor: string;
  rotulo: string;
  detalhe: string;
  estoque: number;
  /** Valor por mês: realizado no mês fechado, projeção no resto. */
  meses: Array<{ mes: string; valor: number | null; valorAno: number; parcial: boolean; futuro: boolean }>;
  totalAno: number;
  /** Consumo projetado entre a data base e "Vender até". */
  necessidade: number;
  sugestao: number;
  /** Só quando veio de compra salva. */
  qtdSalva: number | null;
  /** Quanto a compra salva passa (ou falta) do sugerido. */
  diferenca: number | null;
  /** Sem série: item da compra que não teve venda no período. */
  semSerie: boolean;
}

export default function ProjecaoItensMensais({
  itens,
  compra,
  dataBase,
  diasHorizonte,
  regra,
  carregando,
  omitido,
  maxItens,
}: Props) {
  const anoBase = Number(dataBase.slice(0, 4));
  const modoCurva: ModoProjecao | null = REGRAS_CURVA[regra] ?? null;

  const linhas: LinhaItem[] = useMemo(() => {
    const porChave = new Map(itens.map((i) => [chave(i.produto, i.cor), i]));
    const porChaveFrouxa = new Map(itens.map((i) => [chaveFrouxa(i.produto, i.cor), i]));

    /** Monta a linha a partir da série de vendas (que pode não existir). */
    const montar = (
      key: string,
      produto: string,
      cor: string,
      rotulo: string,
      detalhe: string,
      qtdSalva: number | null
    ): LinhaItem => {
      const item = porChave.get(key) ?? porChaveFrouxa.get(chaveFrouxa(produto, cor));
      const serie = item?.mensal ?? [];
      const estoque = Math.max(0, Number(item?.estoque ?? 0) || 0);
      const semSerie = serie.length === 0;

      const perfil = montarPerfil(serie);
      const indice = modoCurva ? indiceDoModo(perfil, modoCurva) : perfil.indice;
      const curva = modoCurva !== null;

      const meses = (
        semSerie
          ? Array.from({ length: 12 }, (_, i) => ({
              mes: `${anoBase}-${String(i + 1).padStart(2, "0")}`,
              qtde: 0,
              qtdeAnoAnterior: 0,
              parcial: false,
              futuro: false,
            }))
          : serie
      ).map((m) => {
        const mesNum = Number(m.mes.slice(5, 7));
        let projetado: number | null = null;
        if (curva && modoCurva) {
          const r = projetarMesCheio(perfil, mesNum, modoCurva);
          projetado = perfil.ultimoMesReal >= 1 ? r.valor : null;
        }
        const valorAno = m.futuro
          ? projetado ?? 0
          : m.parcial
          ? Math.max(m.qtde, projetado ?? 0)
          : m.qtde;
        return {
          mes: m.mes,
          valor: m.futuro ? projetado : m.parcial ? valorAno : m.qtde,
          valorAno,
          parcial: m.parcial,
          futuro: m.futuro,
        };
      });

      // Regra de curva: soma mês a mês. Regra de janela: o ritmo medido no item, esticado
      // pelo horizonte — a mesma conta que o KPI do escopo faz, só que por linha.
      const diasJanela = curva ? 0 : Number(regra);
      const consumoJanela = Number(item?.janelas?.[String(diasJanela)] ?? 0) || 0;
      const necessidade = curva
        ? modoCurva && !semSerie
          ? projetarHorizonte(serie, perfil, modoCurva, indice, dataBase, diasHorizonte)
          : 0
        : diasJanela > 0
        ? (consumoJanela / diasJanela) * diasHorizonte
        : 0;
      const sugestao = Math.max(0, Math.ceil(necessidade - estoque));

      return {
        key,
        produto,
        cor,
        rotulo,
        detalhe,
        estoque,
        meses,
        totalAno: meses.reduce((s, m) => s + m.valorAno, 0),
        necessidade,
        sugestao,
        qtdSalva,
        diferenca: qtdSalva == null ? null : qtdSalva - sugestao,
        semSerie,
      };
    };

    if (compra) {
      // A compra manda: cada item dela vira uma linha, tenha vendido ou não.
      return compra.items.map((c) =>
        montar(
          chave(c.produto, c.cor),
          c.produto,
          c.cor,
          c.descricao || c.produto,
          [c.produto, c.corDescricao || c.cor].filter(Boolean).join(" · "),
          Math.max(0, Math.round(c.qtdManual ?? 0))
        )
      );
    }

    return itens.map((i) =>
      montar(
        chave(i.produto, i.cor),
        i.produto,
        i.cor,
        i.descricao || i.produto,
        [i.produto, i.corDescricao || i.cor, i.grade].filter(Boolean).join(" · "),
        null
      )
    );
  }, [itens, compra, modoCurva, regra, dataBase, diasHorizonte, anoBase]);

  const totais = useMemo(() => {
    return {
      porMes: Array.from({ length: 12 }, (_, i) =>
        linhas.reduce((s, l) => s + (l.meses[i]?.valorAno ?? 0), 0)
      ),
      totalAno: linhas.reduce((s, l) => s + l.totalAno, 0),
      estoque: linhas.reduce((s, l) => s + l.estoque, 0),
      sugestao: linhas.reduce((s, l) => s + l.sugestao, 0),
      qtdSalva: compra ? linhas.reduce((s, l) => s + (l.qtdSalva ?? 0), 0) : null,
      diferenca: compra ? linhas.reduce((s, l) => s + (l.diferenca ?? 0), 0) : null,
      semSerie: linhas.filter((l) => l.semSerie).length,
    };
  }, [linhas, compra]);

  if (omitido) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Itens por mês</span>
        </div>
        <div className={styles.emptyText} style={{ padding: "12px 16px 18px" }}>
          O recorte tem mais de {fmt(maxItens ?? 400)} itens — a projeção item a item não foi
          calculada. Reduza o escopo (ou importe uma compra salva) para ver a tabela.
        </div>
      </div>
    );
  }

  const colunas = 15 + (compra ? 2 : 0);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>
          {compra ? `Compra salva · ${compra.title}` : "Itens por mês"} · {anoBase} ·{" "}
          {REGRA_LABEL[regra]}
        </span>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={`${styles.dot} ${styles.dotReal}`} />
            realizado
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.dot} ${styles.dotParcial}`} />
            mês em curso
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.dot} ${styles.dotProj}`} />
            projetado
          </span>
        </div>
        {totais.semSerie > 0 && (
          <span className={styles.embAviso}>
            {fmt(totais.semSerie)} {totais.semSerie === 1 ? "item sem venda" : "itens sem venda"} no
            período
          </span>
        )}
      </div>
      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.mensalTable} ${styles.itensTable}`}>
          <thead>
            <tr>
              <th className={`${styles.thLeft} ${styles.stickyCol}`}>Item</th>
              <th>Estoque</th>
              {MES_NOME.map((nome) => (
                <th key={nome}>{nome}</th>
              ))}
              <th className={styles.colTotal}>Total {anoBase}</th>
              {compra && <th>Qtd salva</th>}
              <th>Sugerido</th>
              {compra && <th>Diferença</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td className={`${styles.tdLeft} ${styles.stickyCol}`} colSpan={colunas}>
                  <span className={styles.muted}>
                    {carregando ? "Carregando…" : "Nenhum item no recorte."}
                  </span>
                </td>
              </tr>
            ) : (
              linhas.map((l) => (
                <tr key={l.key}>
                  <td className={`${styles.tdLeft} ${styles.stickyCol}`}>
                    <span className={styles.itemNome}>{l.rotulo}</span>
                    <span className={styles.itemMeta}>{l.detalhe}</span>
                  </td>
                  <td className={styles.num}>{fmt(l.estoque)}</td>
                  {l.meses.map((m) => (
                    <td
                      key={m.mes}
                      className={`${styles.num} ${styles.cellMes} ${
                        m.futuro ? styles.cellProj : m.parcial ? styles.cellParcial : ""
                      }`}
                    >
                      <span className={styles.cellQtd}>
                        {m.valor == null ? "—" : fmt(Math.round(m.valor))}
                      </span>
                    </td>
                  ))}
                  <td className={`${styles.num} ${styles.colTotal}`}>
                    <span className={styles.cellQtd}>{fmt(Math.round(l.totalAno))}</span>
                  </td>
                  {compra && <td className={styles.num}>{fmt(l.qtdSalva ?? 0)}</td>}
                  <td className={`${styles.num} ${l.sugestao > 0 ? styles.embComprar : ""}`}>
                    {fmt(l.sugestao)}
                  </td>
                  {compra && (
                    <td
                      className={`${styles.num} ${
                        l.diferenca == null
                          ? ""
                          : l.diferenca < 0
                          ? styles.varDown
                          : l.diferenca > 0
                          ? styles.varUp
                          : styles.muted
                      }`}
                      title={
                        l.diferenca == null
                          ? ""
                          : l.diferenca < 0
                          ? "A compra salva está abaixo do sugerido"
                          : l.diferenca > 0
                          ? "A compra salva passa do sugerido"
                          : "A compra salva bate com o sugerido"
                      }
                    >
                      {l.diferenca == null ? "—" : `${l.diferenca > 0 ? "+" : ""}${fmt(l.diferenca)}`}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {linhas.length > 0 && (
            <tfoot>
              <tr>
                <td className={`${styles.tdLeft} ${styles.stickyCol}`}>
                  Total · {fmt(linhas.length)} {linhas.length === 1 ? "item" : "itens"}
                </td>
                <td className={styles.num}>{fmt(totais.estoque)}</td>
                {totais.porMes.map((valor, i) => (
                  <td key={MES_NOME[i]} className={`${styles.num} ${styles.cellMes}`}>
                    <span className={styles.cellQtd}>{fmt(Math.round(valor))}</span>
                  </td>
                ))}
                <td className={`${styles.num} ${styles.colTotal}`}>
                  <span className={styles.cellQtd}>{fmt(Math.round(totais.totalAno))}</span>
                </td>
                {compra && <td className={styles.num}>{fmt(totais.qtdSalva ?? 0)}</td>}
                <td className={styles.num}>{fmt(totais.sugestao)}</td>
                {compra && (
                  <td
                    className={`${styles.num} ${
                      (totais.diferenca ?? 0) < 0 ? styles.varDown : styles.varUp
                    }`}
                  >
                    {(totais.diferenca ?? 0) > 0 ? "+" : ""}
                    {fmt(totais.diferenca ?? 0)}
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
