"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthContext";
import type {
  ExtratoResponse,
  ProdutoCorOption,
  ProdutoFilialOption,
  ProdutoLookupResponse,
} from "@/app/api/admin/extrato-produto/route";

// ── Constantes ──────────────────────────────────────────────────────────────

const TIPO_CORES: Record<string, string> = {
  "LOJA ENTRADAS":  "#22c55e",
  "ENTRADA NORMAL": "#86efac",
  "LOJA SAIDAS":    "#f97316",
  "SAIDA NORMAL":   "#fdba74",
  "LOJA VENDAS":    "#ef4444",
};

const STATUS_TRANSITO: Record<number, string> = {
  0: "Aguardando",
  2: "Em trânsito",
  3: "Recebido",
  4: "Liberado",
  5: "Encerrado",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtNum(n: number) {
  return n === 0 ? "0" : n > 0 ? `+${n}` : `${n}`;
}

function badge(tipo: string) {
  const color = TIPO_CORES[tipo] ?? "#94a3b8";
  return (
    <span
      style={{
        background: color + "22",
        color,
        border: `1px solid ${color}55`,
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {tipo}
    </span>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function ExtratoPage() {
  const { user } = useAuth();
  const [produto, setProduto] = useState("");
  const [cor, setCor] = useState("");
  const [filial, setFilial] = useState("");
  const [dados, setDados] = useState<ExtratoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [lookupMsg, setLookupMsg] = useState("");
  const [coresDisponiveis, setCoresDisponiveis] = useState<ProdutoCorOption[]>([]);
  const [filiaisDisponiveis, setFiliaisDisponiveis] = useState<ProdutoFilialOption[]>([]);
  const [tiposFiltro, setTiposFiltro] = useState<string[]>([]);
  const [mostrarZeroGrade, setMostrarZeroGrade] = useState(true);
  const corRef = useRef(cor);
  const tableRef = useRef<HTMLDivElement>(null);

  const authHeader = useCallback(
    (): Record<string, string> =>
      user ? { "X-Auth-Username": user.username } : {},
    [user]
  );

  useEffect(() => {
    corRef.current = cor;
  }, [cor]);

  useEffect(() => {
    if (!user) return;
    const termo = produto.trim();
    if (termo.length < 2) {
      setCoresDisponiveis([]);
      setFiliaisDisponiveis([]);
      setLookupMsg("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLookupLoading(true);
      setLookupMsg("");
      try {
        const params = new URLSearchParams({ produto: termo, lookup: "1" });
        if (corRef.current.trim()) params.set("cor", corRef.current.trim());
        const res = await fetch(`/api/admin/extrato-produto?${params}`, {
          headers: authHeader(),
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao buscar cores");

        const lookup = json as ProdutoLookupResponse;
        setCoresDisponiveis(lookup.coresDisponiveis ?? []);
        setFiliaisDisponiveis(lookup.filiaisDisponiveis ?? []);

        if (lookup.barcodeMatched && lookup.produto) {
          setProduto(lookup.produto);
          setLookupMsg(
            lookup.codigoBarra
              ? `Código ${lookup.codigoBarra} localizado.`
              : "Código de barras localizado."
          );
        }

        if (lookup.cor && lookup.cor !== corRef.current) {
          setCor(lookup.cor);
        } else if (
          lookup.coresDisponiveis.length === 1 &&
          lookup.coresDisponiveis[0].cor !== corRef.current
        ) {
          setCor(lookup.coresDisponiveis[0].cor);
        } else if (
          corRef.current &&
          lookup.coresDisponiveis.length > 0 &&
          !lookup.coresDisponiveis.some((item) => item.cor === corRef.current)
        ) {
          setCor("");
        }

        if (
          filial.trim() &&
          lookup.filiaisDisponiveis.length > 0 &&
          !lookup.filiaisDisponiveis.some((item) => item.filial === filial.trim())
        ) {
          setFilial("");
        }
      } catch (ex) {
        if ((ex as Error).name !== "AbortError") {
          setCoresDisponiveis([]);
          setFiliaisDisponiveis([]);
          setLookupMsg((ex as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setLookupLoading(false);
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [produto, cor, filial, user, authHeader]);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (!produto.trim()) {
      setErro("Preencha Produto ou Código de Barras.");
      return;
    }
    setLoading(true);
    setErro("");
    setDados(null);

    try {
      const params = new URLSearchParams({ produto: produto.trim() });
      if (cor.trim()) params.set("cor", cor.trim());
      if (filial.trim()) params.set("filial", filial.trim());

      const res = await fetch(`/api/admin/extrato-produto?${params}`, {
        headers: authHeader(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao buscar");
      setDados(json as ExtratoResponse);
      setProduto((json as ExtratoResponse).produto);
      setCor((json as ExtratoResponse).cor);
      setCoresDisponiveis((json as ExtratoResponse).coresDisponiveis ?? []);
      setFiliaisDisponiveis((json as ExtratoResponse).filiaisDisponiveis ?? []);
      setTiposFiltro([]); // reset filtro
    } catch (ex) {
      setErro((ex as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  // ── Filtros e saldo corrente ──
  const tiposDisponiveis = dados
    ? [...new Set(dados.linhas.map((l) => l.tipo))].sort()
    : [];
  const saldoMovimentos = dados
    ? dados.linhas.reduce((s, l) => s + l.qtde, 0)
    : 0;
  const saldoGrade = dados
    ? dados.linhas.reduce((s, l) => s + l.qtdeGrade, 0)
    : 0;
  const diferencaEstoque = dados ? dados.estoqueAtual - saldoMovimentos : 0;

  const linhasFiltradas = dados
    ? dados.linhas.filter((l) => {
        if (tiposFiltro.length > 0 && !tiposFiltro.includes(l.tipo)) return false;
        if (!mostrarZeroGrade && l.qtdeGrade === 0) return false;
        return true;
      })
    : [];

  // Saldo corrente acumulado pelo movimento total declarado em QTDE.
  let saldo = 0;
  const linhasComSaldo = linhasFiltradas.map((l) => {
    saldo += l.qtde;
    return { ...l, saldoAcumulado: saldo };
  });

  // Totais por tipo
  const totaisPorTipo = tiposDisponiveis.map((tipo) => {
    const ls = dados!.linhas.filter((l) => l.tipo === tipo);
    return {
      tipo,
      qtde: ls.reduce((s, l) => s + l.qtde, 0),
      qtdeGrade: ls.reduce((s, l) => s + l.qtdeGrade, 0),
      count: ls.length,
    };
  });

  return (
    <main style={{ padding: "24px 32px", fontFamily: "var(--font-mono, monospace)", minHeight: "100vh", background: "#0f172a", color: "#e2e8f0" }}>
      {/* ── Cabeçalho ── */}
      <div style={{ marginBottom: 24 }}>
        <Link href="/admin" style={{ color: "#94a3b8", textDecoration: "none", fontSize: 13 }}>
          ← Admin
        </Link>
        <h1 style={{ margin: "8px 0 4px", fontSize: 22, color: "#f1f5f9" }}>
          Extrato de Produto
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
          Visualiza todos os movimentos de estoque de um produto+cor+filial, mostrando a diferença
          entre o campo QTDE (total) e o campo de grade (EN_1/SA_1 → 90x90).
        </p>
      </div>

      {/* ── Formulário ── */}
      <form onSubmit={buscar} style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#94a3b8" }}>
          Produto ou código de barras *
          <input
            type="text"
            value={produto}
            onChange={(e) => {
              setProduto(e.target.value);
              setDados(null);
              setFiliaisDisponiveis([]);
            }}
            placeholder="Ex: 13.71.0365 ou 789..."
            style={inputStyle}
            required
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#94a3b8" }}>
          Cor *
          {coresDisponiveis.length > 0 ? (
            <select
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              style={{ ...inputStyle, width: 220 }}
              required
            >
              <option value="">Selecione</option>
              {coresDisponiveis.map((item) => (
                <option key={item.cor} value={item.cor}>
                  {item.cor} - {item.descCor ?? "sem descrição"} ({item.estoqueAtual} un)
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              placeholder="Ex: 03"
              style={{ ...inputStyle, width: 80 }}
            />
          )}
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#94a3b8" }}>
          Filial
          {filiaisDisponiveis.length > 0 ? (
            <select
              value={filial}
              onChange={(e) => setFilial(e.target.value)}
              style={{ ...inputStyle, width: 260 }}
            >
              <option value="">Todas juntas</option>
              {filiaisDisponiveis.map((item) => (
                <option key={item.filial} value={item.filial}>
                  {item.filial} ({item.estoqueAtual} un)
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={filial}
              onChange={(e) => setFilial(e.target.value)}
              placeholder="Todas juntas ou Ex: GUARULHOS"
              style={inputStyle}
            />
          )}
        </label>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "8px 20px",
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            height: 38,
          }}
        >
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {(lookupLoading || lookupMsg || coresDisponiveis.length > 0 || filiaisDisponiveis.length > 0) && (
        <div style={{ marginTop: -14, marginBottom: 18, fontSize: 12, color: lookupMsg.includes("Erro") ? "#fca5a5" : "#94a3b8" }}>
          {lookupLoading
            ? "Buscando cores e filiais disponíveis..."
            : lookupMsg ||
              `${coresDisponiveis.length} cor${coresDisponiveis.length === 1 ? "" : "es"} e ${filiaisDisponiveis.length} ${filiaisDisponiveis.length === 1 ? "filial" : "filiais"} disponíveis para este produto.`}
        </div>
      )}

      {erro && (
        <div style={{ background: "#450a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 16px", color: "#fca5a5", marginBottom: 16, fontSize: 13 }}>
          {erro}
        </div>
      )}

      {/* ── Resultado ── */}
      {dados && (
        <>
          {/* Info do produto */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
            <InfoCard label="Produto" value={`${dados.produto} — ${dados.descProduto ?? "?"}`} />
            <InfoCard label="Cor" value={`${dados.cor} — ${dados.descCor ?? "?"}`} />
            {dados.codigoBarra && <InfoCard label="Código barra" value={dados.codigoBarra} />}
            <InfoCard label="Grade" value={dados.grade ?? "—"} highlight />
            <InfoCard label="Filial" value={dados.filial} />
            <InfoCard label="Estoque atual" value={`${dados.estoqueAtual} un`} highlight />
            <InfoCard label="Saldo QTDE" value={`${saldoMovimentos} un`} />
            <InfoCard label="Saldo grade" value={`${saldoGrade} un`} />
            <InfoCard label="Diferença" value={`${diferencaEstoque} un`} highlight={diferencaEstoque !== 0} />
            <InfoCard label="Movimentos" value={`${dados.linhas.length}`} />
          </div>

          {/* Sumário por tipo */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 8px" }}>Resumo por tipo de movimento:</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {totaisPorTipo.map((t) => (
                <div
                  key={t.tipo}
                  onClick={() =>
                    setTiposFiltro((prev) =>
                      prev.includes(t.tipo) ? prev.filter((x) => x !== t.tipo) : [...prev, t.tipo]
                    )
                  }
                  style={{
                    background: tiposFiltro.includes(t.tipo) ? (TIPO_CORES[t.tipo] ?? "#94a3b8") + "33" : "#1e293b",
                    border: `1px solid ${tiposFiltro.includes(t.tipo) ? (TIPO_CORES[t.tipo] ?? "#94a3b8") : "#334155"}`,
                    borderRadius: 8,
                    padding: "8px 14px",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <div style={{ fontSize: 11, color: TIPO_CORES[t.tipo] ?? "#94a3b8", marginBottom: 2 }}>{t.tipo}</div>
                  <div style={{ fontSize: 13, color: "#f1f5f9" }}>
                    {t.count}x · QTDE: <span style={{ fontWeight: 700 }}>{fmtNum(t.qtde)}</span>
                    {t.qtde !== t.qtdeGrade && (
                      <span style={{ color: "#f59e0b", marginLeft: 8, fontSize: 11 }}>
                        Grade: {fmtNum(t.qtdeGrade)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Filtros extras */}
          <div style={{ display: "flex", gap: 16, marginBottom: 14, alignItems: "center", fontSize: 12, color: "#94a3b8" }}>
            <label style={{ display: "flex", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={mostrarZeroGrade}
                onChange={(e) => setMostrarZeroGrade(e.target.checked)}
              />
              Mostrar movimentos com grade = 0
            </label>
            {tiposFiltro.length > 0 && (
              <button
                onClick={() => setTiposFiltro([])}
                style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 12 }}
              >
                Limpar filtro de tipo
              </button>
            )}
            <span style={{ marginLeft: "auto" }}>
              {linhasFiltradas.length} de {dados.linhas.length} movimentos
            </span>
          </div>

          {/* Tabela */}
          <div
            ref={tableRef}
            style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #1e293b" }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1e293b", color: "#94a3b8" }}>
                  <th style={th}>Data</th>
                  <th style={th}>Tipo</th>
                  <th style={th}>Tipo Romaneio</th>
                  <th style={th}>Documento</th>
                  <th style={th}>Filial Origem</th>
                  <th style={th}>Filial Destino</th>
                  <th style={{ ...th, color: "#f1f5f9" }}>QTDE</th>
                  <th style={{ ...th, color: "#f59e0b" }}>Grade ({dados.grade ?? "?"})</th>
                  <th style={{ ...th, color: "#22d3ee" }}>Saldo</th>
                  <th style={th}>Preço</th>
                  <th style={th}>Status Trânsito</th>
                  <th style={th}>Atualizou Est.</th>
                  <th style={th}>OBS</th>
                </tr>
              </thead>
              <tbody>
                {linhasComSaldo.map((l, i) => {
                  const diverge = l.qtde !== 0 && l.qtdeGrade === 0;
                  return (
                    <tr
                      key={i}
                      style={{
                        background: diverge
                          ? "#451a03"
                          : i % 2 === 0
                          ? "#0f172a"
                          : "#111827",
                        borderBottom: "1px solid #1e293b",
                      }}
                    >
                      <td style={td}>{fmtDate(l.emissao)}</td>
                      <td style={td}>{badge(l.tipo)}</td>
                      <td style={{ ...td, color: "#94a3b8", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.tipoRomaneio ?? "—"}
                      </td>
                      <td style={{ ...td, fontFamily: "monospace", color: "#7dd3fc" }}>
                        {l.doc}
                      </td>
                      <td style={{ ...td, color: "#94a3b8", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.filialOrigem ?? "—"}
                      </td>
                      <td style={{ ...td, color: "#94a3b8", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.filialDestino ?? "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: l.qtde > 0 ? "#86efac" : l.qtde < 0 ? "#fca5a5" : "#64748b", fontWeight: 700 }}>
                        {fmtNum(l.qtde)}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: l.qtdeGrade > 0 ? "#fde68a" : l.qtdeGrade < 0 ? "#fdba74" : (diverge ? "#f59e0b" : "#64748b"), fontWeight: 700 }}>
                        {diverge ? (
                          <span title="Grade zerada! QTDE tem valor mas EN_1/SA_1 = 0. Pode causar divergência no extrato Linx.">
                            ⚠ {fmtNum(l.qtdeGrade)}
                          </span>
                        ) : (
                          fmtNum(l.qtdeGrade)
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: "#22d3ee", fontWeight: 700 }}>
                        {l.saldoAcumulado}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: "#94a3b8" }}>
                        {l.preco > 0 ? `R$ ${l.preco.toFixed(2)}` : "—"}
                      </td>
                      <td style={{ ...td, color: "#94a3b8" }}>
                        {l.statusTransito != null
                          ? STATUS_TRANSITO[l.statusTransito] ?? l.statusTransito
                          : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {l.atualizouEstoque == null
                          ? "—"
                          : l.atualizouEstoque
                          ? <span style={{ color: "#22c55e" }}>✓</span>
                          : <span style={{ color: "#ef4444" }}>✗</span>}
                      </td>
                      <td style={{ ...td, color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={l.obs ?? undefined}>
                        {l.obs ?? "—"}
                      </td>
                    </tr>
                  );
                })}
                {linhasComSaldo.length === 0 && (
                  <tr>
                    <td colSpan={13} style={{ ...td, textAlign: "center", color: "#475569", padding: 32 }}>
                      Nenhum movimento encontrado com os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Legenda */}
          <div style={{ marginTop: 20, padding: 16, background: "#1e293b", borderRadius: 8, fontSize: 12, color: "#64748b" }}>
            <p style={{ margin: "0 0 8px", color: "#94a3b8", fontWeight: 600 }}>Legenda</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
              <div>
                <strong style={{ color: "#f1f5f9" }}>QTDE</strong> — campo total declarado no romaneio
              </div>
              <div>
                <strong style={{ color: "#f59e0b" }}>Grade ({dados.grade ?? "?"})</strong> — campo EN_1/SA_1 (grade específica)
              </div>
              <div>
                <strong style={{ color: "#22d3ee" }}>Saldo</strong> — acumulado cronológico pelo campo QTDE
              </div>
              <div>
                <strong style={{ color: "#f59e0b" }}>⚠ Grade zerada</strong> — QTDE tem valor mas EN_1/SA_1 = 0 → divergência no Linx
              </div>
              <div>
                <strong>Status Trânsito 4 = Liberado</strong> — entrada liberada do trânsito pela tela de liberação
              </div>
              <div>
                <strong>ENTRADA NORMAL</strong> — tabela ESTOQUE_PROD_ENT (inclui transferências, ajustes, produção)
              </div>
              <div>
                <strong>SAIDA NORMAL</strong> — tabela ESTOQUE_PROD_SAI (inclui transferências, ajustes)
              </div>
              <div>
                <strong>LOJA ENTRADAS</strong> — tabela LOJA_ENTRADAS (romaneios confirmados via loja)
              </div>
            </div>
          </div>

          {/* Erros da API */}
          {dados.erros.length > 0 && (
            <div style={{ marginTop: 16, padding: 12, background: "#1c1917", border: "1px solid #44403c", borderRadius: 6, fontSize: 11, color: "#78716c" }}>
              <p style={{ margin: "0 0 6px" }}>Avisos da API:</p>
              {dados.erros.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </>
      )}
    </main>
  );
}

// ── Sub-componentes ─────────────────────────────────────────────────────────

function InfoCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      background: "#1e293b",
      border: `1px solid ${highlight ? "#334155" : "#1e293b"}`,
      borderRadius: 8,
      padding: "8px 14px",
      minWidth: 100,
    }}>
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: highlight ? "#f59e0b" : "#f1f5f9" }}>{value}</div>
    </div>
  );
}

// ── Estilos inline ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  color: "#f1f5f9",
  fontSize: 13,
  width: 180,
  outline: "none",
};

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
  borderBottom: "1px solid #334155",
};

const td: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 12,
  verticalAlign: "middle",
};
