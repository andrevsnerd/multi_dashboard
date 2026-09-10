"use client";

import { useMemo, useState } from "react";

import {
  INDICE_MAX,
  INDICE_MIN,
  detalharHorizonte,
  indiceDoModo,
  montarPerfil,
  projetarMesCheio,
  type CriterioMes,
  type MesSerie,
  type ModoProjecao,
  type ParteHorizonte,
} from "@/lib/utils/projecao-realista";
import {
  CRITERIO_TEXTO,
  REGRAS_CURVA,
  REGRA_LABEL,
  type RegraProjecao,
} from "@/lib/utils/projecao-regras";

import styles from "./ProjecaoCompraPage.module.css";

/**
 * Projeção ITEM A ITEM, com os meses em colunas — o mesmo desenho da tabela mensal do
 * escopo, só que uma linha por produto × cor em vez de uma linha para o agregado.
 *
 * A tabela é lida em dois blocos, e é isso que o cabeçalho de dois andares marca:
 *
 *   VENDAS POR MÊS  →  quanto sai (mês fechado = realizado, à frente = projeção)
 *   DECISÃO         →  Vai vender até X − Tem em estoque = Precisa comprar
 *
 * Quando a lista veio de uma COMPRA SALVA entram mais duas: "Na compra" (o que foi pedido)
 * e "Situação", que diz em PALAVRA se falta, sobra ou está no ponto — "+12" obrigaria quem
 * lê a lembrar de que lado é bom.
 *
 * Por que, no caso da compra, as linhas vêm dela e não da consulta de vendas: um item que a
 * compra pediu e que NÃO vendeu nada no período não volta da consulta — e ele é justamente
 * o que se quer enxergar. Sumir da tabela seria esconder o pior caso.
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
  /**
   * Quando MAIS DE UMA compra foi importada, de onde veio cada pedaço da quantidade. Sem
   * isso a soma de duas listas viraria um número sem procedência.
   */
  origens?: Array<{ titulo: string; qtd: number }>;
}

interface Props {
  itens: ItemProjecao[];
  /** Quando veio de uma compra salva, é ela que manda nas linhas. */
  compra?: { title: string; items: ItemCompra[] } | null;
  dataBase: string;
  /** Data alvo ('yyyy-MM-dd') — aparece no cabeçalho da coluna "Vai vender". */
  venderAte: string;
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
function fmtPct(v: number | null, dec = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
}
function fmtDec(n: number | null | undefined, dec = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function ymdToBr(ymd: string): string {
  const [y, m, d] = (ymd ?? "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
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
  meses: Array<{
    mes: string;
    valor: number | null;
    valorAno: number;
    /** Mesmo mês do ano anterior — a base da % que a célula mostra. */
    qtdeAnoAnterior: number;
    /** Variação da célula sobre o mesmo mês do ano anterior. */
    pct: number | null;
    parcial: boolean;
    futuro: boolean;
    criterio: CriterioMes | null;
  }>;
  totalAno: number;
  /** Quanto o item deve vender entre a data base e "Vender até". */
  necessidade: number;
  /** Necessidade − estoque, com piso 0. */
  sugestao: number;
  /** Só quando veio de compra salva. */
  qtdSalva: number | null;
  /** Na compra − Precisa comprar. */
  diferenca: number | null;
  /** Sem série: item da compra que não teve venda no período. */
  semSerie: boolean;
  /** O horizonte aberto mês a mês — é o corpo do tooltip de "Precisa comprar". */
  partes: ParteHorizonte[];
  /** Índice YoY do próprio item (null nas regras de janela ou sem base). */
  indice: number | null;
  /** Quantos meses fechados entraram no índice. */
  mesesFechados: number;
  /** De qual compra veio cada pedaço da Qtd salva (só com várias compras importadas). */
  origens?: Array<{ titulo: string; qtd: number }>;
}

export default function ProjecaoItensMensais({
  itens,
  compra,
  dataBase,
  venderAte,
  diasHorizonte,
  regra,
  carregando,
  omitido,
  maxItens,
}: Props) {
  const anoBase = Number(dataBase.slice(0, 4));
  const modoCurva: ModoProjecao | null = REGRAS_CURVA[regra] ?? null;
  /**
   * Tooltip de "Precisa comprar". Vai posicionado em `fixed` pela coordenada do mouse, e
   * não com um popover dentro da célula: a tabela rola na horizontal e um popover interno
   * seria cortado pelo `overflow` do contêiner.
   */
  const [dica, setDica] = useState<{ x: number; y: number; linha: LinhaItem } | null>(null);

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
      qtdSalva: number | null,
      origens?: Array<{ titulo: string; qtd: number }>
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
        let criterio: CriterioMes | null = null;
        if (curva && modoCurva) {
          const r = projetarMesCheio(perfil, mesNum, modoCurva);
          projetado = perfil.ultimoMesReal >= 1 ? r.valor : null;
          criterio = r.criterio;
        }
        const valorAno = m.futuro
          ? projetado ?? 0
          : m.parcial
          ? Math.max(m.qtde, projetado ?? 0)
          : m.qtde;
        const valor = m.futuro ? projetado : m.parcial ? valorAno : m.qtde;
        return {
          mes: m.mes,
          valor,
          valorAno,
          qtdeAnoAnterior: m.qtdeAnoAnterior,
          // A % é sempre contra o MESMO mês do ano anterior — a mesma régua das outras telas.
          pct: m.qtdeAnoAnterior > 0 && valor != null ? valor / m.qtdeAnoAnterior - 1 : null,
          parcial: m.parcial,
          futuro: m.futuro,
          criterio,
        };
      });

      // Regra de curva: soma mês a mês. Regra de janela: o ritmo medido no item, esticado
      // pelo horizonte — a mesma conta que o KPI do escopo faz, só que por linha.
      const diasJanela = curva ? 0 : Number(regra);
      const consumoJanela = Number(item?.janelas?.[String(diasJanela)] ?? 0) || 0;
      // O horizonte fica ABERTO (mês a mês) para o tooltip poder mostrar de onde veio o
      // número; a soma das parcelas é exatamente o que `projetarHorizonte` devolveria.
      const partes =
        curva && modoCurva && !semSerie
          ? detalharHorizonte(serie, perfil, modoCurva, indice, dataBase, diasHorizonte)
          : [];
      const necessidade = curva
        ? partes.reduce((soma, parte) => soma + parte.parcela, 0)
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
        partes,
        indice: curva ? indice : null,
        mesesFechados: perfil.ultimoMesReal,
        origens,
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
          Math.max(0, Math.round(c.qtdManual ?? 0)),
          c.origens
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
    const comFalta = linhas.filter((l) => (l.diferenca ?? 0) < 0);
    return {
      porMes: Array.from({ length: 12 }, (_, i) =>
        linhas.reduce((s, l) => s + (l.meses[i]?.valorAno ?? 0), 0)
      ),
      totalAno: linhas.reduce((s, l) => s + l.totalAno, 0),
      estoque: linhas.reduce((s, l) => s + l.estoque, 0),
      necessidade: linhas.reduce((s, l) => s + l.necessidade, 0),
      sugestao: linhas.reduce((s, l) => s + l.sugestao, 0),
      qtdSalva: compra ? linhas.reduce((s, l) => s + (l.qtdSalva ?? 0), 0) : null,
      /** Quantos itens da compra ficaram ABAIXO do sugerido. */
      itensComFalta: comFalta.length,
      /** Peças faltando somando só quem está curto — sobra de um não cobre falta de outro. */
      pecasFaltando: comFalta.reduce((s, l) => s - (l.diferenca ?? 0), 0),
      semSerie: linhas.filter((l) => l.semSerie).length,
    };
  }, [linhas, compra]);

  if (omitido) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Itens por mês</span>
        </div>
        <div className={styles.tabelaNota}>
          O recorte tem mais de {fmt(maxItens ?? 400)} itens — a projeção item a item não foi
          calculada. Reduza o escopo (ou importe uma compra salva) para ver a tabela.
        </div>
      </div>
    );
  }

  const colunas = 16 + (compra ? 2 : 0);
  const ateLabel = ymdToBr(venderAte);

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
            <span className={`${styles.dot} ${styles.dotProj}`} />
            projetado
          </span>
        </div>
      </div>

      {/* A conta inteira em uma linha: sem isto "Precisa comprar" parece número mágico. */}
      <div className={styles.tabelaNota}>
        Os meses mostram <strong>quanto vende</strong> — mês fechado é o realizado, à frente é
        projeção. A <strong>%</strong> compara sempre com o <strong>mesmo mês de {anoBase - 1}</strong>;
        onde ela não aparece é porque o item não vendeu nada naquele mês do ano passado, então
        não há com o que comparar. Depois vem a decisão:{" "}
        <strong>Vai vender até {ateLabel}</strong> − <strong>Tem em estoque</strong> ={" "}
        <strong>Precisa comprar</strong>.
        {compra ? (
          <>
            {" "}
            <strong>Na compra</strong> é o que você salvou; <strong>Situação</strong> compara os
            dois.
          </>
        ) : null}
        {totais.semSerie > 0 ? (
          <>
            {" · "}
            {fmt(totais.semSerie)}{" "}
            {totais.semSerie === 1 ? "item sem venda" : "itens sem venda"} no período
          </>
        ) : null}
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.mensalTable} ${styles.itensTable}`}>
          <thead>
            <tr>
              <th className={`${styles.thLeft} ${styles.stickyCol}`} rowSpan={2}>
                Item
              </th>
              <th colSpan={13} className={styles.grupoHead}>
                Vendas por mês — {anoBase}
              </th>
              <th colSpan={compra ? 5 : 3} className={`${styles.grupoHead} ${styles.grupoDecisao}`}>
                Decisão de compra
              </th>
            </tr>
            <tr>
              {MES_NOME.map((nome) => (
                <th key={nome}>{nome}</th>
              ))}
              <th className={styles.colTotal}>Total</th>
              <th
                className={styles.colDecisao}
                title={`Projeção de venda da data base até ${ateLabel}`}
              >
                Vai vender
                <span className={styles.thSub}>até {ateLabel}</span>
              </th>
              <th className={styles.colDecisao} title="Estoque atual da rede (só saldos positivos)">
                Tem
                <span className={styles.thSub}>em estoque</span>
              </th>
              <th className={styles.colDecisao} title="Vai vender − Tem em estoque (nunca negativo)">
                Precisa
                <span className={styles.thSub}>comprar</span>
              </th>
              {compra ? (
                <th className={styles.colDecisao} title="Quantidade que está na compra salva">
                  Na compra
                  <span className={styles.thSub}>salva</span>
                </th>
              ) : null}
              {compra ? (
                <th className={styles.colDecisao} title="Na compra − Precisa comprar">
                  Situação
                </th>
              ) : null}
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
                  {l.meses.map((m) => {
                    const valor = m.valor == null ? null : Math.round(m.valor);
                    return (
                      <td
                        key={m.mes}
                        className={`${styles.num} ${styles.cellMes} ${
                          m.futuro ? styles.cellProj : m.parcial ? styles.cellParcial : ""
                        }`}
                      >
                        {/* Zero vira um ponto apagado: numa tabela esparsa, a parede de
                            "0" esconde os números que importam. */}
                        <span className={`${styles.cellQtd} ${!valor ? styles.zero : ""}`}>
                          {valor == null ? "—" : valor === 0 ? "·" : fmt(valor)}
                        </span>
                        {/* Sem venda no mesmo mês de {anoBase-1} não existe comparação —
                            então a célula fica VAZIA em vez de mostrar um "—", que só
                            chamava atenção para um valor que não tem o que dizer. */}
                        {m.pct == null ? (
                          <span className={styles.cellPct} aria-hidden="true" />
                        ) : (
                          <span
                            className={`${styles.cellPct} ${
                              m.pct >= 0 ? styles.varUp : styles.varDown
                            }`}
                            title={`${fmt(m.qtdeAnoAnterior)} un no mesmo mês de ${anoBase - 1}`}
                          >
                            {fmtPct(m.pct)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className={`${styles.num} ${styles.colTotal}`}>
                    <span className={styles.cellQtd}>{fmt(Math.round(l.totalAno))}</span>
                  </td>
                  <td className={`${styles.num} ${styles.colDecisao}`}>
                    {fmt(Math.round(l.necessidade))}
                  </td>
                  <td className={`${styles.num} ${styles.colDecisao}`}>{fmt(l.estoque)}</td>
                  <td
                    className={`${styles.num} ${styles.colDecisao} ${styles.colPrecisa} ${styles.temDica}`}
                    onMouseEnter={(e) => setDica({ x: e.clientX, y: e.clientY, linha: l })}
                    onMouseMove={(e) => setDica({ x: e.clientX, y: e.clientY, linha: l })}
                    onMouseLeave={() => setDica(null)}
                  >
                    {fmt(l.sugestao)}
                  </td>
                  {compra ? (
                    <td className={`${styles.num} ${styles.colDecisao}`}>{fmt(l.qtdSalva ?? 0)}</td>
                  ) : null}
                  {compra ? (
                    <td className={`${styles.num} ${styles.colDecisao}`}>
                      <Situacao
                        diferenca={l.diferenca}
                        qtdSalva={l.qtdSalva}
                        sugestao={l.sugestao}
                      />
                    </td>
                  ) : null}
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
                {totais.porMes.map((valor, i) => (
                  <td key={MES_NOME[i]} className={`${styles.num} ${styles.cellMes}`}>
                    <span className={styles.cellQtd}>{fmt(Math.round(valor))}</span>
                  </td>
                ))}
                <td className={`${styles.num} ${styles.colTotal}`}>
                  <span className={styles.cellQtd}>{fmt(Math.round(totais.totalAno))}</span>
                </td>
                <td className={`${styles.num} ${styles.colDecisao}`}>
                  {fmt(Math.round(totais.necessidade))}
                </td>
                <td className={`${styles.num} ${styles.colDecisao}`}>{fmt(totais.estoque)}</td>
                <td className={`${styles.num} ${styles.colDecisao} ${styles.colPrecisa}`}>
                  {fmt(totais.sugestao)}
                </td>
                {compra ? (
                  <td className={`${styles.num} ${styles.colDecisao}`}>
                    {fmt(totais.qtdSalva ?? 0)}
                  </td>
                ) : null}
                {compra ? (
                  <td className={`${styles.num} ${styles.colDecisao}`}>
                    {/* Somar as diferenças com sinal mentiria: sobra de um item não cobre a
                        falta de outro. O agregado honesto é quantos itens estão curtos. */}
                    {totais.itensComFalta === 0 ? (
                      <span className={`${styles.situacao} ${styles.sitOk}`}>tudo coberto</span>
                    ) : (
                      <span
                        className={`${styles.situacao} ${styles.sitFalta}`}
                        title={`${fmt(totais.pecasFaltando)} peças a menos que o sugerido, somando só os itens curtos`}
                      >
                        {fmt(totais.itensComFalta)}{" "}
                        {totais.itensComFalta === 1 ? "item curto" : "itens curtos"}
                      </span>
                    )}
                  </td>
                ) : null}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {dica && (
        <DicaCompra
          dica={dica}
          regra={regra}
          anoBase={anoBase}
          ateLabel={ateLabel}
          diasHorizonte={diasHorizonte}
        />
      )}
    </div>
  );
}

/**
 * O que entrou na conta de "Precisa comprar", desta linha.
 *
 * Foi encurtado de propósito (a primeira versão virou um painel de vinte linhas que ninguém
 * lia): a pergunta é "o que está sendo considerado nesta compra", e a resposta são TRÊS
 * números — o que vai vender, o que já tem, e a diferença. Os meses que formam a projeção
 * vêm numa linha só, e a regra em uma frase. O detalhamento completo da régua fica no bloco
 * "Como a projeção é calculada", no topo da tela.
 */
function DicaCompra({
  dica,
  regra,
  anoBase,
  ateLabel,
  diasHorizonte,
}: {
  dica: { x: number; y: number; linha: LinhaItem };
  regra: RegraProjecao;
  anoBase: number;
  ateLabel: string;
  diasHorizonte: number;
}) {
  const l = dica.linha;
  const curva = REGRAS_CURVA[regra] != null;

  // Posiciona junto ao ponteiro, sem sair da janela.
  const largura = 340;
  const altura = 250;
  const margem = 12;
  const janelaW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const janelaH = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(Math.max(margem, dica.x + 16), Math.max(margem, janelaW - largura - margem));
  const topAcima = dica.y - altura - 16;
  const top =
    topAcima > margem
      ? topAcima
      : Math.min(dica.y + 16, Math.max(margem, janelaH - altura - margem));

  /** Os meses do horizonte numa linha só: "set 31 (21d) + out 38 + nov 22 + dez 18". */
  const somaMeses = l.partes
    .map((parte) => {
      const rotulo = MES_NOME[parte.mes - 1];
      const valor = fmt(Math.round(parte.parcela));
      const parcial = parte.diasUsados < parte.diasDoMes;
      return parcial ? `${rotulo} ${valor} (${parte.diasUsados}d)` : `${rotulo} ${valor}`;
    })
    .join(" + ");

  /** Um mês do horizonte não veio da curva do ano anterior — vale dizer qual foi o desvio. */
  const criterioFora = l.meses.find(
    (m) => (m.futuro || m.parcial) && m.criterio && m.criterio !== "yoy"
  )?.criterio;

  const noLimite =
    l.indice != null && (l.indice >= INDICE_MAX || l.indice <= INDICE_MIN)
      ? l.indice >= INDICE_MAX
        ? "travado no teto de 2,00×"
        : "travado no piso de 0,30×"
      : null;

  return (
    <div className={styles.dicaPainel} style={{ left, top, width: largura }}>
      <div className={styles.dicaItem}>{l.rotulo}</div>

      <div className={styles.dicaConta}>
        <div className={styles.dicaLinha}>
          <span>Vai vender até {ateLabel}</span>
          <span>{fmt(Math.round(l.necessidade))}</span>
        </div>
        <div className={styles.dicaLinha}>
          <span>Já tem em estoque</span>
          <span>− {fmt(l.estoque)}</span>
        </div>
        <div className={`${styles.dicaLinha} ${styles.dicaTotal}`}>
          <span>Precisa comprar</span>
          <span>
            <strong>{fmt(l.sugestao)} un</strong>
          </span>
        </div>
      </div>

      {l.semSerie ? (
        <div className={styles.dicaNota}>
          Este item <strong>não vendeu nada</strong> no período, então não há o que projetar — a
          sugestão fica em 0 e a quantidade da compra é decisão sua.
        </div>
      ) : curva ? (
        <div className={styles.dicaNota}>
          {somaMeses ? (
            <>
              Os {fmt(Math.round(l.necessidade))} vêm de <strong>{somaMeses}</strong>. Cada mês é o
              que este item vendeu no mesmo mês de {anoBase - 1}
              {l.indice != null ? (
                <>
                  , × <strong>{fmtDec(l.indice)}</strong>
                </>
              ) : null}
              .{noLimite ? ` Índice ${noLimite}.` : ""}
            </>
          ) : (
            "Sem meses fechados no ano, a curva não tem de onde sair."
          )}
          {criterioFora ? ` ${CRITERIO_TEXTO[criterioFora]}.` : ""}
        </div>
      ) : (
        <div className={styles.dicaNota}>
          {REGRA_LABEL[regra]}: o que saiu nos últimos {regra} dias, esticado para os{" "}
          {fmt(diasHorizonte)} dias do horizonte. <strong>Sem sazonalidade.</strong>
        </div>
      )}

      {l.estoque > l.necessidade ? (
        <div className={styles.dicaNota}>
          O estoque já cobre o período, com {fmt(Math.round(l.estoque - l.necessidade))} un de
          folga.
        </div>
      ) : null}

      {l.qtdSalva != null ? (
        <>
          <div className={styles.dicaDivisor} />
          <div className={styles.dicaLinha}>
            <span>Na compra salva</span>
            <span>
              <strong>{fmt(l.qtdSalva)} un</strong>
            </span>
          </div>
          {/* Com várias compras importadas, de onde veio cada pedaço da soma. */}
          {(l.origens ?? []).map((o, i) => (
            <div key={`${o.titulo}-${i}`} className={styles.dicaLinha}>
              <span className={styles.dicaFraco}>{o.titulo}</span>
              <span className={styles.dicaFraco}>{fmt(o.qtd)}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

/**
 * O veredito da linha em PALAVRA, não em número com sinal: "+12" obriga quem lê a lembrar
 * de que lado é bom. Falta é o único que exige ação, então é o único em vermelho.
 */
function Situacao({
  diferenca,
  qtdSalva,
  sugestao,
}: {
  diferenca: number | null;
  qtdSalva: number | null;
  sugestao: number;
}) {
  if (diferenca == null) return <span className={styles.muted}>—</span>;
  const detalhe = `Precisa comprar ${fmt(sugestao)} · na compra ${fmt(qtdSalva ?? 0)}`;

  if (diferenca < 0) {
    return (
      <span className={`${styles.situacao} ${styles.sitFalta}`} title={detalhe}>
        faltam {fmt(-diferenca)}
      </span>
    );
  }
  if (diferenca > 0) {
    // Sem sugestão nenhuma, comprar não é "sobra" — é uma aposta de quem comprou.
    const rotulo = sugestao === 0 ? `extra ${fmt(diferenca)}` : `sobram ${fmt(diferenca)}`;
    return (
      <span className={`${styles.situacao} ${styles.sitSobra}`} title={detalhe}>
        {rotulo}
      </span>
    );
  }
  return (
    <span className={`${styles.situacao} ${styles.sitOk}`} title={detalhe}>
      no ponto
    </span>
  );
}
