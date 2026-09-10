"use client";

import { useEffect, useMemo, useState } from "react";

import {
  indiceDoModo,
  montarPerfil,
  projetarHorizonte,
  projetarMesCheio,
  type CriterioMes,
  type MesSerie,
  type ModoProjecao,
} from "@/lib/utils/projecao-realista";
import {
  CRITERIO_TEXTO,
  REGRAS_CURVA,
  REGRA_LABEL,
  type RegraProjecao,
} from "@/lib/utils/projecao-regras";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProjecaoCompraPage.module.css";

/**
 * Aba "Embalagens" da Projeção Compra.
 *
 * Diferente das abas Produtos e Tickets, aqui não existe recorte de cadastro: a lista é
 * FIXA (as embalagens da ScarfMe) e cada linha tem a sua própria série, porque cada uma vem
 * de um filtro de ticket diferente — ver [embalagens.ts](@/lib/config/embalagens).
 *
 * A projeção de cada linha usa exatamente o mesmo motor das outras abas (curva do ano
 * anterior × índice YoY, ou ritmo de janela), só que aplicado à série de consumo daquela
 * embalagem em vez da série de venda de um produto.
 *
 * O estoque é digitado: embalagem não é produto do Linx, não tem saldo para consultar. O
 * valor começa na contagem da planilha e, a partir do primeiro "Salvar estoque", vale o que
 * ficou gravado.
 */

const JANELAS_TABELA = [30, 60, 90, 365] as const;

interface EmbalagemSerie {
  id: string;
  nome: string;
  nota?: string;
  temRegra: boolean;
  janelas: Record<string, number>;
  mensal: MesSerie[];
}

interface Resposta {
  dataBase: string;
  itens: EmbalagemSerie[];
  estoque: Record<string, number>;
  error?: string;
}

const MES_NOME = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function fmtDec(n: number, dec = 1): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(v: number | null, dec = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
}
function addDaysFormatted(baseYmd: string, days: number): string {
  const [y, m, d] = baseYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getUTCFullYear()}`;
}

/** O que dispara a consulta: a tela só busca quando o usuário manda gerar. */
export interface PedidoEmbalagens {
  dataBase: string;
  filial: string | null;
}

interface Props {
  companyKey: CompanyKey;
  username: string;
  pedido: PedidoEmbalagens | null;
  /** Data base e horizonte AO VIVO: mudar "Vender até" ou a regra recalcula sem nova consulta. */
  dataBase: string;
  diasHorizonte: number;
  regra: RegraProjecao;
  /** Avisa a tela-mãe que a consulta está em andamento (o "calculando" é de lá). */
  onLoadingChange?: (carregando: boolean) => void;
}

/** Uma linha da tabela, com a projeção já resolvida. */
interface LinhaEmbalagem {
  item: EmbalagemSerie;
  /** false = embalagem sem regra: a linha existe mas não projeta. */
  temRegra: boolean;
  /** Nada fechou no ano ainda (data base em janeiro): a curva não tem de onde sair. */
  disponivel: boolean;
  estoque: number;
  janelas: Record<number, number>;
  /** Consumo projetado no horizonte. */
  necessidade: number;
  ritmoDia: number;
  sugestao: number;
  cobertura: number | null;
  duraAte: string | null;
  indice: number | null;
}

export default function ProjecaoEmbalagensPanel({
  companyKey,
  username,
  pedido,
  dataBase,
  diasHorizonte,
  regra,
  onLoadingChange,
}: Props) {
  const [itens, setItens] = useState<EmbalagemSerie[]>([]);
  const [estoqueSalvo, setEstoqueSalvo] = useState<Record<string, number>>({});
  /** Edições ainda não gravadas (id → unidades). */
  const [estoqueEditado, setEstoqueEditado] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);

  // ── Consulta: só quando o pedido muda (gerar projeção) ──
  useEffect(() => {
    if (!pedido) return;
    const params = new URLSearchParams({ company: companyKey, base: pedido.dataBase });
    if (pedido.filial) params.set("filial", pedido.filial);

    let cancelado = false;
    setCarregando(true);
    onLoadingChange?.(true);
    setErro(null);
    fetch(`/api/projecao-embalagens?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json()) as Resposta;
        if (!r.ok) throw new Error(json?.error || "Erro ao calcular a projeção de embalagens");
        return json;
      })
      .then((json) => {
        if (cancelado) return;
        setItens(Array.isArray(json.itens) ? json.itens : []);
        setEstoqueSalvo(json.estoque ?? {});
        setEstoqueEditado({});
      })
      .catch((e: Error) => {
        if (cancelado) return;
        setItens([]);
        setErro(e.message || "Erro ao calcular a projeção de embalagens");
      })
      .finally(() => {
        if (cancelado) return;
        setCarregando(false);
        onLoadingChange?.(false);
      });
    return () => {
      cancelado = true;
    };
    // `onLoadingChange` fica fora de propósito: é um callback recriado a cada render da
    // tela-mãe e entraria em laço de carga — ver [[efeito-fetch-strictmode-guard]].
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, pedido]);

  const modoCurva: ModoProjecao | null = REGRAS_CURVA[regra] ?? null;
  const estoqueAtual = useMemo(
    () => ({ ...estoqueSalvo, ...estoqueEditado }),
    [estoqueSalvo, estoqueEditado]
  );

  // ── Projeção linha a linha ──
  const linhas: LinhaEmbalagem[] = useMemo(() => {
    return itens.map((item) => {
      const perfil = montarPerfil(item.mensal);
      const indice = modoCurva ? indiceDoModo(perfil, modoCurva) : perfil.indice;
      const estoque = Math.max(0, Number(estoqueAtual[item.id] ?? 0) || 0);

      const janelas: Record<number, number> = {};
      JANELAS_TABELA.forEach((d) => {
        janelas[d] = Number(item.janelas?.[String(d)] ?? 0) || 0;
      });
      // A regra de janela pode pedir uma janela que a tabela não mostra (120 dias).
      const diasRegra = modoCurva ? diasHorizonte : Number(regra);
      const consumoJanela = Number(item.janelas?.[String(diasRegra)] ?? 0) || 0;

      const curva = modoCurva !== null;
      const disponivel = item.temRegra && (curva ? perfil.ultimoMesReal >= 1 && diasHorizonte > 0 : true);

      const necessidade = !disponivel
        ? 0
        : curva
        ? projetarHorizonte(item.mensal, perfil, modoCurva, indice, dataBase, diasHorizonte)
        : diasRegra > 0
        ? (consumoJanela / diasRegra) * diasHorizonte
        : 0;
      const ritmoDia = curva
        ? diasHorizonte > 0
          ? necessidade / diasHorizonte
          : 0
        : diasRegra > 0
        ? consumoJanela / diasRegra
        : 0;

      const sugestao = disponivel ? Math.max(0, Math.ceil(necessidade - estoque)) : 0;
      const cobertura = ritmoDia > 0 ? estoque / ritmoDia : null;
      const duraAte = cobertura !== null ? addDaysFormatted(dataBase, Math.round(cobertura)) : null;

      return {
        item,
        temRegra: item.temRegra,
        disponivel,
        estoque,
        janelas,
        necessidade,
        ritmoDia,
        sugestao,
        cobertura,
        duraAte,
        indice,
      };
    });
  }, [itens, modoCurva, regra, dataBase, diasHorizonte, estoqueAtual]);

  const totais = useMemo(() => {
    const comRegra = linhas.filter((l) => l.temRegra);
    return {
      linhas: comRegra.length,
      semRegra: linhas.length - comRegra.length,
      aComprar: comRegra.reduce((s, l) => s + l.sugestao, 0),
      itensAComprar: comRegra.filter((l) => l.sugestao > 0).length,
      consumo: comRegra.reduce((s, l) => s + l.necessidade, 0),
      estoque: comRegra.reduce((s, l) => s + l.estoque, 0),
    };
  }, [linhas]);

  const temEdicao = Object.keys(estoqueEditado).length > 0;

  const salvarEstoque = async () => {
    if (!temEdicao || salvando) return;
    setSalvando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/projecao-embalagens", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, estoque: estoqueEditado }),
      });
      const json = (await res.json()) as { estoque?: Record<string, number>; error?: string };
      if (!res.ok) throw new Error(json?.error || "Erro ao salvar o estoque");
      setEstoqueSalvo(json.estoque ?? {});
      setEstoqueEditado({});
      setAviso("Estoque salvo.");
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Erro ao salvar o estoque");
    } finally {
      setSalvando(false);
    }
  };

  const linhaExpandida = linhas.find((l) => l.item.id === expandida) ?? null;

  if (!pedido) {
    return (
      <div className={styles.emptyPanel}>
        <div className={styles.emptyTitle}>Gere a projeção</div>
        <div className={styles.emptyText}>
          Escolha a data base e o horizonte e clique em <strong>Gerar projeção</strong>. A lista de
          embalagens é fixa — cada linha vem do seu próprio filtro de ticket.
        </div>
      </div>
    );
  }

  return (
    <>
      {erro && <div className={styles.erro}>{erro}</div>}

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className={styles.kpiStrip}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Unidades a comprar</span>
          <span className={styles.kpiValue}>{fmt(totais.aComprar)}</span>
          <span className={styles.kpiHint}>
            {fmt(totais.itensAComprar)} de {fmt(totais.linhas)} embalagens
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Consumo projetado</span>
          <span className={styles.kpiValue}>{fmt(Math.round(totais.consumo))}</span>
          <span className={styles.kpiHint}>no horizonte de {fmt(diasHorizonte)} dias</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Estoque informado</span>
          <span className={styles.kpiValue}>{fmt(totais.estoque)}</span>
          <span className={styles.kpiHint}>contagem digitada, não o Linx</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Sem regra</span>
          <span className={styles.kpiValue}>{fmt(totais.semRegra)}</span>
          <span className={styles.kpiHint}>aguardando o filtro de ticket</span>
        </div>
      </div>

      {/* ── Tabela por embalagem ─────────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Embalagens · {REGRA_LABEL[regra]}</span>
          <div className={styles.embActions}>
            {aviso && <span className={styles.embAviso}>{aviso}</span>}
            <button
              type="button"
              className={styles.btnGerar}
              onClick={salvarEstoque}
              disabled={!temEdicao || salvando}
              title={temEdicao ? "Gravar o estoque digitado" : "Nenhum estoque foi alterado"}
            >
              {salvando ? "Salvando…" : "Salvar estoque"}
            </button>
          </div>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.embTable}`}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Embalagem</th>
                <th>Estoque</th>
                {JANELAS_TABELA.map((d) => (
                  <th key={d}>{d === 365 ? "12 meses" : `${d}d`}</th>
                ))}
                <th>Ritmo/mês</th>
                <th>Projeção horizonte</th>
                <th>Cobertura</th>
                <th>Dura até</th>
                <th>Comprar</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td className={styles.tdLeft} colSpan={10}>
                    <span className={styles.muted}>
                      {carregando ? "Carregando…" : "Sem dados para o escopo."}
                    </span>
                  </td>
                </tr>
              ) : (
                linhas.map((l) => {
                  const editado = estoqueEditado[l.item.id] != null;
                  const ativa = expandida === l.item.id;
                  return (
                    <tr
                      key={l.item.id}
                      className={ativa ? styles.embRowAtiva : undefined}
                      onClick={() => setExpandida(ativa ? null : l.item.id)}
                    >
                      <td className={styles.tdLeft} title={l.item.nota ?? ""}>
                        {l.item.nome}
                        {!l.temRegra && <span className={styles.embSemRegra}>sem regra</span>}
                      </td>
                      <td className={styles.num}>
                        <input
                          type="number"
                          className={`${styles.input} ${styles.inputNum} ${
                            editado ? styles.inputEdited : ""
                          }`}
                          value={l.estoque}
                          min={0}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAviso(null);
                            setEstoqueEditado((prev) => ({
                              ...prev,
                              [l.item.id]: v === "" ? 0 : Math.max(0, Math.round(Number(v) || 0)),
                            }));
                          }}
                        />
                      </td>
                      {JANELAS_TABELA.map((d) => (
                        <td key={d} className={styles.num}>
                          {l.temRegra ? fmt(l.janelas[d] ?? 0) : "—"}
                        </td>
                      ))}
                      <td className={styles.num}>
                        {l.disponivel ? fmtDec(l.ritmoDia * 30) : "—"}
                      </td>
                      <td className={styles.num}>
                        {l.disponivel ? fmt(Math.round(l.necessidade)) : "—"}
                      </td>
                      <td className={styles.num}>
                        {l.cobertura !== null ? `${fmt(Math.round(l.cobertura))} d` : "—"}
                      </td>
                      <td className={styles.num}>{l.duraAte ?? "—"}</td>
                      <td className={`${styles.num} ${l.sugestao > 0 ? styles.embComprar : ""}`}>
                        {l.disponivel ? fmt(l.sugestao) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Série mensal da embalagem escolhida ──────────────────────────── */}
      {linhaExpandida && (
        <SerieMensal
          linha={linhaExpandida}
          regra={regra}
          modoCurva={modoCurva}
          dataBase={dataBase}
        />
      )}
    </>
  );
}

/** Os 12 meses da embalagem escolhida: realizado, projetado e a variação sobre o ano anterior. */
function SerieMensal({
  linha,
  regra,
  modoCurva,
  dataBase,
}: {
  linha: LinhaEmbalagem;
  regra: RegraProjecao;
  modoCurva: ModoProjecao | null;
  dataBase: string;
}) {
  const anoBase = Number(dataBase.slice(0, 4));
  const perfil = useMemo(() => montarPerfil(linha.item.mensal), [linha.item.mensal]);

  const rows = useMemo(
    () =>
      linha.item.mensal.map((m) => {
        const mesNum = Number(m.mes.slice(5, 7));
        let projetado: number | null = null;
        let criterio: CriterioMes | null = null;
        if (modoCurva) {
          const r = projetarMesCheio(perfil, mesNum, modoCurva);
          projetado = perfil.ultimoMesReal >= 1 ? r.valor : null;
          criterio = r.criterio;
        } else {
          // Regra de janela: o ritmo medido, esticado pelos dias do mês.
          projetado = linha.ritmoDia * new Date(Date.UTC(anoBase, mesNum, 0)).getUTCDate();
        }
        const valorAno = m.futuro
          ? projetado ?? 0
          : m.parcial
          ? Math.max(m.qtde, projetado ?? 0)
          : m.qtde;
        const valorCelula = m.futuro ? projetado : m.parcial ? valorAno : m.qtde;
        const pct =
          m.qtdeAnoAnterior > 0 && valorCelula != null ? valorCelula / m.qtdeAnoAnterior - 1 : null;
        return { ...m, projetado, criterio, valorAno, valorCelula, pct };
      }),
    [linha.item.mensal, linha.ritmoDia, perfil, modoCurva, anoBase]
  );

  const total = rows.reduce((s, r) => s + r.valorAno, 0);
  const totalAnterior = rows.reduce((s, r) => s + r.qtdeAnoAnterior, 0);
  const variacao = totalAnterior > 0 ? total / totalAnterior - 1 : null;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{linha.item.nome} · consumo por mês</span>
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
      </div>
      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.mensalTable}`}>
          <thead>
            <tr>
              <th className={`${styles.thLeft} ${styles.stickyCol}`}>Série</th>
              {rows.map((m) => (
                <th key={m.mes}>{MES_NOME[Number(m.mes.slice(5, 7)) - 1]}</th>
              ))}
              <th className={styles.colTotal}>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${styles.tdLeft} ${styles.stickyCol}`}>{anoBase}</td>
              {rows.map((m) => (
                <td
                  key={m.mes}
                  className={`${styles.num} ${styles.cellMes} ${
                    m.futuro ? styles.cellProj : m.parcial ? styles.cellParcial : ""
                  }`}
                  title={
                    m.futuro || m.parcial
                      ? `${REGRA_LABEL[regra]}${m.criterio ? ` · ${CRITERIO_TEXTO[m.criterio]}` : ""}`
                      : "Realizado"
                  }
                >
                  <span className={styles.cellQtd}>
                    {m.valorCelula == null ? "—" : fmt(Math.round(m.valorCelula))}
                  </span>
                  <span
                    className={`${styles.cellPct} ${
                      m.pct == null ? styles.muted : m.pct >= 0 ? styles.varUp : styles.varDown
                    }`}
                  >
                    {fmtPct(m.pct)}
                  </span>
                  {(m.parcial || m.futuro) && <span className={styles.cellFlag}>proj.</span>}
                </td>
              ))}
              <td className={`${styles.num} ${styles.colTotal}`}>
                <span className={styles.cellQtd}>{fmt(Math.round(total))}</span>
                <span
                  className={`${styles.cellPct} ${
                    variacao == null ? styles.muted : variacao >= 0 ? styles.varUp : styles.varDown
                  }`}
                >
                  {fmtPct(variacao)}
                </span>
              </td>
            </tr>
            <tr>
              <td className={`${styles.tdLeft} ${styles.stickyCol}`}>{anoBase - 1}</td>
              {rows.map((m) => (
                <td key={m.mes} className={`${styles.num} ${styles.cellMes}`}>
                  <span className={styles.cellQtd}>{fmt(m.qtdeAnoAnterior)}</span>
                </td>
              ))}
              <td className={`${styles.num} ${styles.colTotal}`}>
                <span className={styles.cellQtd}>{fmt(totalAnterior)}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
