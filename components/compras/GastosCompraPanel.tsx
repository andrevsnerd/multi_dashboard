"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import { isReadOnlyRole } from "@/lib/auth/permissions";
import {
  COMPRA_GASTO_CANAL_CURTO,
  COMPRA_GASTO_CANAL_LABEL,
  COMPRA_GASTO_TIPO_LABEL,
  type CompraGastoLote,
  type CompraGastoMes,
  type CompraGastoOrcamentoEntry,
  type CompraGastoParcela,
} from "@/lib/types/compra-gasto";
import {
  agendaDePagamentos,
  anosDisponiveis,
  diasAtraso,
  diasEntre,
  loteStatus,
  mesesDoPainel,
  totaisDoPainel,
} from "@/lib/utils/compra-gastos-agregacao";
import { exportGastosCompraXlsx } from "@/lib/utils/exportGastosCompraXlsx";

import GastosCompraDrawer from "./GastosCompraDrawer";
import GastosCompraGrafico from "./GastosCompraGrafico";
import NovaCompraModal from "./NovaCompraModal";
import styles from "./GastosCompra.module.css";
import {
  brl,
  codigoDistinto,
  dataBr,
  dataBrCompleta,
  dataCurta,
  hojeIso,
  mesCurto,
  mesLongo,
  money,
  parseMoeda,
} from "./gastos-compra-format";

interface Props {
  companyKey: string;
  companyName: string;
}

type Aba = "painel" | "agenda";

const TOM_CLASSE = {
  good: styles.pillGood,
  warn: styles.pillWarn,
  crit: styles.pillCrit,
  mute: styles.pillMute,
} as const;

export default function GastosCompraPanel({ companyKey, companyName }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";
  const somenteLeitura = isReadOnlyRole(user?.role);
  const podeEditar = !!user && !somenteLeitura;

  const hoje = useMemo(() => hojeIso(), []);

  const [lotes, setLotes] = useState<CompraGastoLote[]>([]);
  const [orcamento, setOrcamento] = useState<CompraGastoOrcamentoEntry[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [ano, setAno] = useState<string>(hoje.slice(0, 4));
  const [aba, setAba] = useState<Aba>("painel");
  const [abertos, setAbertos] = useState<Set<string>>(new Set([hoje.slice(0, 7)]));
  const [loteAberto, setLoteAberto] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [mesSugerido, setMesSugerido] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [rascunhoOrcamento, setRascunhoOrcamento] = useState<Record<string, string>>({});

  // Recorte padrão: planejamento olha pra frente. Mês passado só aparece
  // quando o usuário desmarca.
  const [somenteFuturo, setSomenteFuturo] = useState(true);

  // Quantos meses à frente a tabela abre — é onde se lança orçamento futuro.
  const [horizonte, setHorizonte] = useState(12);

  // ───────── carga ─────────
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/compras-gastos?company=${companyKey}`, { cache: "no-store" });
      const json = (await res.json()) as {
        lotes?: CompraGastoLote[];
        orcamento?: CompraGastoOrcamentoEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar os gastos de compra");
      setLotes(json.lotes ?? []);
      setOrcamento(json.orcamento ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar os gastos de compra");
    } finally {
      setCarregando(false);
    }
  }, [companyKey]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // ───────── derivados ─────────
  // Anos com dado + o atual e os dois seguintes: dá para planejar 2027/2028
  // antes de existir qualquer compra lá.
  const anos = useMemo(() => {
    const atual = parseInt(hoje.slice(0, 4), 10);
    const futuros = [String(atual), String(atual + 1), String(atual + 2)];
    return [...new Set([...anosDisponiveis(lotes, orcamento), ...futuros])].sort();
  }, [lotes, orcamento, hoje]);

  /** Todos os meses do período — base da exportação e da lista visível. */
  const meses = useMemo(
    () => mesesDoPainel(lotes, orcamento, { ano: ano || undefined, hoje, horizonteMeses: horizonte }),
    [lotes, orcamento, ano, hoje, horizonte]
  );

  /** O que a tabela e o gráfico mostram — e o que os KPIs somam. */
  const mesesVisiveis = useMemo(
    () => (somenteFuturo ? meses.filter((m) => m.ym >= hoje.slice(0, 7)) : meses),
    [meses, somenteFuturo, hoje]
  );

  // KPIs e rodapé seguem a tabela: o número no topo tem que bater com as linhas
  // logo abaixo dele. A agenda e a exportação continuam com o período inteiro.
  const totais = useMemo(() => totaisDoPainel(mesesVisiveis), [mesesVisiveis]);
  const loteMap = useMemo(() => new Map(lotes.map((l) => [l.id, l])), [lotes]);

  /**
   * Compras em trânsito que já viraram compra aqui. O modal esconde essas do
   * select: lançar a mesma duas vezes duplicaria o comprometido do mês.
   */
  const comprasTransitoLancadas = useMemo(
    () => new Set(lotes.map((l) => l.compraTransitoId).filter(Boolean) as string[]),
    [lotes]
  );

  /**
   * Descrições já lançadas, normalizadas. É a única defesa contra relançar as
   * compras que entraram aqui pela Compra Salva (antes da troca de fonte): o
   * vínculo delas é com a Compra Salva, então o id do trânsito não as denuncia.
   * Título igual NÃO é prova — o modal avisa em vez de esconder.
   */
  const titulosLancados = useMemo(
    () =>
      new Set(
        lotes.map((l) => l.titulo.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean)
      ),
    [lotes]
  );
  const agenda = useMemo(() => agendaDePagamentos(lotes, { ano: ano || undefined }), [lotes, ano]);

  const pctOrcamento = totais.orcamento > 0 ? (totais.comprometido / totais.orcamento) * 100 : 0;
  const pctPago = totais.comprometido > 0 ? (totais.pago / totais.comprometido) * 100 : 0;
  const pctFirme = totais.comprometido > 0 ? (totais.firme / totais.comprometido) * 100 : 0;
  const pctEstimado = totais.comprometido > 0 ? (totais.estimado / totais.comprometido) * 100 : 0;

  // ───────── ações ─────────
  const toggleMes = useCallback((ym: string) => {
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym);
      else next.add(ym);
      return next;
    });
  }, []);

  const salvarOrcamento = useCallback(
    async (ym: string, texto: string) => {
      const valor = parseMoeda(texto);
      const anterior = orcamento.find((o) => o.ym === ym);
      if (anterior && Math.abs(anterior.valor - valor) < 0.005) return;
      if (!anterior && valor === 0) return;

      // Otimista: a tela recalcula na hora; erro reverte.
      setOrcamento((prev) => {
        const outros = prev.filter((o) => o.ym !== ym);
        return valor > 0 ? [...outros, { ym, valor }].sort((a, b) => a.ym.localeCompare(b.ym)) : outros;
      });

      try {
        const res = await fetch("/api/compras-gastos/orcamento", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ companyKey, ym, valor }),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          setErro(json.error ?? "Não foi possível salvar o orçamento.");
          setOrcamento((prev) => {
            const outros = prev.filter((o) => o.ym !== ym);
            return anterior ? [...outros, anterior].sort((a, b) => a.ym.localeCompare(b.ym)) : outros;
          });
        }
      } catch {
        setErro("Não foi possível salvar o orçamento.");
        void carregar();
      }
    },
    [companyKey, username, orcamento, carregar]
  );

  const togglePago = useCallback(
    async (loteId: string, indice: number, pago: boolean) => {
      setSalvando(true);
      try {
        const res = await fetch(`/api/compras-gastos/${loteId}?company=${companyKey}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ parcelaIndex: indice, pago }),
        });
        const json = (await res.json()) as { data?: CompraGastoLote; error?: string };
        if (!res.ok || !json.data) {
          setErro(json.error ?? "Não foi possível atualizar a parcela.");
          return;
        }
        setLotes((prev) => prev.map((l) => (l.id === loteId ? (json.data as CompraGastoLote) : l)));
      } catch {
        setErro("Não foi possível atualizar a parcela.");
      } finally {
        setSalvando(false);
      }
    },
    [companyKey, username]
  );

  const excluirLote = useCallback(
    async (loteId: string) => {
      const lote = loteMap.get(loteId);
      if (!lote) return;
      const ok = window.confirm(
        `Excluir "${lote.codigo} · ${lote.titulo}"? O valor sai do gasto dos meses em que as parcelas caíam.`
      );
      if (!ok) return;
      setSalvando(true);
      try {
        const res = await fetch(`/api/compras-gastos/${loteId}?company=${companyKey}`, {
          method: "DELETE",
          headers: { "x-auth-username": username },
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          setErro(json.error ?? "Não foi possível excluir a compra.");
          return;
        }
        setLotes((prev) => prev.filter((l) => l.id !== loteId));
        setLoteAberto(null);
      } catch {
        setErro("Não foi possível excluir a compra.");
      } finally {
        setSalvando(false);
      }
    },
    [companyKey, username, loteMap]
  );

  const salvarParcelas = useCallback(
    async (
      loteId: string,
      parcelas: CompraGastoParcela[],
      fornecedor: string | null
    ): Promise<boolean> => {
      setSalvando(true);
      try {
        const res = await fetch(`/api/compras-gastos/${loteId}?company=${companyKey}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ parcelas, fornecedor }),
        });
        const json = (await res.json()) as { data?: CompraGastoLote; error?: string };
        if (!res.ok || !json.data) {
          setErro(json.error ?? "Não foi possível salvar o parcelamento.");
          return false;
        }
        setLotes((prev) => prev.map((l) => (l.id === loteId ? (json.data as CompraGastoLote) : l)));
        return true;
      } catch {
        setErro("Não foi possível salvar o parcelamento.");
        return false;
      } finally {
        setSalvando(false);
      }
    },
    [companyKey, username]
  );

  const aoSalvarCompra = useCallback(
    (lote: CompraGastoLote) => {
      setModalAberto(false);
      setLotes((prev) => [lote, ...prev]);
      const primeiroVenc = lote.parcelas[0]?.vencimento ?? "";
      const anoDaCompra = primeiroVenc.slice(0, 4);
      if (anoDaCompra && ano && anoDaCompra !== ano) setAno(anoDaCompra);
      const ym = primeiroVenc.slice(0, 7);
      if (ym) setAbertos((prev) => new Set(prev).add(ym));
    },
    [ano]
  );

  const abrirNovaCompra = useCallback((ym?: string) => {
    setMesSugerido(ym ?? null);
    setModalAberto(true);
  }, []);

  // ───────── render ─────────
  return (
    <div className={styles.wrapper}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.titulo}>Gastos de Compra</h1>
        </div>
        <div className={styles.headTools}>
          {somenteLeitura && <span className={styles.readOnlyBadge}>somente leitura</span>}
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={somenteFuturo}
              onChange={(e) => setSomenteFuturo(e.target.checked)}
            />
            <span>Só do mês atual em diante</span>
          </label>
          <select
            className={styles.select}
            value={ano}
            onChange={(e) => setAno(e.target.value)}
            aria-label="Ano"
          >
            <option value="">Todos os meses</option>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.btn}
            onClick={() =>
              exportGastosCompraXlsx(lotes, meses, {
                companyKey,
                companyName,
                ano: ano || undefined,
                hoje,
              })
            }
            disabled={lotes.length === 0}
          >
            Exportar
          </button>
          {podeEditar && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => abrirNovaCompra()}
            >
              + Nova compra
            </button>
          )}
        </div>
      </div>

      {erro && <div className={styles.error}>{erro}</div>}


      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Orçamento</span>
          <span className={styles.kpiValue}>{brl(totais.orcamento)}</span>
          <span className={styles.kpiFoot}>
            {mesesVisiveis.length > 0
              ? `${mesesVisiveis.length} meses · ${mesCurto(mesesVisiveis[0].ym)} a ${mesCurto(
                  mesesVisiveis[mesesVisiveis.length - 1].ym
                )}`
              : "sem meses no filtro"}
          </span>
        </div>
        <div className={`${styles.kpi} ${styles.kpiAccent}`}>
          <span className={styles.kpiLabel}>Comprometido</span>
          <span className={styles.kpiValue}>{brl(totais.comprometido)}</span>
          <div className={styles.meter}>
            <i style={{ width: `${pctPago}%`, background: "var(--gc-pago)" }} />
            <i style={{ width: `${pctFirme}%`, background: "var(--gc-firme)" }} />
            <i style={{ width: `${pctEstimado}%`, background: "var(--gc-firme)", opacity: 0.45 }} />
          </div>
          <span className={styles.kpiFoot}>
            {totais.orcamento > 0
              ? `${pctOrcamento.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do orçamento`
              : "orçamento não definido"}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Pago</span>
          <span className={styles.kpiValue}>{brl(totais.pago)}</span>
          <span className={styles.kpiFoot}>saiu do caixa</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>A pagar</span>
          <span className={styles.kpiValue}>{brl(totais.aPagar)}</span>
          <span className={styles.kpiFoot}>
            {totais.estimado > 0 ? `sendo ${brl(totais.estimado)} em estimativa` : "tudo compra fechada"}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>
            {totais.saldo >= 0 ? "Saldo de orçamento" : "Estouro"}
          </span>
          <span className={`${styles.kpiValue} ${totais.saldo >= 0 ? styles.pos : styles.neg}`}>
            {totais.saldo < 0 ? "−" : ""}
            {brl(Math.abs(totais.saldo))}
          </span>
          <span className={styles.kpiFoot}>
            {totais.mesesEstourados > 0
              ? `${totais.mesesEstourados} ${totais.mesesEstourados > 1 ? "meses estourados" : "mês estourado"}`
              : "nenhum mês estourado"}
          </span>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Orçamento × comprometido, mês a mês</h2>
          <span className={styles.cardNote}>
            {carregando
              ? "carregando…"
              : `${mesesVisiveis.length} meses · vencimento das parcelas`}
          </span>
        </div>
        {!carregando && mesesVisiveis.length > 0 && (
          <GastosCompraGrafico
            meses={mesesVisiveis}
            hoje={hoje}
            onSelectMes={(ym) => {
              setAba("painel");
              setAbertos((prev) => new Set(prev).add(ym));
              const linha = document.getElementById(`gc-mes-${ym}`);
              linha?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={aba === "painel"}
            className={aba === "painel" ? styles.tabActive : undefined}
            onClick={() => setAba("painel")}
          >
            Painel mensal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={aba === "agenda"}
            className={aba === "agenda" ? styles.tabActive : undefined}
            onClick={() => setAba("agenda")}
          >
            Agenda de pagamentos
          </button>
        </div>

        {carregando && <div className={styles.feedback}>Carregando…</div>}

        {!carregando && aba === "painel" && (
          <>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ minWidth: 168 }}>Mês</th>
                  <th className={styles.thNum}>Orçamento</th>
                  <th className={styles.thNum}>Comprometido</th>
                  <th className={styles.thNum}>Pago</th>
                  <th className={styles.thNum}>A pagar</th>
                  <th className={styles.thNum}>Saldo</th>
                  <th className={styles.thNum} style={{ width: 84 }}>
                    Compras
                  </th>
                </tr>
              </thead>
              <tbody>
                {mesesVisiveis.map((mes) => (
                  <LinhaMes
                    key={mes.ym}
                    mes={mes}
                    hoje={hoje}
                    aberto={abertos.has(mes.ym)}
                    podeEditar={podeEditar}
                    loteMap={loteMap}
                    rascunho={rascunhoOrcamento[mes.ym]}
                    onRascunho={(texto) =>
                      setRascunhoOrcamento((prev) => ({ ...prev, [mes.ym]: texto }))
                    }
                    onCommitOrcamento={(texto) => {
                      setRascunhoOrcamento((prev) => {
                        const next = { ...prev };
                        delete next[mes.ym];
                        return next;
                      });
                      void salvarOrcamento(mes.ym, texto);
                    }}
                    onToggle={() => toggleMes(mes.ym)}
                    onAbrirLote={setLoteAberto}
                    onNovaCompra={() => abrirNovaCompra(mes.ym)}
                  />
                ))}
                {mesesVisiveis.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.feedback}>
                      Nenhum mês no filtro selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
              {mesesVisiveis.length > 0 && (
                <tfoot>
                  <tr>
                    <td>{ano ? `Ciclo ${ano}` : "Total"}</td>
                    <td className={styles.num}>{money(totais.orcamento)}</td>
                    <td className={styles.num}>{money(totais.comprometido)}</td>
                    <td className={`${styles.num} ${styles.muted}`}>{money(totais.pago)}</td>
                    <td className={`${styles.num} ${styles.muted}`}>{money(totais.aPagar)}</td>
                    <td className={`${styles.num} ${totais.saldo >= 0 ? styles.pos : styles.neg}`}>
                      {totais.saldo < 0 ? "−" : ""}
                      {money(Math.abs(totais.saldo))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {!ano && (
            <div className={styles.horizonteBar}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                onClick={() => setHorizonte((h) => Math.min(60, h + 12))}
                disabled={horizonte >= 60}
              >
                + 12 meses à frente
              </button>
              <span className={styles.cardNote}>
                A tabela abre {horizonte} meses à frente do mês atual, mesmo sem compra lançada —
                é onde você define o orçamento futuro. Selecionar um ano acima mostra os 12 meses dele.
              </span>
            </div>
          )}
          </>
        )}

        {!carregando && aba === "agenda" && (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Competência</th>
                  <th style={{ width: 120 }}>Vencimento</th>
                  <th className={styles.thNum} style={{ width: 130 }}>
                    Valor
                  </th>
                  <th style={{ width: 170 }}>Categoria</th>
                  <th>Descrição</th>
                  <th style={{ width: 120 }}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((linha, i) => (
                  <tr
                    key={`${linha.lote.id}-${i}`}
                    className={styles.rowLink}
                    onClick={() => setLoteAberto(linha.lote.id)}
                  >
                    <td className={`${styles.num} ${styles.muted}`} style={{ textAlign: "left" }}>
                      {dataBrCompleta(linha.lote.dataCompra)}
                    </td>
                    <td className={styles.num} style={{ textAlign: "left" }}>
                      {dataBrCompleta(linha.parcela.vencimento)}
                    </td>
                    <td className={`${styles.num} ${styles.agendaNeg}`}>
                      −{money(linha.parcela.valor)}
                    </td>
                    <td className={styles.muted} style={{ fontSize: 12 }}>
                      {COMPRA_GASTO_TIPO_LABEL[linha.lote.tipo]}
                    </td>
                    <td>
                      {linha.lote.titulo}
                      {linha.total > 1 && (
                        <>
                          {" "}
                          <span className={styles.tag}>
                            {linha.indice}/{linha.total}
                          </span>
                        </>
                      )}
                      {linha.parcela.canal && (
                        <>
                          {" "}
                          <span
                            className={`${styles.tag} ${styles[`canal_${linha.parcela.canal}`]}`}
                            title={`${COMPRA_GASTO_CANAL_LABEL[linha.parcela.canal]}${
                              linha.parcela.etapa ? ` — ${linha.parcela.etapa}` : ""
                            }`}
                          >
                            {COMPRA_GASTO_CANAL_CURTO[linha.parcela.canal]}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <span
                        className={`${styles.pill} ${
                          linha.parcela.pago
                            ? styles.pillGood
                            : linha.lote.estimado
                              ? styles.pillMute
                              : linha.parcela.vencimento < hoje
                                ? styles.pillCrit
                                : styles.pillWarn
                        }`}
                      >
                        <i />
                        {linha.parcela.pago
                          ? "Pago"
                          : linha.lote.estimado
                            ? "Estimativa"
                            : linha.parcela.vencimento < hoje
                              ? "Vencido"
                              : "A pagar"}
                      </span>
                    </td>
                  </tr>
                ))}
                {agenda.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.feedback}>
                      Nenhuma parcela no período selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {loteAberto && loteMap.get(loteAberto) && (
        <GastosCompraDrawer
          key={loteAberto}
          lote={loteMap.get(loteAberto) as CompraGastoLote}
          hoje={hoje}
          podeEditar={podeEditar}
          salvando={salvando}
          onClose={() => setLoteAberto(null)}
          onTogglePago={(indice, pago) => void togglePago(loteAberto, indice, pago)}
          onSalvarParcelas={(parcelas, fornecedor) =>
            salvarParcelas(loteAberto, parcelas, fornecedor)
          }
          onDelete={() => void excluirLote(loteAberto)}
        />
      )}

      {modalAberto && (
        <NovaCompraModal
          companyKey={companyKey}
          username={username}
          mesSugerido={mesSugerido}
          hoje={hoje}
          comprasTransitoLancadas={comprasTransitoLancadas}
          titulosLancados={titulosLancados}
          onClose={() => setModalAberto(false)}
          onSaved={aoSalvarCompra}
        />
      )}
    </div>
  );
}

/* ============================================================
   Linha do mês + lotes que vencem nele
   ============================================================ */

function LinhaMes({
  mes,
  hoje,
  aberto,
  podeEditar,
  loteMap,
  rascunho,
  onRascunho,
  onCommitOrcamento,
  onToggle,
  onAbrirLote,
  onNovaCompra,
}: {
  mes: CompraGastoMes;
  hoje: string;
  aberto: boolean;
  podeEditar: boolean;
  loteMap: Map<string, CompraGastoLote>;
  rascunho?: string;
  onRascunho: (texto: string) => void;
  onCommitOrcamento: (texto: string) => void;
  onToggle: () => void;
  onAbrirLote: (id: string) => void;
  onNovaCompra: () => void;
}) {
  const atual = mes.ym === hoje.slice(0, 7);
  const estouro = mes.temOrcamento && mes.comprometido > mes.orcamento;

  return (
    <>
      <tr
        id={`gc-mes-${mes.ym}`}
        className={`${styles.monthRow} ${aberto ? styles.monthRowOpen : ""}`}
        onClick={onToggle}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <td>
          <span className={styles.mrowLabel}>
            <span className={`${styles.caret} ${aberto ? styles.caretOpen : ""}`}>▶</span>
            {mesLongo(mes.ym)}
            {atual && <span className={styles.todayFlag}>hoje</span>}
          </span>
        </td>
        <td className={styles.num} onClick={(e) => e.stopPropagation()}>
          <span className={styles.budgetCell}>
            <input
              className={styles.budgetInput}
              value={rascunho ?? (mes.temOrcamento ? money(mes.orcamento) : "")}
              placeholder="definir"
              disabled={!podeEditar}
              aria-label={`Orçamento de ${mesLongo(mes.ym)}`}
              onChange={(e) => onRascunho(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => onCommitOrcamento(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            {podeEditar && <span className={styles.pencil}>✎</span>}
          </span>
        </td>
        <td className={styles.num}>
          {money(mes.comprometido)}
          {mes.estimado > 0 && <> <span className={styles.tag}>est</span></>}
        </td>
        <td className={`${styles.num} ${styles.muted}`}>{mes.pago ? money(mes.pago) : "—"}</td>
        <td className={`${styles.num} ${styles.muted}`}>{mes.aPagar ? money(mes.aPagar) : "—"}</td>
        <td
          className={`${styles.num} ${
            !mes.temOrcamento ? styles.muted : mes.saldo >= 0 ? styles.pos : styles.neg
          }`}
          title={mes.temOrcamento ? undefined : "orçamento deste mês ainda não definido"}
        >
          {mes.temOrcamento ? `${mes.saldo < 0 ? "−" : ""}${money(Math.abs(mes.saldo))}` : "—"}
        </td>
        <td className={`${styles.num} ${styles.muted}`}>
          {mes.lotes.length || "—"}
          {estouro && " ▲"}
        </td>
      </tr>

      {aberto && (
        <tr>
          <td className={styles.detailCell} colSpan={7}>
            <div className={styles.detailInner}>
              {mes.lotes.length === 0 && (
                <div className={styles.loteEmpty}>
                  Nenhuma compra vence neste mês.
                  {mes.temOrcamento
                    ? ` Orçamento de ${brl(mes.orcamento)} inteiro disponível.`
                    : " Orçamento ainda não definido — preencha na coluna Orçamento."}
                </div>
              )}

              {mes.lotes.length > 0 && (
                <div className={styles.loteList}>
                  {mes.lotes.map((ref) => {
                    const lote = loteMap.get(ref.loteId);
                    if (!lote) return null;
                    const status = loteStatus(lote, hoje);
                    const atraso = diasAtraso(lote, hoje);
                    const idade = diasEntre(lote.dataCompra, hoje);
                    const chegada = lote.chegadaReal
                      ? `chegou ${dataBr(lote.chegadaReal)}`
                      : lote.chegadaIni
                        ? `prev. ${dataCurta(lote.chegadaIni)}`
                        : "sem previsão de chegada";

                    return (
                      <button
                        type="button"
                        className={styles.lote}
                        key={`${lote.id}-${ref.parcelasNoMes}`}
                        onClick={() => onAbrirLote(lote.id)}
                      >
                        <span className={styles.loteId}>
                          <span className={styles.loteCode}>
                            {codigoDistinto(lote.codigo, lote.titulo) ?? lote.titulo}
                            <span
                              className={`${styles.tag} ${
                                lote.origem === "transito" || lote.origem === "salva"
                                  ? styles.tagLinked
                                  : ""
                              }`}
                            >
                              {lote.origem === "transito"
                                ? "Compra em trânsito"
                                : lote.origem === "salva"
                                  ? "Compra Salva"
                                  : lote.origem === "premier"
                                    ? `Premier · ${lote.itens.length} itens`
                                    : lote.origem === "itens"
                                      ? `${lote.itens.length} linhas`
                                      : "valor único"}
                            </span>
                            {ref.totalParcelas > 1 && (
                              <span className={styles.tag}>
                                {ref.parcelasNoMes} de {ref.totalParcelas} parcelas
                              </span>
                            )}
                          </span>
                          {codigoDistinto(lote.codigo, lote.titulo) && (
                            <span className={styles.loteDesc}>{lote.titulo}</span>
                          )}
                        </span>
                        <span className={styles.loteMeta}>
                          {COMPRA_GASTO_TIPO_LABEL[lote.tipo]}
                          <b>compra {dataBr(lote.dataCompra)}</b>
                        </span>
                        <span className={styles.loteMeta}>
                          {chegada}
                          <b>
                            {atraso > 0
                              ? `${atraso} dias de atraso`
                              : `${idade} dias desde a compra`}
                          </b>
                        </span>
                        <span>
                          <span className={`${styles.pill} ${TOM_CLASSE[status.tom]}`}>
                            <i />
                            {status.label}
                          </span>
                        </span>
                        <span className={styles.loteVal}>
                          {money(ref.valor)}
                          {ref.pago > 0 && ref.pago < ref.valor && (
                            <span className={styles.loteValSub}>{money(ref.pago)} pago</span>
                          )}
                          {ref.pago > 0 && ref.pago >= ref.valor && (
                            <span className={styles.loteValSub}>pago</span>
                          )}
                        </span>
                        <span className={styles.loteArrow}>›</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {podeEditar && (
                <div>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSm}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNovaCompra();
                    }}
                  >
                    + Lançar compra em {mesCurto(mes.ym)}
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
