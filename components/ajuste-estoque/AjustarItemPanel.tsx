"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./AjusteEstoquePage.module.css";

interface ItemFilial {
  cod: string;
  nome: string;
  estoque: number;
}

interface ItemCandidato {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  estoquePositivo: number;
  filiais: ItemFilial[];
}

interface FilialAlvo {
  cod: string;
  nome: string;
  ativa: boolean;
}

interface SaldoLinha {
  produto: string;
  cor: string;
  filialCod: string;
  estoque: number;
}

interface DetalheExecucao {
  cod: string;
  filial: string;
  nomeContagem: string;
  itensAjustados: number;
  somaDelta: number;
  semDiferenca: number;
}

interface ResultadoAjuste {
  filiaisAjustadas: number;
  itensAjustados: number;
  somaDelta: number;
  detalhes: DetalheExecucao[];
  falhas: Array<{ filial: string; erro: string }>;
}

interface Props {
  companyKey: CompanyKey;
  username: string;
  onExecuted: () => void;
}

function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function chave(c: { produto: string; cor: string }): string {
  return `${c.produto}|${c.cor}`;
}

function chaveLinha(produto: string, cor: string, filialCod: string): string {
  return `${produto}|${cor}|${filialCod}`;
}

export default function AjustarItemPanel({ companyKey, username, onExecuted }: Props) {
  const [termo, setTermo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ItemCandidato[]>([]);
  const [buscou, setBuscou] = useState(false);
  const [buscaErro, setBuscaErro] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const [selecionados, setSelecionados] = useState<Map<string, ItemCandidato>>(new Map());
  const [filiais, setFiliais] = useState<FilialAlvo[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [carregandoSaldo, setCarregandoSaldo] = useState(false);
  const [recarga, setRecarga] = useState(0);

  /** Quantidade alvo digitada por linha (item×filial). Vazio = não alterar. */
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [preencherValor, setPreencherValor] = useState("");

  const [filialFiltro, setFilialFiltro] = useState(""); // "" = todas
  const [ocultarSemEstoque, setOcultarSemEstoque] = useState(true);
  const [dataContagem, setDataContagem] = useState(hojeISO());
  const [obs, setObs] = useState("");

  const [confirmando, setConfirmando] = useState(false);
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [progresso, setProgresso] = useState<{ atual: number; total: number; filial: string } | null>(
    null
  );
  const [resultado, setResultado] = useState<ResultadoAjuste | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    const q = termo.trim();
    if (q.length < 2) {
      setBuscaErro("Digite ao menos 2 caracteres (código, descrição ou código de barra).");
      return;
    }
    setBuscando(true);
    setBuscaErro(null);
    setBuscou(true);
    setResultado(null);
    try {
      const r = await fetch(
        `/api/ajuste-estoque/item/buscar?company=${companyKey}&q=${encodeURIComponent(q)}`
      );
      const d = await r.json();
      if (!r.ok) {
        setBuscaErro(d?.error ?? "Erro ao buscar itens.");
        setResultados([]);
        return;
      }
      setResultados(Array.isArray(d?.itens) ? d.itens : []);
    } catch {
      setBuscaErro("Erro de conexão ao buscar itens.");
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }, [termo, companyKey]);

  const toggleSelecionado = useCallback((item: ItemCandidato) => {
    setResultado(null);
    setErro(null);
    setSelecionados((prev) => {
      const next = new Map(prev);
      const k = chave(item);
      if (next.has(k)) next.delete(k);
      else next.set(k, item);
      return next;
    });
  }, []);

  const removerSelecionado = useCallback((k: string) => {
    setSelecionados((prev) => {
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
  }, []);

  const toggleExpandido = useCallback((k: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const itensSelecionados = useMemo(() => [...selecionados.values()], [selecionados]);

  // Matriz de saldo atual (item × filial) — inclui filial onde o item está zerado.
  useEffect(() => {
    if (itensSelecionados.length === 0) {
      setFiliais([]);
      setSaldos({});
      return;
    }
    let ativo = true;
    setCarregandoSaldo(true);
    fetch("/api/ajuste-estoque/item/saldo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: companyKey,
        itens: itensSelecionados.map((i) => ({ produto: i.produto, cor: i.cor })),
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!ativo) return;
        if (d?.error) {
          setErro(d.error);
          return;
        }
        setFiliais(Array.isArray(d?.filiais) ? d.filiais : []);
        const mapa: Record<string, number> = {};
        for (const s of (Array.isArray(d?.saldos) ? d.saldos : []) as SaldoLinha[]) {
          mapa[chaveLinha(s.produto, s.cor, s.filialCod)] = Number(s.estoque) || 0;
        }
        setSaldos(mapa);
      })
      .catch(() => {
        if (ativo) setErro("Erro ao carregar o saldo dos itens selecionados.");
      })
      .finally(() => {
        if (ativo) setCarregandoSaldo(false);
      });
    return () => {
      ativo = false;
    };
  }, [itensSelecionados, companyKey, recarga]);

  // Se a filial filtrada sair do escopo, volta para "todas".
  const filialFiltroValido =
    filialFiltro && filiais.some((f) => f.cod === filialFiltro) ? filialFiltro : "";

  interface LinhaEdicao {
    key: string;
    produto: string;
    descProduto: string;
    cor: string;
    descCor: string;
    filialCod: string;
    filialNome: string;
    filialAtiva: boolean;
    estoque: number;
    bruto: string;
    alvo: number | null;
    invalido: boolean;
    delta: number;
  }

  const linhas = useMemo<LinhaEdicao[]>(() => {
    const out: LinhaEdicao[] = [];
    for (const item of itensSelecionados) {
      for (const f of filiais) {
        if (filialFiltroValido && f.cod !== filialFiltroValido) continue;
        const key = chaveLinha(item.produto, item.cor, f.cod);
        const estoque = saldos[key] ?? 0;
        const bruto = quantidades[key] ?? "";
        const temValor = bruto.trim() !== "";
        // Sem valor digitado, linha zerada é só ruído — mas nunca esconde o que foi digitado.
        if (ocultarSemEstoque && estoque === 0 && !temValor) continue;
        const alvoNum = temValor ? Number(bruto) : null;
        const invalido =
          temValor && (!Number.isInteger(alvoNum) || (alvoNum as number) < 0);
        const alvo = temValor && !invalido ? (alvoNum as number) : null;
        out.push({
          key,
          produto: item.produto,
          descProduto: item.descProduto,
          cor: item.cor,
          descCor: item.descCor,
          filialCod: f.cod,
          filialNome: f.nome,
          filialAtiva: f.ativa,
          estoque,
          bruto,
          alvo,
          invalido,
          delta: alvo === null ? 0 : alvo - estoque,
        });
      }
    }
    return out;
  }, [itensSelecionados, filiais, saldos, quantidades, filialFiltroValido, ocultarSemEstoque]);

  const alteradas = useMemo(() => linhas.filter((l) => l.alvo !== null && l.delta !== 0), [linhas]);
  const invalidas = useMemo(() => linhas.filter((l) => l.invalido), [linhas]);
  const semMudanca = useMemo(
    () => linhas.filter((l) => l.alvo !== null && l.delta === 0).length,
    [linhas]
  );

  const totais = useMemo(() => {
    const filiaisSet = new Set(alteradas.map((l) => l.filialCod));
    return {
      linhas: alteradas.length,
      filiais: filiaisSet.size,
      somaDelta: alteradas.reduce((s, l) => s + l.delta, 0),
      entradas: alteradas.filter((l) => l.delta > 0).length,
      saidas: alteradas.filter((l) => l.delta < 0).length,
    };
  }, [alteradas]);

  const setQuantidade = useCallback((key: string, valor: string) => {
    setResultado(null);
    setErro(null);
    setQuantidades((prev) => {
      const next = { ...prev };
      if (valor === "") delete next[key];
      else next[key] = valor;
      return next;
    });
  }, []);

  /** Preenche a mesma quantidade em todas as linhas visíveis (respeita o filtro de filial). */
  const aplicarEmTodas = useCallback(
    (valor: string) => {
      const v = valor.trim();
      if (v === "") return;
      setResultado(null);
      setErro(null);
      setQuantidades((prev) => {
        const next = { ...prev };
        for (const l of linhas) next[l.key] = v;
        return next;
      });
    },
    [linhas]
  );

  const limparQuantidades = useCallback(() => {
    setQuantidades({});
    setPreencherValor("");
  }, []);

  const podeAplicar = alteradas.length > 0 && invalidas.length === 0 && !executando;

  const executar = useCallback(async () => {
    if (alteradas.length === 0) return;

    // Uma contagem por filial → cada ajuste fica no extrato e pode ser desfeito só ele.
    const porFilial = new Map<string, { nome: string; itens: LinhaEdicao[] }>();
    for (const l of alteradas) {
      const grupo = porFilial.get(l.filialCod) ?? { nome: l.filialNome, itens: [] };
      grupo.itens.push(l);
      porFilial.set(l.filialCod, grupo);
    }
    const grupos = [...porFilial.entries()];

    setExecutando(true);
    setErro(null);
    setProgresso({ atual: 0, total: grupos.length, filial: grupos[0][1].nome });

    const detalhes: DetalheExecucao[] = [];
    const falhas: Array<{ filial: string; erro: string }> = [];
    let itensAjustados = 0;
    let somaDelta = 0;

    for (let i = 0; i < grupos.length; i++) {
      const [cod, grupo] = grupos[i];
      setProgresso({ atual: i, total: grupos.length, filial: grupo.nome });
      try {
        const r = await fetch("/api/ajuste-estoque/item/executar", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            company: companyKey,
            filialCod: cod,
            dataContagem,
            obs: obs.trim() || null,
            itens: grupo.itens.map((l) => ({
              produto: l.produto,
              cor: l.cor,
              quantidade: l.alvo,
            })),
          }),
        });
        const d = await r.json();
        if (!r.ok) {
          falhas.push({ filial: grupo.nome, erro: d?.error ?? "Erro ao aplicar." });
        } else {
          detalhes.push({
            cod: d.cod ?? cod,
            filial: d.filial ?? grupo.nome,
            nomeContagem: d.nomeContagem,
            itensAjustados: Number(d.itensAjustados) || 0,
            somaDelta: Number(d.somaDelta) || 0,
            semDiferenca: Number(d.semDiferenca) || 0,
          });
          itensAjustados += Number(d.itensAjustados) || 0;
          somaDelta += Number(d.somaDelta) || 0;
        }
      } catch {
        falhas.push({ filial: grupo.nome, erro: "Erro de conexão." });
      }
      setProgresso({ atual: i + 1, total: grupos.length, filial: grupo.nome });
    }

    setExecutando(false);
    setProgresso(null);
    setConfirmCheck(false);
    setConfirmando(false);

    if (detalhes.length === 0) {
      setErro(falhas[0]?.erro ?? "Não foi possível aplicar o ajuste.");
      return;
    }

    setResultado({ filiaisAjustadas: detalhes.length, itensAjustados, somaDelta, detalhes, falhas });
    setQuantidades({});
    setPreencherValor("");
    setRecarga((n) => n + 1); // recarrega os saldos já com o ajuste aplicado
    onExecuted();
  }, [alteradas, username, companyKey, dataContagem, obs, onExecuted]);

  return (
    <>
      {/* ── Busca de itens ── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>1. Buscar itens</h2>
        <p className={styles.fileHintMuted}>
          Procure por código do produto, descrição ou código de barra e selecione os itens. Depois
          você digita a quantidade que o estoque <strong>deve ficar</strong> em cada filial — o
          sistema calcula a diferença e registra o ajuste (dá pra desfazer). Para zerar, é a mesma
          coisa: quantidade <strong>0</strong> na filial que você quiser, ou o botão “Zerar todas”.
        </p>
        <div className={styles.searchRow}>
          <input
            type="text"
            className={styles.input}
            value={termo}
            placeholder="Ex.: 030650, LENÇO SEDA, 7891234…"
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") buscar();
            }}
          />
          <button type="button" className={styles.primaryBtn} onClick={buscar} disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </div>
        {buscaErro && <span className={styles.erro}>{buscaErro}</span>}

        {buscou && !buscando && resultados.length === 0 && !buscaErro && (
          <p className={styles.fileHintMuted}>
            Nenhum item encontrado para “{termo.trim()}”.
          </p>
        )}

        {resultados.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Produto</th>
                  <th>Descrição</th>
                  <th>Cor</th>
                  <th className={styles.num}>Filiais</th>
                  <th className={styles.num}>Estoque</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((item) => {
                  const k = chave(item);
                  const aberto = expandidos.has(k);
                  const marcado = selecionados.has(k);
                  const comSaldo = item.filiais.filter((f) => f.estoque !== 0);
                  return (
                    <Fragment key={k}>
                      <tr className={marcado ? styles.rowDiff : ""}>
                        <td className={styles.num}>
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() => toggleSelecionado(item)}
                          />
                        </td>
                        <td className={styles.mono}>{item.produto}</td>
                        <td>{item.descProduto || "—"}</td>
                        <td>{item.descCor || item.cor || "—"}</td>
                        <td className={styles.num}>
                          <button
                            type="button"
                            className={styles.linkBtn}
                            onClick={() => toggleExpandido(k)}
                          >
                            {aberto ? "▾" : "▸"} {comSaldo.length}
                          </button>
                        </td>
                        <td className={styles.num}>
                          {item.estoquePositivo.toLocaleString("pt-BR")}
                        </td>
                      </tr>
                      {aberto && (
                        <tr>
                          <td colSpan={6} className={styles.detalheCell}>
                            {comSaldo.length === 0 ? (
                              <span className={styles.fileHintMuted}>
                                Sem estoque em nenhuma filial — selecione para lançar a quantidade.
                              </span>
                            ) : (
                              <div className={styles.chips}>
                                {comSaldo.map((f) => (
                                  <span
                                    key={f.cod || f.nome}
                                    className={`${styles.chip} ${
                                      f.estoque < 0 ? styles.chipNeg : ""
                                    }`}
                                  >
                                    {f.nome}: <strong>{f.estoque}</strong>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Quantidade por filial ── */}
      {itensSelecionados.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>
            2. Quantidade por filial — {itensSelecionados.length} item(ns) selecionado(s)
          </h2>

          <div className={styles.chips}>
            {itensSelecionados.map((item) => {
              const k = chave(item);
              return (
                <span key={k} className={styles.chip}>
                  {item.produto} · {item.descCor || item.cor || "—"}
                  <button
                    type="button"
                    className={styles.chipClose}
                    onClick={() => removerSelecionado(k)}
                    aria-label="Remover"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>

          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.label}>Filial</span>
              <select
                className={styles.input}
                value={filialFiltroValido}
                onChange={(e) => setFilialFiltro(e.target.value)}
              >
                <option value="">Todas as filiais</option>
                {filiais.map((f) => (
                  <option key={f.cod} value={f.cod}>
                    {f.nome} ({f.cod}){f.ativa ? "" : " — não utilizada"}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Data da contagem (início do dia)</span>
              <input
                type="date"
                className={styles.input}
                value={dataContagem}
                onChange={(e) => setDataContagem(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Observação (opcional)</span>
              <input
                type="text"
                className={styles.input}
                value={obs}
                placeholder="Observações do ajuste…"
                onChange={(e) => setObs(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Responsável</span>
              <input className={styles.input} value={username || "—"} disabled readOnly />
            </label>
          </div>

          <div className={styles.tableHeaderRow}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={ocultarSemEstoque}
                onChange={(e) => setOcultarSemEstoque(e.target.checked)}
              />
              Ocultar filiais onde o item está zerado
              {ocultarSemEstoque ? " (desmarque para lançar quantidade onde não há estoque)" : ""}
            </label>
            <div className={styles.searchRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => aplicarEmTodas("0")}
                disabled={linhas.length === 0}
                title={
                  filialFiltroValido
                    ? "Zera o item somente na filial filtrada"
                    : "Zera o item em todas as filiais listadas"
                }
              >
                🧹 Zerar {filialFiltroValido ? "esta filial" : `todas (${linhas.length})`}
              </button>
              <input
                type="number"
                min={0}
                step={1}
                className={styles.qtyInput}
                value={preencherValor}
                placeholder="qtde"
                onChange={(e) => setPreencherValor(e.target.value)}
              />
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => aplicarEmTodas(preencherValor)}
                disabled={preencherValor.trim() === "" || linhas.length === 0}
              >
                Aplicar às {linhas.length} linha(s)
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={limparQuantidades}
                disabled={Object.keys(quantidades).length === 0}
              >
                Limpar
              </button>
            </div>
          </div>

          <div className={styles.totaisBar}>
            <div className={`${styles.totalBox} ${styles.totalBoxDestaque}`}>
              <span className={styles.totalLabel}>Linhas a alterar</span>
              <span className={styles.totalValor}>{totais.linhas}</span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Filiais no escopo</span>
              <span className={styles.totalValor}>{totais.filiais}</span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Variação líquida</span>
              <span
                className={`${styles.totalValor} ${
                  totais.somaDelta < 0 ? styles.neg : styles.pos
                }`}
              >
                {totais.somaDelta > 0 ? "+" : ""}
                {totais.somaDelta.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Entradas (+)</span>
              <span className={`${styles.totalValor} ${styles.pos}`}>{totais.entradas}</span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Saídas (−)</span>
              <span className={`${styles.totalValor} ${styles.neg}`}>{totais.saidas}</span>
            </div>
          </div>

          {(invalidas.length > 0 || semMudanca > 0) && (
            <div className={styles.avisos}>
              {invalidas.length > 0 && (
                <span className={styles.aviso}>
                  ⚠ {invalidas.length} quantidade(s) inválida(s) — use números inteiros ≥ 0.
                </span>
              )}
              {semMudanca > 0 && (
                <span className={styles.aviso}>
                  ℹ {semMudanca} linha(s) com a quantidade igual ao saldo atual — serão ignoradas.
                </span>
              )}
            </div>
          )}

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Descrição</th>
                  <th>Cor</th>
                  <th>Filial</th>
                  <th className={styles.num}>Estoque atual</th>
                  <th className={styles.num}>Nova quantidade</th>
                  <th className={styles.num}>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, 1000).map((l) => (
                  <tr key={l.key} className={l.delta !== 0 ? styles.rowDiff : ""}>
                    <td className={styles.mono}>{l.produto}</td>
                    <td>{l.descProduto || "—"}</td>
                    <td>{l.descCor || l.cor || "—"}</td>
                    <td>
                      {l.filialNome}
                      {!l.filialAtiva && (
                        <span className={styles.hint}> (não utilizada)</span>
                      )}
                    </td>
                    <td className={`${styles.num} ${l.estoque < 0 ? styles.neg : ""}`}>
                      {l.estoque}
                    </td>
                    <td className={styles.num}>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className={`${styles.qtyInput} ${l.invalido ? styles.qtyInputErro : ""}`}
                        value={l.bruto}
                        placeholder={String(l.estoque)}
                        onChange={(e) => setQuantidade(l.key, e.target.value)}
                      />
                    </td>
                    <td
                      className={`${styles.num} ${
                        l.delta < 0 ? styles.neg : l.delta > 0 ? styles.pos : ""
                      }`}
                    >
                      {l.alvo === null ? "—" : `${l.delta > 0 ? "+" : ""}${l.delta}`}
                    </td>
                  </tr>
                ))}
                {linhas.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.fileHintMuted}>
                      {carregandoSaldo
                        ? "Carregando saldo por filial…"
                        : ocultarSemEstoque
                        ? "Nenhuma filial com estoque para os itens selecionados. Desmarque “Ocultar filiais onde o item está zerado” para lançar quantidade."
                        : "Nenhuma filial no escopo."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {linhas.length > 1000 && (
              <p className={styles.fileHintMuted}>
                Mostrando 1000 de {linhas.length.toLocaleString("pt-BR")} linhas — filtre por filial
                para ver o resto.
              </p>
            )}
          </div>

          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={() => {
                setConfirmCheck(false);
                setConfirmando(true);
              }}
              disabled={!podeAplicar}
            >
              Aplicar ajuste ({totais.linhas} linha{totais.linhas === 1 ? "" : "s"})
            </button>
            {erro && <span className={styles.erro}>{erro}</span>}
          </div>
        </section>
      )}

      {/* ── Resultado ── */}
      {resultado && (
        <section className={`${styles.card} ${styles.sucesso}`}>
          <h2 className={styles.sucessoTitle}>✅ Ajuste aplicado</h2>
          <p>
            <strong>{resultado.itensAjustados}</strong> linha(s) ajustada(s) em{" "}
            <strong>{resultado.filiaisAjustadas}</strong> filial(is), variação líquida{" "}
            <strong>
              {resultado.somaDelta > 0 ? "+" : ""}
              {resultado.somaDelta.toLocaleString("pt-BR")}
            </strong>{" "}
            un.
          </p>
          <p className={styles.fileHintMuted}>
            Cada filial gerou uma contagem registrada (aparece no extrato dos produtos e em
            “Ajustes recentes”, onde pode ser desfeita individualmente).
          </p>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Filial</th>
                  <th>Descrição (extrato)</th>
                  <th className={styles.num}>Itens</th>
                  <th className={styles.num}>Variação</th>
                  <th className={styles.num}>Já batiam</th>
                </tr>
              </thead>
              <tbody>
                {resultado.detalhes.map((d) => (
                  <tr key={d.nomeContagem}>
                    <td>{d.filial}</td>
                    <td className={styles.mono}>{d.nomeContagem}</td>
                    <td className={styles.num}>{d.itensAjustados}</td>
                    <td
                      className={`${styles.num} ${d.somaDelta < 0 ? styles.neg : styles.pos}`}
                    >
                      {d.somaDelta > 0 ? "+" : ""}
                      {d.somaDelta}
                    </td>
                    <td className={styles.num}>{d.semDiferenca}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resultado.falhas.length > 0 && (
            <div className={styles.avisos}>
              {resultado.falhas.map((f, i) => (
                <span key={i} className={styles.aviso}>
                  ⚠ {f.filial}: {f.erro}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Modal de confirmação ── */}
      {confirmando && (
        <div className={styles.modalOverlay} onClick={() => !executando && setConfirmando(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Aplicar ajuste de item</h2>
            <p className={styles.modalText}>
              Linhas a alterar: <strong>{totais.linhas}</strong> em{" "}
              <strong>{totais.filiais}</strong> filial(is)
              <br />
              Variação líquida:{" "}
              <strong>
                {totais.somaDelta > 0 ? "+" : ""}
                {totais.somaDelta.toLocaleString("pt-BR")}
              </strong>{" "}
              un ({totais.entradas} entrada(s) / {totais.saidas} saída(s))
              <br />
              Data da contagem: <strong>{dataContagem.split("-").reverse().join("/")}</strong>
            </p>
            <p className={styles.modalWarn}>
              O estoque de cada item passa a ser exatamente a quantidade informada. A diferença é
              recalculada contra o saldo do momento da aplicação e registrada no extrato — dá pra
              desfazer depois em “Ajustes recentes”.
            </p>
            {executando && progresso ? (
              <div className={styles.progressWrap}>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFill}
                    style={{
                      width: `${(progresso.total ? progresso.atual / progresso.total : 0) * 100}%`,
                    }}
                  />
                </div>
                <span className={styles.progressText}>
                  Aplicando filial {Math.min(progresso.atual + 1, progresso.total)} de{" "}
                  {progresso.total}
                  {progresso.filial ? ` — ${progresso.filial}` : ""}…
                </span>
              </div>
            ) : (
              <label className={styles.confirmCheck}>
                <input
                  type="checkbox"
                  checked={confirmCheck}
                  onChange={(e) => setConfirmCheck(e.target.checked)}
                />
                Confirmo que revisei as quantidades e desejo aplicar o ajuste.
              </label>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setConfirmando(false)}
                disabled={executando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={executar}
                disabled={!confirmCheck || executando}
              >
                {executando && progresso
                  ? `Aplicando… ${progresso.atual}/${progresso.total}`
                  : executando
                  ? "Aplicando…"
                  : "Aplicar ajuste"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
