"use client";

import type { ColecaoDetalheResponse } from "@/app/api/painel-colecoes/detalhe/route";

import styles from "./ColecaoDetalhePanel.module.css";

interface ColecaoDetalhePanelProps {
  state: "loading" | "error" | ColecaoDetalheResponse;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCurrencyRounded(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

function formatInt(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function formatPct(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export default function ColecaoDetalhePanel({ state }: ColecaoDetalhePanelProps) {
  if (state === "loading") {
    return (
      <div className={styles.panel}>
        <div className={styles.loading}>Carregando performance…</div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={styles.panel}>
        <div className={styles.error}>Não foi possível carregar a performance desta coleção.</div>
      </div>
    );
  }

  const { destaques, porLoja, totalRevenue, totalQuantity, kpis } = state;
  const maxRevenue = destaques.reduce((m, d) => Math.max(m, d.revenue), 0);

  return (
    <div className={styles.panel}>
      <div className={styles.grid}>
        {/* ── Os números da coleção (KPIs) — primeiro e compacto ────────────── */}
        <section className={`${styles.block} ${styles.blockNumeros}`}>
          <header className={styles.blockHeader}>
            <h3 className={styles.blockTitle}>Os números da coleção</h3>
          </header>

          <div className={styles.kpiRow}>
            <div className={`${styles.kpiTile} ${styles.kpiTileHero}`}>
              <span className={styles.kpiLabel}>Faturamento</span>
              <span className={styles.kpiValue}>{formatCurrencyRounded(kpis.faturamento)}</span>
              <span className={styles.kpiHint}>venda líquida</span>
            </div>
            <div className={styles.kpiTile}>
              <span className={styles.kpiLabel}>Peças vendidas</span>
              <span className={styles.kpiValue}>{formatInt(kpis.pecasVendidas)}</span>
              <span className={styles.kpiHint}>em {formatInt(kpis.skusVendidos)} SKUs</span>
            </div>
            <div className={styles.kpiTile}>
              <span className={styles.kpiLabel}>Preço médio</span>
              <span className={styles.kpiValue}>{formatCurrencyRounded(kpis.precoMedio)}</span>
              <span className={styles.kpiHint}>ticket por peça</span>
            </div>
            <div className={styles.kpiTile}>
              <span className={styles.kpiLabel}>Estoque restante</span>
              <span className={styles.kpiValue}>{formatInt(kpis.estoqueRestante)}</span>
              <span className={styles.kpiHint}>peças na rede</span>
            </div>
            <div className={styles.kpiTile}>
              <span className={styles.kpiLabel}>Canais ativos</span>
              <span className={styles.kpiValue}>{formatInt(kpis.canaisAtivos)}</span>
              <span className={styles.kpiHint}>e-com + lojas</span>
            </div>
          </div>
        </section>

        {/* ── Destaques da coleção (top 5) ──────────────────────────────────── */}
        <section className={`${styles.block} ${styles.blockDestaques}`}>
          <header className={styles.blockHeader}>
            <h3 className={styles.blockTitle}>Destaques da coleção</h3>
            <p className={styles.blockSubtitle}>Top {destaques.length} produtos que puxaram o resultado</p>
          </header>

          {destaques.length === 0 ? (
            <div className={styles.emptyBlock}>Sem vendas no período.</div>
          ) : (
            <ol className={styles.destaquesList}>
              {destaques.map((d, i) => {
                const barPct = maxRevenue > 0 ? Math.max(6, (d.revenue / maxRevenue) * 100) : 0;
                const meta = [
                  d.colorDescription && d.colorDescription !== "-" ? d.colorDescription : null,
                  d.grade && d.grade !== "-" ? d.grade : null,
                  `${formatInt(d.quantity)} un`,
                  `ticket ${formatCurrencyRounded(d.ticket)}`,
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <li key={`${d.productName}-${d.colorDescription}-${i}`} className={styles.destaqueRow}>
                    <span className={styles.destaqueRank}>{i + 1}</span>
                    <div className={styles.destaqueBody}>
                      <span className={styles.destaqueName}>{d.productName}</span>
                      <span className={styles.destaqueMeta}>{meta}</span>
                      <div className={styles.destaqueBarTrack}>
                        <div className={styles.destaqueBarFill} style={{ width: `${barPct}%` }} />
                      </div>
                    </div>
                    <div className={styles.destaqueValues}>
                      <span className={styles.destaqueRevenue}>{formatCurrencyRounded(d.revenue)}</span>
                      <span className={styles.destaquePct}>{formatPct(d.pctOfTotal)} do total</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* ── Vendas por loja (ranking de canais) ───────────────────────────── */}
        <section className={`${styles.block} ${styles.blockLojas}`}>
          <header className={styles.blockHeader}>
            <h3 className={styles.blockTitle}>Vendas por loja</h3>
            <p className={styles.blockSubtitle}>Ranking de canais</p>
          </header>

          {porLoja.length === 0 ? (
            <div className={styles.emptyBlock}>Sem vendas no período.</div>
          ) : (
            <table className={styles.lojasTable}>
              <thead>
                <tr>
                  <th className={styles.thLeft}>Canal</th>
                  <th className={styles.thRight}>Venda líq.</th>
                  <th className={styles.thRight}>Qtd</th>
                  <th className={styles.thRight}>%</th>
                </tr>
              </thead>
              <tbody>
                {porLoja.map((c) => (
                  <tr key={c.origin}>
                    <td className={styles.tdCanal}>{c.origin}</td>
                    <td className={styles.tdRight}>{formatCurrency(c.revenue)}</td>
                    <td className={styles.tdRight}>{formatInt(c.quantity)}</td>
                    <td className={styles.tdPct}>{formatPct(c.pct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={styles.tdTotal}>Total</td>
                  <td className={styles.tdTotalRight}>{formatCurrency(totalRevenue)}</td>
                  <td className={styles.tdTotalRight}>{formatInt(totalQuantity)}</td>
                  <td className={styles.tdTotalRight}>100%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
