"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { normalizarTexto } from "@/lib/financeiro/normalizacao";

import { BarrasHorizontais, GraficoBarrasMensal } from "./Graficos";
import {
  type FiltroInicialLancamentos,
  brl,
  compacto,
  dataBr,
  inteiro,
  mesCurto,
  valorCelula,
  useFinanceiroApi,
} from "./shared";
import styles from "./ControleFinanceiro.module.css";

interface Opcao {
  chave: string;
  rotulo: string;
  n: number;
}

interface Opcoes {
  abas: Opcao[];
  classificacoes: Opcao[];
  matrizes: Opcao[];
  lojas: Opcao[];
  status: Opcao[];
  formas: Opcao[];
  dataMin: string | null;
  dataMax: string | null;
}

interface Lancamento {
  id: number;
  aba: string;
  linha: number;
  dataCompetencia: string | null;
  dataCaixa: string | null;
  mesCompetencia: string | null;
  mesCaixa: string | null;
  valor: number | null;
  descricao: string | null;
  matriz: string | null;
  loja: string | null;
  classificacao: string | null;
  formaPgto: string | null;
  status: string | null;
  banco: string | null;
  contaContabil: string | null;
  colecao: string | null;
  extras: Record<string, unknown>;
  /** Como está na planilha, quando a forma normalizada é diferente. */
  original: Partial<Record<"descricao" | "classificacao" | "loja" | "matriz" | "formaPgto" | "colecao", string>>;
}

interface Resposta {
  total: number;
  soma: number;
  saidas: number;
  entradas: number;
  pendente: number;
  itens: Lancamento[];
  porMes: { mes: string; soma: number; n: number }[];
  porClassificacao: { chave: string; rotulo: string; soma: number; n: number }[];
  porAba: { aba: string; soma: number; n: number }[];
}

interface Filtros {
  abas: string[];
  classificacao: string;
  matriz: string;
  loja: string;
  status: string;
  forma: string;
  data: "competencia" | "caixa";
  de: string;
  ate: string;
  mes: string;
  sinal: string;
  q: string;
  ordem: string;
}

const POR_PAGINA = 100;

const ROTULO_ORIGINAL: Record<string, string> = {
  descricao: "descrição",
  classificacao: "classificação",
  loja: "loja",
  matriz: "matriz",
  formaPgto: "forma de pgto",
  colecao: "coleção",
};

/** Rótulo cru vindo da DRE ("Folha - VAREJO") → a forma normalizada usada nas opções. */
const normalizarClassificacao = (v?: string) => (v ? (normalizarTexto(v, "classificacao") ?? v) : "");

function filtrosPadrao(ano: number): Filtros {
  return {
    abas: [],
    classificacao: "",
    matriz: "",
    loja: "",
    status: "",
    forma: "",
    data: "competencia",
    de: `${ano}-01-01`,
    ate: `${ano}-12-31`,
    mes: "",
    sinal: "",
    q: "",
    ordem: "data_desc",
  };
}

const paramsDe = (f: Filtros) => ({
  abas: f.abas,
  classificacoes: f.classificacao ? [f.classificacao] : undefined,
  matrizes: f.matriz ? [f.matriz] : undefined,
  lojas: f.loja ? [f.loja] : undefined,
  status: f.status,
  forma: f.forma,
  data: f.data,
  de: f.mes ? "" : f.de,
  ate: f.mes ? "" : f.ate,
  mes: f.mes,
  sinal: f.sinal,
  q: f.q.trim(),
  ordem: f.ordem,
});

export default function Lancamentos({
  companyKey,
  anoPadrao,
  inicial,
  onDrillAplicado,
}: {
  companyKey: string;
  anoPadrao: number;
  inicial: FiltroInicialLancamentos | null;
  /** Avisa o pai para não reaplicar o drill-down quando a aba for reaberta. */
  onDrillAplicado: () => void;
}) {
  const api = useFinanceiroApi(companyKey);
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [f, setF] = useState<Filtros>(() =>
    inicial
      ? { ...filtrosPadrao(anoPadrao), classificacao: normalizarClassificacao(inicial.classificacao), mes: inicial.mes ?? "" }
      : filtrosPadrao(anoPadrao)
  );
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const [exportando, setExportando] = useState(false);

  // Drill-down vindo da DRE: classificação × mês de competência.
  useEffect(() => {
    if (!inicial) return;
    setF({ ...filtrosPadrao(anoPadrao), classificacao: normalizarClassificacao(inicial.classificacao), mes: inicial.mes ?? "" });
    setBusca("");
    setPagina(1);
    onDrillAplicado();
  }, [inicial, anoPadrao, onDrillAplicado]);

  useEffect(() => {
    if (!api.pronto) return;
    api
      .get<Opcoes>("/lancamentos", { opcoes: 1 })
      .then(setOpcoes)
      .catch(() => setOpcoes(null));
  }, [api]);

  useEffect(() => {
    const t = setTimeout(() => {
      setF((v) => (v.q === busca ? v : { ...v, q: busca }));
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    setCarregando(true);
    api
      .get<Resposta>("/lancamentos", { ...paramsDe(f), pagina, porPagina: POR_PAGINA })
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro ao carregar"))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [api, f, pagina]);

  const mudar = (patch: Partial<Filtros>) => {
    setF((v) => ({ ...v, ...patch }));
    setPagina(1);
    setAberto(null);
  };

  const meses = useMemo(() => (dados?.porMes ?? []).map((m) => m.mes), [dados]);
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / POR_PAGINA)) : 1;

  const exportar = async () => {
    if (!dados) return;
    setExportando(true);
    try {
      const linhas: Lancamento[] = [];
      const total = Math.min(dados.total, 50000);
      for (let p = 1; linhas.length < total; p++) {
        const r = await api.get<Resposta>("/lancamentos", { ...paramsDe(f), pagina: p, porPagina: 1000 });
        linhas.push(...r.itens);
        if (!r.itens.length) break;
      }
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(
        linhas.map((l) => ({
          Aba: l.aba,
          "Linha na planilha": l.linha,
          "Data competência": l.dataCompetencia,
          "Data caixa": l.dataCaixa,
          "Mês competência": l.mesCompetencia,
          "Mês caixa": l.mesCaixa,
          Valor: l.valor,
          Descrição: l.descricao,
          Classificação: l.classificacao,
          Matriz: l.matriz,
          "Loja / Shopping": l.loja,
          Coleção: l.colecao,
          "Forma de pgto": l.formaPgto,
          Status: l.status,
          Banco: l.banco,
          "Classificação contábil": l.contaContabil,
          ...Object.fromEntries(Object.entries(l.extras).map(([k, v]) => [`[${k}]`, v])),
        }))
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Lançamentos");
      XLSX.writeFile(wb, `lancamentos-financeiro-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao exportar");
    } finally {
      setExportando(false);
    }
  };

  const sel = (label: string, valor: string, lista: Opcao[] | undefined, onChange: (v: string) => void) => (
    <label className={styles.campo}>
      <span>{label}</span>
      <select className={styles.select} value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {valor && !lista?.some((o) => o.chave === valor.toLowerCase() || o.chave === valor) && (
          <option value={valor}>{valor}</option>
        )}
        {(lista ?? []).map((o) => (
          <option key={o.chave} value={o.chave}>
            {o.rotulo} ({inteiro(o.n)})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={styles.corpo}>
      <section className={styles.card}>
        <div className={styles.cardBody} style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={styles.chips}>
            {(opcoes?.abas ?? []).map((a) => {
              const ativo = f.abas.includes(a.chave);
              return (
                <button
                  key={a.chave}
                  type="button"
                  className={`${styles.chip} ${ativo ? styles.chipAtivo : ""}`}
                  onClick={() => mudar({ abas: ativo ? f.abas.filter((x) => x !== a.chave) : [...f.abas, a.chave] })}
                >
                  {a.rotulo}
                  <small>{inteiro(a.n)}</small>
                </button>
              );
            })}
          </div>
          <div className={styles.filtros}>
            <label className={styles.campo}>
              <span>Buscar</span>
              <input
                className={styles.input}
                placeholder="descrição, loja, coleção…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                style={{ width: 220 }}
              />
            </label>
            <label className={styles.campo}>
              <span>Data por</span>
              <select
                className={styles.select}
                value={f.data}
                onChange={(e) => mudar({ data: e.target.value as Filtros["data"] })}
              >
                <option value="competencia">Competência</option>
                <option value="caixa">Caixa</option>
              </select>
            </label>
            {f.mes ? (
              <label className={styles.campo}>
                <span>Mês de competência</span>
                <button type="button" className={`${styles.chip} ${styles.chipAtivo}`} onClick={() => mudar({ mes: "" })}>
                  {mesCurto(f.mes)} ×
                </button>
              </label>
            ) : (
              <>
                <label className={styles.campo}>
                  <span>De</span>
                  <input type="date" className={styles.input} value={f.de} onChange={(e) => mudar({ de: e.target.value })} />
                </label>
                <label className={styles.campo}>
                  <span>Até</span>
                  <input type="date" className={styles.input} value={f.ate} onChange={(e) => mudar({ ate: e.target.value })} />
                </label>
              </>
            )}
            {sel("Classificação", f.classificacao, opcoes?.classificacoes, (v) => mudar({ classificacao: v }))}
            {sel("Matriz", f.matriz, opcoes?.matrizes, (v) => mudar({ matriz: v }))}
            {sel("Loja / Shopping", f.loja, opcoes?.lojas, (v) => mudar({ loja: v }))}
            {sel("Status", f.status, opcoes?.status, (v) => mudar({ status: v }))}
            {sel("Forma de pgto", f.forma, opcoes?.formas, (v) => mudar({ forma: v }))}
            <label className={styles.campo}>
              <span>Sinal</span>
              <select className={styles.select} value={f.sinal} onChange={(e) => mudar({ sinal: e.target.value })}>
                <option value="">Saídas e entradas</option>
                <option value="saida">Só saídas</option>
                <option value="entrada">Só entradas</option>
              </select>
            </label>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                setBusca("");
                setF(filtrosPadrao(anoPadrao));
                setPagina(1);
              }}
            >
              Limpar
            </button>
            <button type="button" className={styles.btn} onClick={() => void exportar()} disabled={!dados?.total || exportando}>
              {exportando ? "Exportando…" : "Exportar Excel"}
            </button>
          </div>
        </div>
      </section>

      {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}

      {dados && (
        <div className={`${styles.corpo} ${carregando ? styles.carregando : ""}`}>
          <div className={styles.kpis}>
            <div className={`${styles.kpi} ${styles.kpiAccent}`}>
              <span className={styles.kpiLabel}>Saldo do filtro</span>
              <span className={`${styles.kpiValue} ${dados.soma < 0 ? styles.neg : ""}`}>{compacto(dados.soma)}</span>
              <span className={styles.kpiFoot}>{inteiro(dados.total)} lançamentos</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Saídas</span>
              <span className={styles.kpiValue}>{compacto(dados.saidas)}</span>
              <span className={styles.kpiFoot}>valores negativos</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Entradas / estornos</span>
              <span className={styles.kpiValue}>{compacto(dados.entradas)}</span>
              <span className={styles.kpiFoot}>valores positivos</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Pendente</span>
              <span className={styles.kpiValue}>{compacto(dados.pendente)}</span>
              <span className={styles.kpiFoot}>status PENDENTE no filtro</span>
            </div>
          </div>

          {meses.length > 1 && (
            <div className={styles.grid2}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>Por mês de {f.data === "caixa" ? "caixa" : "competência"}</h2>
                  <span className={styles.cardNote}>soma do filtro</span>
                </div>
                <GraficoBarrasMensal
                  meses={meses.slice(-36)}
                  series={[{ key: "s", label: "Saldo", cor: "var(--cf-s1)", valores: dados.porMes.slice(-36).map((m) => m.soma) }]}
                  empilhado={false}
                  divergente
                  altura={230}
                />
              </section>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>Por classificação</h2>
                  <span className={styles.cardNote}>clique para filtrar</span>
                </div>
                <div className={styles.cardBody}>
                  <BarrasHorizontais
                    itens={dados.porClassificacao.slice(0, 12).map((c) => ({
                      chave: c.chave,
                      rotulo: c.rotulo,
                      valor: c.soma,
                      nota: `${inteiro(c.n)}`,
                    }))}
                    onClick={(chave) => mudar({ classificacao: chave })}
                  />
                </div>
              </section>
            </div>
          )}

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Lançamentos</h2>
              <label className={styles.campo} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <span>Ordenar</span>
                <select className={styles.select} value={f.ordem} onChange={(e) => mudar({ ordem: e.target.value })}>
                  <option value="data_desc">Data (recente primeiro)</option>
                  <option value="data_asc">Data (antiga primeiro)</option>
                  <option value="valor_asc">Maior saída</option>
                  <option value="valor_desc">Maior entrada</option>
                </select>
              </label>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Competência</th>
                    <th>Caixa</th>
                    <th>Aba</th>
                    <th>Descrição</th>
                    <th>Classificação</th>
                    <th>Matriz</th>
                    <th>Loja</th>
                    <th>Status</th>
                    <th className={styles.num}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((l) => (
                    <Fragment key={l.id}>
                      <tr className={styles.rowClick} onClick={() => setAberto(aberto === l.id ? null : l.id)}>
                        <td className={styles.nowrap}>{dataBr(l.dataCompetencia)}</td>
                        <td className={styles.nowrap}>{dataBr(l.dataCaixa)}</td>
                        <td className={styles.nowrap}>{l.aba}</td>
                        <td className={styles.desc} title={l.original.descricao ? `Na planilha: ${l.original.descricao}` : undefined}>
                          {l.descricao}
                        </td>
                        <td>{l.classificacao}</td>
                        <td>{l.matriz}</td>
                        <td>{l.loja}</td>
                        <td>
                          {l.status && (
                            <span
                              className={`${styles.pill} ${
                                l.status.toUpperCase() === "PAGO"
                                  ? styles.pillPago
                                  : l.status.toUpperCase() === "PENDENTE"
                                    ? styles.pillPendente
                                    : styles.pillMute
                              }`}
                            >
                              {l.status}
                            </span>
                          )}
                        </td>
                        <td className={`${styles.num} ${(l.valor ?? 0) < 0 ? styles.neg : ""}`}>{brl(l.valor)}</td>
                      </tr>
                      {aberto === l.id && (
                        <tr className={styles.extraRow}>
                          <td colSpan={9}>
                            <div className={styles.extras}>
                              {Object.entries(l.original).map(([k, v]) => (
                                <div key={`o-${k}`}>
                                  <span>Na planilha ({ROTULO_ORIGINAL[k] ?? k})</span>
                                  {v}
                                </div>
                              ))}
                              <div>
                                <span>Linha na planilha</span>
                                {l.aba} · {l.linha}
                              </div>
                              {l.colecao && (
                                <div>
                                  <span>Coleção</span>
                                  {l.colecao}
                                </div>
                              )}
                              <div>
                                <span>Forma de pgto</span>
                                {l.formaPgto ?? "—"}
                              </div>
                              {l.banco && (
                                <div>
                                  <span>Banco</span>
                                  {l.banco}
                                </div>
                              )}
                              {l.contaContabil && (
                                <div>
                                  <span>Classificação contábil</span>
                                  {l.contaContabil}
                                </div>
                              )}
                              <div>
                                <span>Mês competência / caixa</span>
                                {mesCurto(l.mesCompetencia)} / {mesCurto(l.mesCaixa)}
                              </div>
                              {Object.entries(l.extras).map(([k, v]) => (
                                <div key={k}>
                                  <span>{k}</span>
                                  {valorCelula(v)}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {!dados.itens.length && (
                    <tr>
                      <td colSpan={9} className={styles.muted}>
                        Nenhum lançamento no filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className={styles.paginacao}>
              <span>
                {inteiro(dados.total)} lançamentos · página {pagina} de {inteiro(paginas)}
              </span>
              <div>
                <button type="button" className={styles.btn} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                  Anterior
                </button>
                <button type="button" className={styles.btn} disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
                  Próxima
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {!dados && !erro && <div className={styles.aviso}>Carregando lançamentos…</div>}
    </div>
  );
}
