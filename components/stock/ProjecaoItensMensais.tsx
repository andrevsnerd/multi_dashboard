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
  curvaNeutra,
  detalharHorizonteSazonal,
  montarPerfilSazonal,
  projetarMesSazonal,
  type CurvaSazonal,
} from "@/lib/utils/projecao-sazonal";
import {
  CRITERIO_TEXTO,
  REGRAS_CURVA,
  REGRA_LABEL,
  ehRegraCompraIdeal,
  ehRegraSazonalCategoria,
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
  /** Peças já compradas e a caminho — abatidas da sugestão, igual à Curva ABC. */
  transito?: number;
  /**
   * A linha existe SÓ por causa do trânsito: peça já comprada, de uma cor que nunca vendeu
   * e não tem saldo. Sem ela a tabela escondia justamente o item que mais interessa ver, e
   * o rodapé da coluna de trânsito fechava abaixo do total da faixa do topo.
   */
  soTransito?: boolean;
  /** Chegada mais próxima do trânsito deste item ('yyyy-MM-dd'). */
  chegada?: string;
  /** Chave da categoria do item na curva sazonal. */
  categoria?: string;
  mensal?: MesSerie[];
  /** Consumo nas janelas de N dias — usado pelas regras "Ritmo N dias". */
  janelas?: Record<string, number>;
  /** Consumo/dia pela régua da Compra Ideal — usado pela regra "Ritmo Compra Ideal". */
  consumoIdeal?: number;
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
  /**
   * Curvas sazonais por categoria, quando a projeção foi gerada com elas. Cada item usa a
   * curva da SUA categoria: numa compra que mistura lenço e twilly, os dois têm dezembros
   * diferentes e projetar os dois pela mesma curva erraria os dois.
   */
  curvasSazonais?: Record<string, CurvaSazonal> | null;
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
function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
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
  /** Peças já compradas e a caminho. */
  transito: number;
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
  /** Consumo/dia que a regra escolhida usou. */
  ritmoDia: number;
  /** Regra "Ritmo Compra Ideal" escolhida mas o item não tem métrica de disponibilidade. */
  semRitmoIdeal: boolean;
  /** Só quando veio de compra salva. */
  qtdSalva: number | null;
  /** Na compra − Precisa comprar. */
  diferenca: number | null;
  /** Sem série: item da compra que não teve venda no período. */
  semSerie: boolean;
  /** O horizonte aberto mês a mês — é o corpo do tooltip de "Precisa comprar". */
  partes: ParteHorizonte[];
  /** Patamar dessazonalizado do item (só na regra sazonal). */
  patamarSazonal: number | null;
  /** Curva da categoria que projetou esta linha (só na regra sazonal). */
  curvaSazonal: CurvaSazonal | null;
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
  curvasSazonais,
  carregando,
  omitido,
  maxItens,
}: Props) {
  const anoBase = Number(dataBase.slice(0, 4));
  const modoCurva: ModoProjecao | null = REGRAS_CURVA[regra] ?? null;
  const ehSazonal = ehRegraSazonalCategoria(regra);
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
      const transito = Math.max(0, Number(item?.transito ?? 0) || 0);
      const semSerie = serie.length === 0;

      const perfil = montarPerfil(serie);
      const indice = modoCurva ? indiceDoModo(perfil, modoCurva) : perfil.indice;
      const curva = modoCurva !== null;

      // Curva da CATEGORIA do item (não a dele) — é ela que carrega Nov/Dez.
      const curvaItem =
        (curvasSazonais && item?.categoria ? curvasSazonais[item.categoria] : null) ??
        (curvasSazonais ? curvasSazonais["__ESCOPO__"] : null) ??
        curvaNeutra("__ESCOPO__");
      const perfilSaz = montarPerfilSazonal(serie, curvaItem);

      // ── Ritmo/dia das regras que NÃO usam a curva do ano anterior ──
      const ehIdeal = ehRegraCompraIdeal(regra);
      const consumoIdeal = Number(item?.consumoIdeal);
      const temIdeal = Number.isFinite(consumoIdeal) && consumoIdeal >= 0;
      /** Janela em dias da regra "Ritmo N dias" (0 nas outras). */
      const diasJanela = curva || ehIdeal ? 0 : Number(regra);
      const consumoJanela = Number(item?.janelas?.[String(diasJanela)] ?? 0) || 0;
      const ritmoDia = ehIdeal
        ? temIdeal
          ? consumoIdeal
          : 0
        : diasJanela > 0
        ? consumoJanela / diasJanela
        : 0;

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
        if (ehSazonal) {
          projetado =
            perfilSaz.ultimoMesReal >= 1 && !semSerie
              ? projetarMesSazonal(perfilSaz, curvaItem, mesNum)
              : null;
          criterio = perfilSaz.ativa ? "sazonal" : "parado";
        } else if (curva && modoCurva) {
          const r = projetarMesCheio(perfil, mesNum, modoCurva);
          projetado = perfil.ultimoMesReal >= 1 ? r.valor : null;
          criterio = r.criterio;
        } else if (!semSerie || ehIdeal) {
          // Sem sazonalidade: o mês vale o ritmo/dia × os dias daquele mês.
          projetado = ritmoDia * diasNoMes(anoBase, mesNum);
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

      // O horizonte fica ABERTO (mês a mês) para o tooltip poder mostrar de onde veio o
      // número; a soma das parcelas é exatamente o que `projetarHorizonte` devolveria.
      const partes = semSerie
        ? []
        : ehSazonal
        ? detalharHorizonteSazonal(perfilSaz, curvaItem, dataBase, diasHorizonte).map((parte) => ({
            ano: parte.ano,
            mes: parte.mes,
            mesCheio: parte.mesCheio,
            diasUsados: parte.diasUsados,
            diasDoMes: parte.diasDoMes,
            parcela: parte.parcela,
          }))
        : curva && modoCurva
        ? detalharHorizonte(serie, perfil, modoCurva, indice, dataBase, diasHorizonte)
        : [];
      // Regras que somam mês a mês (as duas curvas e a sazonal) usam as parcelas; as de
      // janela e a régua da Compra Ideal esticam o ritmo/dia.
      const necessidade =
        curva || ehSazonal
          ? partes.reduce((soma, parte) => soma + parte.parcela, 0)
          : ritmoDia * diasHorizonte;
      // O trânsito entra aqui pelo mesmo motivo da Curva ABC: peça já comprada não se
      // compra de novo. Sem isso a tela mandaria repetir o pedido que está a caminho.
      const sugestao = Math.max(0, Math.ceil(necessidade - estoque - transito));

      return {
        key,
        produto,
        cor,
        rotulo,
        detalhe,
        estoque,
        transito,
        meses,
        totalAno: meses.reduce((s, m) => s + m.valorAno, 0),
        necessidade,
        sugestao,
        ritmoDia,
        semRitmoIdeal: ehIdeal && !temIdeal,
        qtdSalva,
        diferenca: qtdSalva == null ? null : qtdSalva - sugestao,
        semSerie,
        partes,
        indice: curva ? indice : null,
        patamarSazonal: ehSazonal ? perfilSaz.patamar : null,
        curvaSazonal: ehSazonal ? curvaItem : null,
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
        [
          i.produto,
          i.corDescricao || i.cor,
          i.grade,
          // Item que só existe na lista por causa do trânsito: a data de chegada é a
          // informação que justifica ele estar ali.
          i.soTransito && i.chegada ? `chega ${ymdToBr(i.chegada)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        null
      )
    );
  }, [itens, compra, modoCurva, ehSazonal, curvasSazonais, regra, dataBase, diasHorizonte, anoBase]);

  const totais = useMemo(() => {
    const comFalta = linhas.filter((l) => (l.diferenca ?? 0) < 0);
    return {
      porMes: Array.from({ length: 12 }, (_, i) =>
        linhas.reduce((s, l) => s + (l.meses[i]?.valorAno ?? 0), 0)
      ),
      totalAno: linhas.reduce((s, l) => s + l.totalAno, 0),
      estoque: linhas.reduce((s, l) => s + l.estoque, 0),
      transito: linhas.reduce((s, l) => s + l.transito, 0),
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
          {/* A nota virou faixa de fragmentos: texto solto aqui dentro viraria item de flex
              anônimo e perderia o espaçamento. */}
          <span className={styles.notaItem}>
            Mais de {fmt(maxItens ?? 400)} itens no recorte — a tabela item a item não foi
            calculada. Reduza o escopo ou importe uma compra salva.
          </span>
        </div>
      </div>
    );
  }

  const colunas = 17 + (compra ? 2 : 0);
  const ateLabel = ymdToBr(venderAte);
  /** Sem o ano: a tabela inteira é do ano da data base, e o cabeçalho é estreito. */
  const ateCurto = ateLabel.slice(0, 5);

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

      {/* Um parágrafo só, com meses + % + a conta + as colunas da compra, obrigava a ler
          tudo para achar uma coisa. Vira fragmento curto com rótulo em negrito. */}
      <div className={styles.tabelaNota}>
        <span className={styles.notaItem}>
          <strong>Meses:</strong> fechado = vendido, à frente = projeção
          {ehRegraSazonalCategoria(regra)
            ? " (patamar do item × curva da categoria)"
            : ehRegraCompraIdeal(regra)
            ? " (ritmo da Compra Ideal, sem sazonalidade)"
            : ""}
        </span>
        <span className={styles.notaItem}>
          <strong>%:</strong> contra o mesmo mês de {anoBase - 1} — vazio = não vendeu lá
        </span>
        <span className={styles.notaItem}>
          <strong>Decisão:</strong> Vai vender − Estoque − Trânsito = Precisa comprar
        </span>
        {compra ? (
          <span className={styles.notaItem}>
            <strong>Compra salva:</strong> Trânsito conta só compras <em>diferentes</em> desta
            lista
          </span>
        ) : null}
        {totais.semSerie > 0 ? (
          <span className={styles.notaItem}>
            <strong>{fmt(totais.semSerie)}</strong>{" "}
            {totais.semSerie === 1 ? "item sem venda" : "itens sem venda"} no período
          </span>
        ) : null}
      </div>

      {/* Rola DENTRO do card, com teto de altura: é o que faz o cabeçalho de dois andares
          e a linha de totais ficarem parados quando a lista tem dezenas de itens — e, de
          quebra, a página deixa de ter três metros de tabela. */}
      <div className={`${styles.tableScroll} ${styles.tableScrollFixo}`}>
        <table
          className={`${styles.table} ${styles.mensalTable} ${styles.itensTable} ${styles.tabelaFixa}`}
        >
          <thead>
            <tr>
              <th className={`${styles.thLeft} ${styles.stickyCol}`} rowSpan={2}>
                Item
              </th>
              <th colSpan={13} className={styles.grupoHead}>
                Vendas por mês — {anoBase}
              </th>
              <th colSpan={compra ? 6 : 4} className={`${styles.grupoHead} ${styles.grupoDecisao}`}>
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
                <span className={styles.thSub}>até {ateCurto}</span>
              </th>
              <th
                className={styles.colDecisao}
                title="Peças já compradas e a caminho (compras em trânsito ativas) — não se compra de novo o que já vem vindo"
              >
                Já vem
                <span className={styles.thSub}>em trânsito</span>
              </th>
              <th className={styles.colDecisao} title="Estoque atual da rede (só saldos positivos)">
                Tem
                <span className={styles.thSub}>em estoque</span>
              </th>
              <th
                className={styles.colDecisao}
                title="Vai vender − Tem em estoque − Já vem em trânsito (nunca negativo)"
              >
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
                  <td className={`${styles.num} ${styles.colDecisao}`}>
                    <span className={l.transito ? "" : styles.zero}>
                      {l.transito ? fmt(l.transito) : "·"}
                    </span>
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
                <td className={`${styles.num} ${styles.colDecisao}`}>{fmt(totais.transito)}</td>
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
  /**
   * O abatimento da compra salva, fechado: quanto ainda falta pedir depois do que já foi
   * salvo, ou quanto foi pedido a mais. `diferenca` (na compra − precisa) tem o sinal
   * invertido para quem lê "falta", então as duas leituras ficam explícitas aqui.
   */
  const faltaPedir = l.qtdSalva == null ? 0 : Math.max(0, l.sugestao - l.qtdSalva);
  const sobraPedida = l.qtdSalva == null ? 0 : Math.max(0, l.qtdSalva - l.sugestao);

  // Posiciona junto ao ponteiro, sem sair da janela.
  const largura = 340;
  // Estimativa só para escolher o lado em que o painel abre. Cresce quando há compra salva
  // (mais um bloco de conta) — subestimar fazia o painel nascer colado no rodapé da tela.
  const altura = l.qtdSalva != null ? 400 : 320;
  const margem = 12;
  const janelaW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const janelaH = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(Math.max(margem, dica.x + 16), Math.max(margem, janelaW - largura - margem));
  const topAcima = dica.y - altura - 16;
  const top =
    topAcima > margem
      ? topAcima
      : Math.min(dica.y + 16, Math.max(margem, janelaH - altura - margem));

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

      {/* PASSO 1 — quanto este item precisa. A conta que o dono aprovou: o que sai, menos
          o que já existe. */}
      <div className={styles.dicaConta}>
        <div className={styles.dicaLinha}>
          <span>Vai vender até {ateLabel}</span>
          <span>{fmt(Math.round(l.necessidade))}</span>
        </div>
        <div className={styles.dicaLinha}>
          <span>Já tem em estoque</span>
          <span>− {fmt(l.estoque)}</span>
        </div>
        {l.transito > 0 && (
          <div className={styles.dicaLinha}>
            <span>Já vem em trânsito</span>
            <span>− {fmt(l.transito)}</span>
          </div>
        )}
        <div className={`${styles.dicaLinha} ${styles.dicaTotal}`}>
          <span>Precisa comprar</span>
          <span>
            <strong>{fmt(l.sugestao)} un</strong>
          </span>
        </div>
      </div>

      {/* PASSO 2 — o que a compra salva já resolve. Antes "Na compra salva" aparecia solto
          no rodapé, sem sinal e sem fechamento: dava para ler como se fosse mais uma
          quantidade a comprar. Agora é um ABATIMENTO com resultado próprio. */}
      {l.qtdSalva != null && (
        <div className={styles.dicaConta}>
          <div className={styles.dicaLinha}>
            <span>Na compra salva</span>
            <span>− {fmt(l.qtdSalva)}</span>
          </div>
          {/* Com várias compras importadas, de onde veio cada pedaço da soma. */}
          {(l.origens ?? []).map((o, i) => (
            <div key={`${o.titulo}-${i}`} className={styles.dicaLinha}>
              <span className={styles.dicaFraco}>· {o.titulo}</span>
              <span className={styles.dicaFraco}>{fmt(o.qtd)}</span>
            </div>
          ))}
          <div className={`${styles.dicaLinha} ${styles.dicaTotal}`}>
            {faltaPedir > 0 ? (
              <>
                <span>Ainda falta pedir</span>
                <span>
                  <strong className={styles.dicaFalta}>{fmt(faltaPedir)} un</strong>
                </span>
              </>
            ) : sobraPedida > 0 ? (
              <>
                <span>Pedido acima do necessário</span>
                <span>
                  <strong className={styles.dicaSobra}>{fmt(sobraPedida)} un</strong>
                </span>
              </>
            ) : (
              <>
                <span>A compra cobre</span>
                <span>
                  <strong className={styles.dicaOk}>no ponto</strong>
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* DE ONDE VEM O "vai vender" — era um parágrafo corrido com a soma dos meses, os
          fatores e o patamar tudo na mesma frase. Vira lista: a soma mês a mês de um lado,
          a régua embaixo em uma linha. */}
      {l.semSerie ? (
        <div className={styles.dicaNota}>
          Este item <strong>não vendeu nada</strong> no período, então não há o que projetar — a
          sugestão fica em 0 e a quantidade da compra é decisão sua.
        </div>
      ) : (
        <>
          {l.partes.length > 0 && (
            <>
              <div className={styles.dicaSecao}>
                De onde vêm os {fmt(Math.round(l.necessidade))}
              </div>
              <div className={styles.dicaMeses}>
                {l.partes.map((parte) => (
                  <div key={`${parte.ano}-${parte.mes}`} className={styles.dicaMes}>
                    <span className={styles.dicaMesNome}>
                      {MES_NOME[parte.mes - 1]}
                      {parte.diasUsados < parte.diasDoMes && (
                        <span className={styles.dicaMesDias}> {parte.diasUsados}d</span>
                      )}
                    </span>
                    <span className={styles.dicaMesQtd}>{fmt(Math.round(parte.parcela))}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className={styles.dicaNota}>
            {ehRegraSazonalCategoria(regra) ? (
              l.partes.length === 0 ? (
                "Sem meses fechados no ano, o patamar não tem de onde sair."
              ) : (
                <>
                  Cada mês é o <strong>patamar deste item</strong>
                  {l.patamarSazonal != null ? (
                    <> — {fmt(Math.round(l.patamarSazonal))} un/mês, já sem sazonalidade</>
                  ) : null}{" "}
                  × a <strong>força do mês na categoria</strong>
                  {l.curvaSazonal ? (
                    <>
                      {" "}
                      {l.curvaSazonal.chave === "__ESCOPO__" ? "do escopo" : l.curvaSazonal.chave}{" "}
                      (nov {fmtDec(l.curvaSazonal.fatores[11])}× · dez{" "}
                      {fmtDec(l.curvaSazonal.fatores[12])}×)
                    </>
                  ) : null}
                  .
                </>
              )
            ) : curva ? (
              l.partes.length === 0 ? (
                "Sem meses fechados no ano, a curva não tem de onde sair."
              ) : (
                <>
                  Cada mês é o que este item vendeu no <strong>mesmo mês de {anoBase - 1}</strong>
                  {l.indice != null ? (
                    <>
                      {" "}
                      × <strong>{fmtDec(l.indice)}</strong>
                    </>
                  ) : null}
                  .{noLimite ? ` Índice ${noLimite}.` : ""}
                  {criterioFora ? ` ${CRITERIO_TEXTO[criterioFora]}.` : ""}
                </>
              )
            ) : ehRegraCompraIdeal(regra) ? (
              l.semRitmoIdeal ? (
                <>
                  Este item <strong>não tem ritmo medido</strong> pela régua da Compra Ideal (sem
                  trecho com estoque positivo no histórico), então a projeção fica em 0.
                </>
              ) : (
                <>
                  Ritmo da <strong>Compra Ideal</strong>: <strong>{fmtDec(l.ritmoDia)}/dia</strong>{" "}
                  × {fmt(diasHorizonte)} dias. O consumo/dia é o mesmo da Curva ABC — vendas do
                  maior trecho contínuo com estoque, não dias corridos.{" "}
                  <strong>Sem comparação com o ano passado.</strong>
                </>
              )
            ) : (
              <>
                {REGRA_LABEL[regra]}: o que saiu nos últimos {regra} dias (
                {fmtDec(l.ritmoDia)}/dia), esticado para os {fmt(diasHorizonte)} dias do
                horizonte. <strong>Sem sazonalidade.</strong>
              </>
            )}
          </div>
        </>
      )}

      {l.estoque > l.necessidade ? (
        <div className={styles.dicaNota}>
          O estoque já cobre o período, com {fmt(Math.round(l.estoque - l.necessidade))} un de
          folga.
        </div>
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
