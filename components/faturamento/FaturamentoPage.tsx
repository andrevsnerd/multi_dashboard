"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";
import type {
  NotasFiscaisResult,
  FaturamentoResumo,
  FaturamentoDimensoes,
  NotaFiscalDetalhe,
} from "@/lib/repositories/faturamento";

import styles from "./FaturamentoPage.module.css";

interface FaturamentoPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

type Aba = "notas" | "resumo";
type EmpresaFiltro = "" | "nerd" | "scarfme";

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const int = (v: number) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));
const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

function buildParams(base: {
  empresa: EmpresaFiltro;
  filial: string;
  natureza: string;
  cliente: string;
  nf: string;
  produto: string;
  range: DateRangeValue;
  incluirCanceladas: boolean;
  incluirDevolucoes: boolean;
}): URLSearchParams {
  const p = new URLSearchParams({
    start: base.range.startDate.toISOString(),
    end: base.range.endDate.toISOString(),
  });
  if (base.empresa) p.set("empresa", base.empresa);
  if (base.filial) p.set("filial", base.filial);
  if (base.natureza) p.set("naturezas", base.natureza);
  if (base.cliente.trim().length >= 2) p.set("cliente", base.cliente.trim());
  if (base.nf.trim()) p.set("nf", base.nf.trim());
  if (base.produto.trim()) p.set("produto", base.produto.trim());
  if (base.incluirCanceladas) p.set("incluirCanceladas", "true");
  if (!base.incluirDevolucoes) p.set("incluirDevolucoes", "false");
  return p;
}

export default function FaturamentoPage({ companyKey, companyName }: FaturamentoPageProps) {
  const initialRange = useMemo<DateRangeValue>(() => {
    const r = getCurrentMonthRange();
    return { startDate: r.start, endDate: r.end };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [empresa, setEmpresa] = useState<EmpresaFiltro>(companyKey === "nerd" ? "nerd" : "scarfme");
  const [filial, setFilial] = useState("");
  const [natureza, setNatureza] = useState("");
  const [cliente, setCliente] = useState("");
  const [nf, setNf] = useState("");
  const [produto, setProduto] = useState("");
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [incluirDevolucoes, setIncluirDevolucoes] = useState(true);

  const [aba, setAba] = useState<Aba>("notas");
  const [dimensoes, setDimensoes] = useState<FaturamentoDimensoes | null>(null);
  const [notas, setNotas] = useState<NotasFiscaisResult | null>(null);
  const [resumo, setResumo] = useState<FaturamentoResumo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detalhe, setDetalhe] = useState<NotaFiscalDetalhe | null>(null);
  const [detalheLoading, setDetalheLoading] = useState(false);

  // Dimensões (filiais fiscais + naturezas) uma vez.
  useEffect(() => {
    let active = true;
    fetch(`/api/faturamento?mode=dimensoes`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { data: FaturamentoDimensoes }) => {
        if (active) setDimensoes(j.data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const buscar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const base = {
      empresa,
      filial,
      natureza,
      cliente,
      nf,
      produto,
      range,
      incluirCanceladas,
      incluirDevolucoes,
    };
    try {
      const params = buildParams(base);
      const [notasRes, resumoRes] = await Promise.all([
        fetch(`/api/faturamento?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/faturamento?mode=resumo&${params.toString()}`, { cache: "no-store" }),
      ]);
      if (!notasRes.ok) throw new Error("Erro ao carregar notas fiscais.");
      if (!resumoRes.ok) throw new Error("Erro ao carregar o resumo.");
      const notasJson = (await notasRes.json()) as { data: NotasFiscaisResult };
      const resumoJson = (await resumoRes.json()) as { data: FaturamentoResumo };
      setNotas(notasJson.data);
      setResumo(resumoJson.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os dados.");
    } finally {
      setLoading(false);
    }
  }, [empresa, filial, natureza, cliente, nf, produto, range, incluirCanceladas, incluirDevolucoes]);

  // Carrega no mount.
  useEffect(() => {
    void buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirDetalhe = useCallback(async (nfSaida: string, serie: string, filialNota: string) => {
    setDetalheLoading(true);
    setDetalhe(null);
    try {
      const p = new URLSearchParams({ nf: nfSaida, serie, filial: filialNota });
      const res = await fetch(`/api/faturamento/detalhe?${p.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { data: NotaFiscalDetalhe };
      setDetalhe(json.data);
    } catch {
      setDetalhe({ header: null, itens: [] });
    } finally {
      setDetalheLoading(false);
    }
  }, []);

  const exportarCsv = useCallback(() => {
    if (!notas || notas.notas.length === 0) return;
    const head = [
      "NF", "Serie", "Filial", "Cliente", "Natureza", "Descricao Natureza",
      "Emissao", "Valor Total", "Qtde", "Desconto", "Tipo", "Cancelada", "Devolucao", "Chave NFe",
    ];
    const linhas = notas.notas.map((n) =>
      [
        n.nfSaida, n.serie, n.filial, n.cliente, n.natureza, n.descNatureza ?? "",
        n.emissao ? n.emissao.slice(0, 10) : "", String(n.valorTotal).replace(".", ","),
        String(n.qtdeTotal), String(n.desconto).replace(".", ","), n.tipoFaturamento ?? "",
        n.cancelada ? "SIM" : "NAO", n.devolucao ? "SIM" : "NAO", n.chaveNfe ?? "",
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [head.join(";"), ...linhas].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nfs_${range.startDate.toISOString().slice(0, 10)}_${range.endDate
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [notas, range]);

  const totais = notas?.totais;

  return (
    <div className={styles.wrapper}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Faturamento / Notas Fiscais</h1>
          <p className={styles.subtitle}>
            NFs de saída do módulo fiscal ({companyName}) — inclui o faturamento da matriz
            (corporativo, private, revenda) que não aparece nas telas de vendas.
          </p>
        </div>
      </header>

      <section className={styles.filters}>
        <div className={styles.filterField}>
          <label className={styles.label}>Período (emissão)</label>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>

        <div className={styles.filterField}>
          <label className={styles.label}>Empresa</label>
          <select
            className={styles.select}
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value as EmpresaFiltro)}
          >
            <option value="">Todas</option>
            <option value="scarfme">ScarfMe (matriz + MSC)</option>
            <option value="nerd">NERD</option>
          </select>
        </div>

        <div className={styles.filterField}>
          <label className={styles.label}>Filial fiscal</label>
          <select className={styles.select} value={filial} onChange={(e) => setFilial(e.target.value)}>
            <option value="">Todas</option>
            {dimensoes?.filiais.map((f) => (
              <option key={f.filial} value={f.filial}>
                {f.filial} ({int(f.nfs)})
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label className={styles.label}>Natureza de operação</label>
          <select className={styles.select} value={natureza} onChange={(e) => setNatureza(e.target.value)}>
            <option value="">Todas</option>
            {dimensoes?.naturezas.map((n) => (
              <option key={n.codigo} value={n.codigo}>
                {n.codigo} — {n.descricao ?? ""}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label className={styles.label}>Cliente</label>
          <input
            className={styles.input}
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Nome do cliente…"
            onKeyDown={(e) => e.key === "Enter" && buscar()}
          />
        </div>

        <div className={styles.filterField}>
          <label className={styles.label}>Nº da NF</label>
          <input
            className={styles.input}
            value={nf}
            onChange={(e) => setNf(e.target.value)}
            placeholder="Ex.: 42917"
            onKeyDown={(e) => e.key === "Enter" && buscar()}
          />
        </div>

        <div className={styles.filterField}>
          <label className={styles.label}>Produto</label>
          <input
            className={styles.input}
            value={produto}
            onChange={(e) => setProduto(e.target.value)}
            placeholder="Código ou descrição…"
            onKeyDown={(e) => e.key === "Enter" && buscar()}
          />
        </div>

        <div className={styles.checks}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={incluirCanceladas}
              onChange={(e) => setIncluirCanceladas(e.target.checked)}
            />
            Incluir canceladas
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={incluirDevolucoes}
              onChange={(e) => setIncluirDevolucoes(e.target.checked)}
            />
            Incluir devoluções
          </label>
        </div>

        <div className={styles.actions}>
          <button className={styles.primaryBtn} onClick={buscar} disabled={loading}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
          <button
            className={styles.ghostBtn}
            onClick={exportarCsv}
            disabled={!notas || notas.notas.length === 0}
          >
            Exportar CSV
          </button>
        </div>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {totais && (
        <section className={styles.kpis}>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Notas fiscais</span>
            <span className={styles.kpiValue}>{int(totais.nfs)}</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Valor faturado</span>
            <span className={styles.kpiValue}>{brl(totais.valorTotal)}</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Quantidade</span>
            <span className={styles.kpiValue}>{int(totais.qtde)}</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Desconto</span>
            <span className={styles.kpiValue}>{brl(totais.desconto)}</span>
          </div>
        </section>
      )}

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${aba === "notas" ? styles.tabActive : ""}`}
          onClick={() => setAba("notas")}
        >
          Notas ({notas ? int(notas.notas.length) : 0})
        </button>
        <button
          className={`${styles.tab} ${aba === "resumo" ? styles.tabActive : ""}`}
          onClick={() => setAba("resumo")}
        >
          Resumo
        </button>
      </div>

      {aba === "notas" && (
        <section className={styles.tableWrap}>
          {notas?.truncado && (
            <div className={styles.notice}>
              Mostrando as primeiras 1.000 NFs (há mais no período). Os totais e o resumo
              consideram todas. Refine os filtros para ver o detalhe completo.
            </div>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>NF</th>
                <th>Sér.</th>
                <th>Filial</th>
                <th>Cliente</th>
                <th>Natureza</th>
                <th>Emissão</th>
                <th className={styles.right}>Valor</th>
                <th className={styles.right}>Qtde</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(notas?.notas ?? []).map((n) => (
                <tr
                  key={`${n.filial}-${n.serie}-${n.nfSaida}`}
                  className={styles.row}
                  onClick={() => abrirDetalhe(n.nfSaida, n.serie, n.filial)}
                >
                  <td className={styles.mono}>{n.nfSaida}</td>
                  <td>{n.serie}</td>
                  <td>{n.filial}</td>
                  <td>{n.cliente}</td>
                  <td title={n.descNatureza ?? ""}>
                    {n.natureza}
                    {n.descNatureza ? ` — ${n.descNatureza}` : ""}
                  </td>
                  <td>{dia(n.emissao)}</td>
                  <td className={styles.right}>{brl(n.valorTotal)}</td>
                  <td className={styles.right}>{int(n.qtdeTotal)}</td>
                  <td>
                    {n.cancelada && <span className={`${styles.badge} ${styles.badgeRed}`}>Cancelada</span>}
                    {n.devolucao && <span className={`${styles.badge} ${styles.badgeAmber}`}>Devolução</span>}
                    {!n.cancelada && !n.devolucao && (
                      <span className={`${styles.badge} ${styles.badgeGreen}`}>OK</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && (notas?.notas.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={9} className={styles.empty}>
                    Nenhuma NF encontrada para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {aba === "resumo" && resumo && (
        <section className={styles.resumoGrid}>
          <ResumoTable
            titulo="Por natureza de operação"
            colunas={["Natureza", "NFs", "Valor"]}
            linhas={resumo.porNatureza.map((r) => [
              `${r.natureza}${r.descNatureza ? ` — ${r.descNatureza}` : ""}`,
              int(r.nfs),
              brl(r.valorTotal),
            ])}
          />
          <ResumoTable
            titulo="Por filial fiscal"
            colunas={["Filial", "NFs", "Valor"]}
            linhas={resumo.porFilial.map((r) => [r.filial, int(r.nfs), brl(r.valorTotal)])}
          />
          <ResumoTable
            titulo="Por mês"
            colunas={["Mês", "NFs", "Valor"]}
            linhas={resumo.porMes.map((r) => [r.mes, int(r.nfs), brl(r.valorTotal)])}
          />
          <ResumoTable
            titulo="Top clientes"
            colunas={["Cliente", "NFs", "Valor"]}
            linhas={resumo.porCliente.map((r) => [r.cliente, int(r.nfs), brl(r.valorTotal)])}
          />
        </section>
      )}

      {(detalhe || detalheLoading) && (
        <div className={styles.modalOverlay} onClick={() => setDetalhe(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setDetalhe(null)} aria-label="Fechar">
              ×
            </button>
            {detalheLoading && <div className={styles.modalLoading}>Carregando NF…</div>}
            {detalhe && detalhe.header && (
              <>
                <h2 className={styles.modalTitle}>
                  NF {detalhe.header.nfSaida} · Série {detalhe.header.serie}
                </h2>
                <div className={styles.modalMeta}>
                  <div>
                    <span>Filial</span>
                    <strong>{detalhe.header.filial}</strong>
                  </div>
                  <div>
                    <span>Cliente</span>
                    <strong>{detalhe.header.cliente}</strong>
                  </div>
                  <div>
                    <span>Natureza</span>
                    <strong>
                      {detalhe.header.natureza}
                      {detalhe.header.descNatureza ? ` — ${detalhe.header.descNatureza}` : ""}
                    </strong>
                  </div>
                  <div>
                    <span>Emissão</span>
                    <strong>{dia(detalhe.header.emissao)}</strong>
                  </div>
                  <div>
                    <span>Valor total</span>
                    <strong>{brl(detalhe.header.valorTotal)}</strong>
                  </div>
                  <div>
                    <span>Qtde</span>
                    <strong>{int(detalhe.header.qtdeTotal)}</strong>
                  </div>
                  <div>
                    <span>ICMS / IPI</span>
                    <strong>
                      {brl(detalhe.header.icms)} / {brl(detalhe.header.ipi)}
                    </strong>
                  </div>
                  <div>
                    <span>Representante</span>
                    <strong>{detalhe.header.representante ?? "—"}</strong>
                  </div>
                  <div className={styles.modalChave}>
                    <span>Chave NFe</span>
                    <strong className={styles.mono}>{detalhe.header.chaveNfe ?? "—"}</strong>
                  </div>
                </div>

                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Descrição</th>
                      <th>Cor</th>
                      <th>Coleção</th>
                      <th className={styles.right}>Qtde</th>
                      <th className={styles.right}>Preço</th>
                      <th className={styles.right}>Desc.</th>
                      <th className={styles.right}>Valor líq.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.itens.map((i, idx) => (
                      <tr key={`${i.produto}-${i.corProduto}-${idx}`}>
                        <td className={styles.mono}>{i.produto}</td>
                        <td>{i.descProduto ?? "—"}</td>
                        <td>{i.descCorProduto || i.corProduto || "—"}</td>
                        <td>{i.descColecao || i.colecao || "—"}</td>
                        <td className={styles.right}>{int(i.qtde)}</td>
                        <td className={styles.right}>{brl(i.preco)}</td>
                        <td className={styles.right}>{brl(i.descontoItem)}</td>
                        <td className={styles.right}>{brl(i.valorLiquido)}</td>
                      </tr>
                    ))}
                    {detalhe.itens.length === 0 && (
                      <tr>
                        <td colSpan={8} className={styles.empty}>
                          Sem itens detalhados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
            {detalhe && !detalhe.header && !detalheLoading && (
              <div className={styles.modalLoading}>NF não encontrada.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResumoTable({
  titulo,
  colunas,
  linhas,
}: {
  titulo: string;
  colunas: string[];
  linhas: (string | number)[][];
}) {
  return (
    <div className={styles.resumoCard}>
      <h3 className={styles.resumoTitle}>{titulo}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            {colunas.map((c, i) => (
              <th key={c} className={i > 0 ? styles.right : ""}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, idx) => (
            <tr key={idx}>
              {linha.map((c, i) => (
                <td key={i} className={i > 0 ? styles.right : ""}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr>
              <td colSpan={colunas.length} className={styles.empty}>
                Sem dados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
