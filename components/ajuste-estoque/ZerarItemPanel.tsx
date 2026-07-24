"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
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

interface DetalheFilial {
  cod: string;
  filial: string;
  nomeContagem: string;
  itens: number;
  soma: number;
}

interface ResultadoZerar {
  filiaisAjustadas: number;
  itensZerados: number;
  somaDelta: number;
  detalhes: DetalheFilial[];
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

export default function ZerarItemPanel({ companyKey, username, onExecuted }: Props) {
  const [termo, setTermo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ItemCandidato[]>([]);
  const [buscou, setBuscou] = useState(false);
  const [buscaErro, setBuscaErro] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const [selecionados, setSelecionados] = useState<Map<string, ItemCandidato>>(new Map());
  const [filialAlvo, setFilialAlvo] = useState(""); // "" = todas
  const [dataContagem, setDataContagem] = useState(hojeISO());
  const [obs, setObs] = useState("");

  const [confirmando, setConfirmando] = useState(false);
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoZerar | null>(null);
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
    try {
      const r = await fetch(
        `/api/ajuste-estoque/zerar-item/buscar?company=${companyKey}&q=${encodeURIComponent(q)}`
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

  // Filiais disponíveis = união das filiais dos itens selecionados.
  const filiaisDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of itensSelecionados) {
      for (const f of item.filiais) if (f.cod) map.set(f.cod, f.nome);
    }
    return [...map.entries()]
      .map(([cod, nome]) => ({ cod, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [itensSelecionados]);

  // Se a filial alvo escolhida deixar de existir no escopo, volta para "todas".
  const filialAlvoValida = filialAlvo && filiaisDisponiveis.some((f) => f.cod === filialAlvo)
    ? filialAlvo
    : "";

  // Prévia do que será zerado (linhas item×filial dentro do escopo).
  const previa = useMemo(() => {
    const linhas: Array<{
      produto: string;
      descProduto: string;
      cor: string;
      descCor: string;
      filialCod: string;
      filialNome: string;
      estoque: number;
    }> = [];
    for (const item of itensSelecionados) {
      for (const f of item.filiais) {
        if (filialAlvoValida && f.cod !== filialAlvoValida) continue;
        linhas.push({
          produto: item.produto,
          descProduto: item.descProduto,
          cor: item.cor,
          descCor: item.descCor,
          filialCod: f.cod,
          filialNome: f.nome,
          estoque: f.estoque,
        });
      }
    }
    const filiaisSet = new Set(linhas.map((l) => l.filialCod));
    const unidades = linhas.reduce((s, l) => s + Math.max(0, l.estoque), 0);
    return { linhas, filiais: filiaisSet.size, unidades };
  }, [itensSelecionados, filialAlvoValida]);

  const podeZerar = previa.linhas.length > 0 && !executando;

  const executar = useCallback(async () => {
    setExecutando(true);
    setErro(null);
    try {
      const r = await fetch("/api/ajuste-estoque/zerar-item/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          itens: itensSelecionados.map((i) => ({ produto: i.produto, cor: i.cor })),
          filialCod: filialAlvoValida || null,
          dataContagem,
          obs: obs.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErro(d?.error ?? "Erro ao zerar itens.");
        setConfirmando(false);
        return;
      }
      setResultado(d as ResultadoZerar);
      setConfirmando(false);
      setSelecionados(new Map());
      onExecuted();
    } catch {
      setErro("Erro de conexão ao zerar itens.");
    } finally {
      setExecutando(false);
      setConfirmCheck(false);
    }
  }, [username, companyKey, itensSelecionados, filialAlvoValida, dataContagem, obs, onExecuted]);

  return (
    <>
      {/* ── Busca de itens ── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>1. Buscar itens</h2>
        <p className={styles.fileHintMuted}>
          Procure por código do produto, descrição ou código de barra. Selecione os itens que
          deseja zerar — o estoque de cada um nas filiais aparece abaixo.
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
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={buscar}
            disabled={buscando}
          >
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </div>
        {buscaErro && <span className={styles.erro}>{buscaErro}</span>}

        {buscou && !buscando && resultados.length === 0 && !buscaErro && (
          <p className={styles.fileHintMuted}>
            Nenhum item com estoque encontrado para “{termo.trim()}”.
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
                            {aberto ? "▾" : "▸"} {item.filiais.length}
                          </button>
                        </td>
                        <td className={styles.num}>
                          {item.estoquePositivo.toLocaleString("pt-BR")}
                        </td>
                      </tr>
                      {aberto && (
                        <tr>
                          <td colSpan={6} className={styles.detalheCell}>
                            <div className={styles.chips}>
                              {item.filiais.map((f) => (
                                <span
                                  key={f.cod || f.nome}
                                  className={`${styles.chip} ${f.estoque < 0 ? styles.chipNeg : ""}`}
                                >
                                  {f.nome}: <strong>{f.estoque}</strong>
                                </span>
                              ))}
                            </div>
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

      {/* ── Escopo + prévia ── */}
      {itensSelecionados.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>
            2. Escopo — {itensSelecionados.length} item(ns) selecionado(s)
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
              <span className={styles.label}>Filial alvo</span>
              <select
                className={styles.input}
                value={filialAlvoValida}
                onChange={(e) => setFilialAlvo(e.target.value)}
              >
                <option value="">Todas as filiais onde o item existir</option>
                {filiaisDisponiveis.map((f) => (
                  <option key={f.cod} value={f.cod}>
                    {f.nome} ({f.cod})
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
          </div>

          <div className={styles.totaisBar}>
            <div className={`${styles.totalBox} ${styles.totalBoxDestaque}`}>
              <span className={styles.totalLabel}>Linhas a zerar</span>
              <span className={styles.totalValor}>{previa.linhas.length}</span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Filiais no escopo</span>
              <span className={styles.totalValor}>{previa.filiais}</span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Unidades a remover</span>
              <span className={`${styles.totalValor} ${styles.neg}`}>
                −{previa.unidades.toLocaleString("pt-BR")}
              </span>
            </div>
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Descrição</th>
                  <th>Cor</th>
                  <th>Filial</th>
                  <th className={styles.num}>Estoque atual</th>
                  <th className={styles.num}>Após</th>
                </tr>
              </thead>
              <tbody>
                {previa.linhas.map((l) => (
                  <tr key={`${l.produto}|${l.cor}|${l.filialCod}`}>
                    <td className={styles.mono}>{l.produto}</td>
                    <td>{l.descProduto || "—"}</td>
                    <td>{l.descCor || l.cor || "—"}</td>
                    <td>{l.filialNome}</td>
                    <td className={`${styles.num} ${l.estoque < 0 ? styles.neg : ""}`}>
                      {l.estoque}
                    </td>
                    <td className={`${styles.num} ${styles.final}`}>0</td>
                  </tr>
                ))}
                {previa.linhas.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.fileHintMuted}>
                      Os itens selecionados não têm estoque na filial escolhida.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={() => {
                setConfirmCheck(false);
                setConfirmando(true);
              }}
              disabled={!podeZerar}
            >
              Zerar itens ({previa.linhas.length} linha{previa.linhas.length === 1 ? "" : "s"})
            </button>
            {erro && <span className={styles.erro}>{erro}</span>}
          </div>
        </section>
      )}

      {/* ── Resultado ── */}
      {resultado && (
        <section className={`${styles.card} ${styles.sucesso}`}>
          <h2 className={styles.sucessoTitle}>✅ Itens zerados</h2>
          <p>
            <strong>{resultado.itensZerados}</strong> linha(s) zerada(s) em{" "}
            <strong>{resultado.filiaisAjustadas}</strong> filial(is), removendo{" "}
            <strong>{resultado.somaDelta.toLocaleString("pt-BR")}</strong> un no total.
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
                </tr>
              </thead>
              <tbody>
                {resultado.detalhes.map((d) => (
                  <tr key={d.nomeContagem}>
                    <td>{d.filial}</td>
                    <td className={styles.mono}>{d.nomeContagem}</td>
                    <td className={styles.num}>{d.itens}</td>
                    <td className={`${styles.num} ${d.soma < 0 ? styles.neg : styles.pos}`}>
                      {d.soma > 0 ? "+" : ""}
                      {d.soma}
                    </td>
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
            <h2 className={styles.modalTitle}>Zerar itens</h2>
            <p className={styles.modalText}>
              Itens: <strong>{itensSelecionados.length}</strong>
              <br />
              Escopo:{" "}
              <strong>
                {filialAlvoValida
                  ? filiaisDisponiveis.find((f) => f.cod === filialAlvoValida)?.nome ??
                    filialAlvoValida
                  : "todas as filiais onde existirem"}
              </strong>
              <br />
              Linhas a zerar: <strong>{previa.linhas.length}</strong> em{" "}
              <strong>{previa.filiais}</strong> filial(is) · remove{" "}
              <strong>−{previa.unidades.toLocaleString("pt-BR")}</strong> un
            </p>
            <p className={styles.modalWarn}>
              Zera o estoque desses itens (fica 0) e registra no extrato. Dá pra desfazer depois em
              “Ajustes recentes”.
            </p>
            <label className={styles.confirmCheck}>
              <input
                type="checkbox"
                checked={confirmCheck}
                onChange={(e) => setConfirmCheck(e.target.checked)}
              />
              Confirmo que desejo zerar esses itens no escopo acima.
            </label>
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
                {executando ? "Aplicando…" : "Zerar itens"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
