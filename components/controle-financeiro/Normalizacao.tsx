"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type CampoNormalizado,
  CAMPOS_NORMALIZADOS,
  ROTULO_CAMPO_NORMALIZADO,
  chaveTexto,
} from "@/lib/financeiro/normalizacao";

import { dataHoraBr, inteiro, useFinanceiroApi } from "./shared";
import styles from "./ControleFinanceiro.module.css";

interface ResumoCampo {
  campo: CampoNormalizado;
  grafias: number;
  valores: number;
  registros: number;
  registrosAjustados: number;
}

interface Regra {
  id?: number;
  tipo: "palavra" | "valor";
  campo: CampoNormalizado | null;
  de: string;
  para: string;
  status?: string;
  criadoPor?: string | null;
  criadoEm?: string;
}

interface Meta {
  resumo: ResumoCampo[];
  regras: Regra[];
  embutidas: Regra[];
  podeEditar: boolean;
}

interface Grupo {
  valor: string;
  total: number;
  variantes: { v: string; n: number }[];
}

interface SugPalavra {
  de: string;
  ocorrencias: number;
  para: string;
  ocorrenciasPara: number;
  exemplos: string[];
}

interface SugValor {
  campo: CampoNormalizado;
  de: string;
  ocorrencias: number;
  para: string;
  ocorrenciasPara: number;
}

const chaveSemAcento = (s: string) => chaveTexto(s);

const somaAlterados =(a: Record<string, number> | undefined) => Object.values(a ?? {}).reduce((t, n) => t + n, 0);

export default function Normalizacao({ companyKey, onMudou }: { companyKey: string; onMudou: () => void }) {
  const api = useFinanceiroApi(companyKey);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [campo, setCampo] = useState<CampoNormalizado>("descricao");
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [todas, setTodas] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [sug, setSug] = useState<{ palavras: SugPalavra[]; valores: SugValor[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [verEmbutidas, setVerEmbutidas] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBusca(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    api
      .get<Meta>("/normalizacao", { visao: "resumo" })
      .then((m) => vivo && setMeta(m))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro"));
    api
      .get<{ palavras: SugPalavra[]; valores: SugValor[] }>("/normalizacao", { visao: "sugestoes" })
      .then((s) => vivo && setSug(s))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [api, versao]);

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    api
      .get<{ grupos: Grupo[] }>("/normalizacao", { visao: "unificacoes", campo, q: busca, todas: todas ? 1 : 0 })
      .then((r) => vivo && setGrupos(r.grupos))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro"));
    return () => {
      vivo = false;
    };
  }, [api, campo, busca, todas, versao]);

  const decidir = useCallback(
    async (chave: string, regra: Regra, acao: "aprovar" | "rejeitar") => {
      setOcupado(chave);
      setErro(null);
      try {
        const r = await api.send<{ alterados?: Record<string, number> }>("/normalizacao", "POST", { acao, ...regra });
        const n = somaAlterados(r.alterados);
        setAviso(
          acao === "aprovar"
            ? `Regra gravada: “${regra.de}” → “${regra.para}”. ${inteiro(n)} registro(s) atualizado(s).`
            : `“${regra.de}” e “${regra.para}” ficam separados — a sugestão não volta.`
        );
        // Tira da lista na hora; o resto recarrega em segundo plano.
        setSug((s) =>
          s
            ? {
                palavras: s.palavras.filter((p) => !(regra.tipo === "palavra" && p.de === regra.de) && p.de !== regra.para),
                valores: s.valores.filter(
                  (v) => !(v.campo === regra.campo && [regra.de, regra.para].includes(v.de) && [regra.de, regra.para].includes(v.para))
                ),
              }
            : s
        );
        setVersao((v) => v + 1);
        if (acao === "aprovar") onMudou();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao gravar");
      } finally {
        setOcupado(null);
      }
    },
    [api, onMudou]
  );

  const remover = async (r: Regra) => {
    if (!r.id) return;
    setOcupado(`r${r.id}`);
    try {
      const res = await api.send<{ alterados?: Record<string, number> }>("/normalizacao", "POST", { acao: "remover", id: r.id });
      setAviso(`Regra removida. ${inteiro(somaAlterados(res.alterados))} registro(s) voltaram à forma anterior.`);
      setVersao((v) => v + 1);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      setOcupado(null);
    }
  };

  const pode = !!meta?.podeEditar;
  const regrasTela = meta?.regras ?? [];
  const embutidasPalavras = (meta?.embutidas ?? []).filter((r) => r.tipo === "palavra");
  const embutidasValores = (meta?.embutidas ?? []).filter((r) => r.tipo === "valor");

  return (
    <div className={styles.corpo}>
      <div className={`${styles.aviso} ${styles.avisoInfo}`}>
        O texto da planilha <b>nunca é alterado</b>: a forma normalizada é uma camada de leitura usada nas telas,
        filtros e totais. Em todo upload, os textos novos passam pelas mesmas regras: <b>1)</b> formatação padrão
        (espaços, maiúsculas/minúsculas, siglas como ICMS e NF, conectivos “de/da/do” em minúsculas); <b>2)</b>{" "}
        acentuação de palavras comuns (cartao → cartão); <b>3)</b> correções e unificações de uma lista fechada,
        revisada à mão. Grafias parecidas que podem ser coisas diferentes nunca são juntadas sozinhas: elas aparecem
        em “Sugestões para revisar”.
      </div>
      {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}
      {aviso && <div className={styles.aviso}>{aviso}</div>}

      {meta && (
        <div className={styles.kpis}>
          {meta.resumo.map((r) => (
            <button
              key={r.campo}
              type="button"
              className={`${styles.kpi} ${r.campo === campo ? styles.kpiAccent : ""}`}
              style={{ textAlign: "left", cursor: "pointer", font: "inherit" }}
              onClick={() => setCampo(r.campo)}
            >
              <span className={styles.kpiLabel}>{ROTULO_CAMPO_NORMALIZADO[r.campo]}</span>
              <span className={styles.kpiValue}>
                {inteiro(r.grafias)} → {inteiro(r.valores)}
              </span>
              <span className={styles.kpiFoot}>
                grafias → valores · <b>{inteiro(r.registrosAjustados)}</b> de {inteiro(r.registros)} registros com texto
                ajustado
              </span>
            </button>
          ))}
        </div>
      )}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Como ficou · {ROTULO_CAMPO_NORMALIZADO[campo]}</h2>
          <div className={styles.filtros}>
            <select className={styles.select} value={campo} onChange={(e) => setCampo(e.target.value as CampoNormalizado)}>
              {CAMPOS_NORMALIZADOS.map((c) => (
                <option key={c} value={c}>
                  {ROTULO_CAMPO_NORMALIZADO[c]}
                </option>
              ))}
            </select>
            <input className={styles.input} placeholder="buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className={styles.chip} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
              incluir os que só mudaram a formatação
            </label>
          </div>
        </div>
        <div className={styles.tableScroll} style={{ maxHeight: 460 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Como aparece agora</th>
                <th className={styles.num}>Registros</th>
                <th>Grafias na planilha</th>
              </tr>
            </thead>
            <tbody>
              {(grupos ?? []).map((g) => (
                <tr key={g.valor}>
                  <td className={styles.desc}>
                    <b>{g.valor}</b>
                  </td>
                  <td className={styles.num}>{inteiro(g.total)}</td>
                  <td>
                    <div className={styles.diff}>
                      {g.variantes.map((v) => (
                        <span key={v.v} className={styles.muted}>
                          “{v.v}” <small>({inteiro(v.n)})</small>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {grupos && !grupos.length && (
                <tr>
                  <td colSpan={3} className={styles.muted}>
                    Nada encontrado.
                  </td>
                </tr>
              )}
              {!grupos && (
                <tr>
                  <td colSpan={3} className={styles.muted}>
                    Carregando…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Sugestões para revisar</h2>
          <span className={styles.cardNote}>
            parecidas, mas não certamente iguais — só viram regra com a sua confirmação
            {!pode ? " (só o administrador decide)" : ""}
          </span>
        </div>
        {!sug && <div className={styles.cardBody}>Calculando sugestões…</div>}
        {sug && (
          <div className={styles.grid2} style={{ padding: "0 16px 16px" }}>
            <div>
              <div className={styles.kpiLabel} style={{ margin: "4px 0 8px" }}>
                Valores ({sug.valores.length}) — loja, classificação, coleção
              </div>
              <div className={styles.tableScroll} style={{ maxHeight: 520 }}>
                <table className={styles.table}>
                  <tbody>
                    {sug.valores.map((s) => {
                      const chave = `v|${s.campo}|${s.de}|${s.para}`;
                      const regra = (de: string, para: string): Regra => ({ tipo: "valor", campo: s.campo, de, para });
                      return (
                        <tr key={chave}>
                          <td>
                            <div className={styles.muted} style={{ fontSize: 11 }}>
                              {ROTULO_CAMPO_NORMALIZADO[s.campo]}
                            </div>
                            “{s.de}” <small className={styles.muted}>({inteiro(s.ocorrencias)})</small> ×{" "}
                            “{s.para}” <small className={styles.muted}>({inteiro(s.ocorrenciasPara)})</small>
                          </td>
                          {pode && (
                            <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                              <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                <button
                                  type="button"
                                  className={styles.btn}
                                  disabled={!!ocupado}
                                  onClick={() => void decidir(chave, regra(s.de, s.para), "aprovar")}
                                  title={`Tudo vira “${s.para}”`}
                                >
                                  usar “{s.para}”
                                </button>
                                <button
                                  type="button"
                                  className={styles.btn}
                                  disabled={!!ocupado}
                                  onClick={() => void decidir(chave, regra(s.para, s.de), "aprovar")}
                                  title={`Tudo vira “${s.de}”`}
                                >
                                  usar “{s.de}”
                                </button>
                                <button
                                  type="button"
                                  className={styles.btn}
                                  disabled={!!ocupado}
                                  title="Nenhuma das duas está certa: digite a forma correta"
                                  onClick={() => {
                                    const certo = window.prompt(`Forma correta para “${s.de}” e “${s.para}”:`, s.para)?.trim();
                                    if (!certo) return;
                                    // As duas grafias passam a virar a forma digitada.
                                    void (async () => {
                                      await decidir(chave, regra(s.de, certo), "aprovar");
                                      if (chaveSemAcento(s.para) !== chaveSemAcento(certo)) {
                                        await decidir(`${chave}|2`, regra(s.para, certo), "aprovar");
                                      }
                                    })();
                                  }}
                                >
                                  outro…
                                </button>
                                <button
                                  type="button"
                                  className={styles.btn}
                                  disabled={!!ocupado}
                                  onClick={() => void decidir(chave, regra(s.de, s.para), "rejeitar")}
                                >
                                  são diferentes
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {!sug.valores.length && (
                      <tr>
                        <td className={styles.muted}>Nenhuma sugestão pendente.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className={styles.kpiLabel} style={{ margin: "4px 0 8px" }}>
                Palavras nas descrições ({sug.palavras.length}) — rara × frequente, uma letra de diferença
              </div>
              <div className={styles.tableScroll} style={{ maxHeight: 520 }}>
                <table className={styles.table}>
                  <tbody>
                    {sug.palavras.map((s) => {
                      const chave = `p|${s.de}`;
                      const regra: Regra = { tipo: "palavra", campo: null, de: s.de, para: s.para };
                      return (
                        <tr key={chave}>
                          <td>
                            “{s.de}” <small className={styles.muted}>({inteiro(s.ocorrencias)})</small> → “{s.para}”{" "}
                            <small className={styles.muted}>({inteiro(s.ocorrenciasPara)})</small>
                            <div className={styles.muted} style={{ fontSize: 11.5 }}>
                              {s.exemplos.join(" · ")}
                            </div>
                          </td>
                          {pode && (
                            <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                              <div style={{ display: "inline-flex", gap: 6 }}>
                                <button
                                  type="button"
                                  className={styles.btn}
                                  disabled={!!ocupado}
                                  onClick={() => void decidir(chave, regra, "aprovar")}
                                >
                                  corrigir
                                </button>
                                <button
                                  type="button"
                                  className={styles.btn}
                                  disabled={!!ocupado}
                                  onClick={() => void decidir(chave, regra, "rejeitar")}
                                >
                                  manter
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {!sug.palavras.length && (
                      <tr>
                        <td className={styles.muted}>Nenhuma sugestão pendente.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Regras</h2>
          <span className={styles.cardNote}>
            {embutidasPalavras.length} correções de palavras e {embutidasValores.length} unificações de valores no
            dicionário base ·{" "}
            <button type="button" className={styles.btnLink} onClick={() => setVerEmbutidas((v) => !v)}>
              {verEmbutidas ? "esconder" : "ver"} dicionário base
            </button>
          </span>
        </div>
        <div className={styles.tableScroll} style={{ maxHeight: 420 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Origem</th>
                <th>Tipo</th>
                <th>De</th>
                <th>Para</th>
                <th>Quem / quando</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {regrasTela.map((r) => (
                <tr key={`t${r.id}`}>
                  <td>
                    <span className={`${styles.pill} ${r.status === "aprovada" ? styles.pillNovo : styles.pillMute}`}>
                      {r.status === "aprovada" ? "aprovada" : "mantidas separadas"}
                    </span>
                  </td>
                  <td>{r.tipo === "palavra" ? "palavra" : ROTULO_CAMPO_NORMALIZADO[r.campo!]}</td>
                  <td>{r.de}</td>
                  <td>{r.para}</td>
                  <td className={styles.muted}>
                    {r.criadoPor} · {dataHoraBr(r.criadoEm)}
                  </td>
                  <td>
                    {pode && (
                      <button type="button" className={styles.btnLink} disabled={!!ocupado} onClick={() => void remover(r)}>
                        desfazer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!regrasTela.length && !verEmbutidas && (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    Nenhuma regra criada na tela ainda.
                  </td>
                </tr>
              )}
              {verEmbutidas &&
                [...embutidasValores, ...embutidasPalavras].map((r) => (
                  <tr key={`e${r.tipo}${r.campo}${r.de}`}>
                    <td>
                      <span className={`${styles.pill} ${styles.pillMute}`}>dicionário base</span>
                    </td>
                    <td>{r.tipo === "palavra" ? "palavra" : ROTULO_CAMPO_NORMALIZADO[r.campo!]}</td>
                    <td>{r.de}</td>
                    <td>{r.para}</td>
                    <td className={styles.muted}>revisada na criação</td>
                    <td />
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
