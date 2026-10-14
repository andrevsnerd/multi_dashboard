"use client";

import { useEffect, useMemo, useState } from "react";

import { BLOCO_PRINCIPAL, type DreIndex, indexarDre, mesesDoAno } from "./dre-util";
import { BarrasHorizontais, GraficoBarrasMensal } from "./Graficos";
import {
  type DreResposta,
  type MetaFinanceiro,
  brl,
  compacto,
  mesCurto,
  mesReferencia,
  percentual,
  useFinanceiroApi,
} from "./shared";
import styles from "./ControleFinanceiro.module.css";

const CANAIS = [
  { rotulo: "Vendas Varejo", label: "Varejo", cor: "var(--cf-s1)" },
  { rotulo: "Vendas Corporativo", label: "Corporativo", cor: "var(--cf-s2)" },
  { rotulo: "Vendas Web", label: "Web", cor: "var(--cf-s3)" },
  { rotulo: "Vendas Multimarcas", label: "Multimarcas", cor: "var(--cf-s4)" },
];

const COMPOSICAO = [
  "CMV",
  "Total Pessoal",
  "Total Shoppings",
  "Total Impostos",
  "Total Canais",
  "Total Outros",
  "Total Produto",
  "Total Despesas Financeiras",
  "Total Investimentos",
  "Amortização",
  "Distribuição - Sócios",
];

interface Props {
  companyKey: string;
  meta: MetaFinanceiro;
  onAbrirDre: (ano: number) => void;
}

export default function VisaoGeral({ companyKey, meta, onAbrirDre }: Props) {
  const api = useFinanceiroApi(companyKey);
  const ref = mesReferencia(meta);
  const anoRef = ref ? Number(ref.slice(0, 4)) : new Date().getFullYear();
  const [ano, setAno] = useState(anoRef);
  // A resposta guarda o ano pedido: "carregando" = a tela mostra outro ano.
  const [resp, setResp] = useState<{ ano: number; dre: DreResposta } | null>(null);
  const dre = resp?.dre ?? null;
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    api
      .get<DreResposta>("/dre", { de: `${ano - 1}-01-01`, ate: `${ano}-12-01` })
      .then((d) => vivo && (setResp({ ano, dre: d }), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro ao carregar"))
    return () => {
      vivo = false;
    };
  }, [api, ano]);

  const anos = useMemo(() => {
    if (!dre?.mesMin || !dre.mesMax) return [ano];
    const out: number[] = [];
    for (let a = Number(dre.mesMax.slice(0, 4)); a >= Number(dre.mesMin.slice(0, 4)); a--) out.push(a);
    return out;
  }, [dre, ano]);

  const idx = useMemo(() => (dre ? indexarDre(dre) : null), [dre]);
  const carregando = !!resp && resp.ano !== ano;

  if (erro) return <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>;
  if (!idx) return <div className={styles.aviso}>Carregando a DRE…</div>;

  return (
    <div className={`${styles.corpo} ${carregando ? styles.carregando : ""}`}>
      <div className={styles.filtros}>
        <div className={styles.segmented} role="tablist" aria-label="Ano">
          {anos.slice(0, 8).map((a) => (
            <button key={a} type="button" className={a === ano ? styles.segAtivo : undefined} onClick={() => setAno(a)}>
              {a}
            </button>
          ))}
        </div>
        {anos.length > 8 && (
          <select className={styles.select} value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
      </div>
      <Conteudo idx={idx} ano={ano} mesRef={ref} onAbrirDre={() => onAbrirDre(ano)} />
    </div>
  );
}

function Conteudo({
  idx,
  ano,
  mesRef,
  onAbrirDre,
}: {
  idx: DreIndex;
  ano: number;
  mesRef: string | null;
  onAbrirDre: () => void;
}) {
  const meses = mesesDoAno(ano);
  // Acumulado só dos meses fechados (antes do mês de atualização da planilha); o resto
  // da DRE é projeção. Ano anterior no MESMO recorte de meses.
  const fechados = meses.filter((m) => !mesRef || m < mesRef);
  const fechadosAA = fechados.map((m) => `${ano - 1}${m.slice(4)}`);
  const ultimoFechado = fechados[fechados.length - 1];
  const recorte = fechados.length === 12 ? `${ano} completo` : fechados.length ? `jan–${mesCurto(ultimoFechado).slice(0, 3)} ${ano}` : "—";

  const B = BLOCO_PRINCIPAL;
  const kpi = (rotulo: string) => ({
    atual: idx.soma(B, rotulo, fechados),
    anterior: idx.soma(B, rotulo, fechadosAA),
  });
  const receita = kpi("Total Receitas");
  const ro = kpi("Resultado Operacional Líq.");
  const rl = kpi("Resultado Líquido");
  const desp = kpi("Despesas");
  const pos = kpi("Resultado Pós Inv. e Amort.");

  const variacao = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);
  const delta = (a: number, b: number, inverter = false) => {
    const v = variacao(a, b);
    if (v == null) return <span className={styles.muted}>sem base no ano anterior</span>;
    const bom = inverter ? v < 0 : v > 0;
    return (
      <span className={bom ? styles.good : styles.crit}>
        {v > 0 ? "▲" : "▼"} {percentual(Math.abs(v))} vs {ano - 1}
      </span>
    );
  };

  const outrosCanais = meses.map((m) => {
    const bazar = idx.serie(B, "Vendas Bazar", [m])[0] ?? 0;
    const franq = idx.serie(B, "Franquias", [m])[0] ?? 0;
    return bazar + franq;
  });
  const seriesCanais = [
    ...CANAIS.map((c) => ({
      key: c.rotulo,
      label: c.label,
      cor: c.cor,
      valores: idx.serie(B, c.rotulo, meses),
    })),
    { key: "outros", label: "Bazar + Franquias", cor: "var(--cf-s5)", valores: outrosCanais },
  ].filter((s) => s.valores.some((v) => v));

  const composicao = COMPOSICAO.map((r) => ({ chave: r, rotulo: r.replace(/^Total /, ""), valor: idx.soma(B, r, fechados) }))
    .filter((c) => c.valor !== 0)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const baseReceita = Math.abs(receita.atual) || 1;

  return (
    <>
      <div className={styles.kpis}>
        <div className={`${styles.kpi} ${styles.kpiAccent}`}>
          <span className={styles.kpiLabel}>Receita total · {recorte}</span>
          <span className={styles.kpiValue}>{compacto(receita.atual)}</span>
          <span className={styles.kpiFoot}>{delta(receita.atual, receita.anterior)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Despesas</span>
          <span className={styles.kpiValue}>{compacto(desp.atual)}</span>
          <span className={styles.kpiFoot}>
            <b>{percentual(Math.abs(desp.atual) / baseReceita)}</b> da receita · {delta(Math.abs(desp.atual), Math.abs(desp.anterior), true)}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Resultado operacional</span>
          <span className={`${styles.kpiValue} ${ro.atual < 0 ? styles.neg : ""}`}>{compacto(ro.atual)}</span>
          <span className={styles.kpiFoot}>
            margem <b>{percentual(ro.atual / baseReceita)}</b> · {delta(ro.atual, ro.anterior)}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Resultado líquido</span>
          <span className={`${styles.kpiValue} ${rl.atual < 0 ? styles.neg : ""}`}>{compacto(rl.atual)}</span>
          <span className={styles.kpiFoot}>
            margem <b>{percentual(rl.atual / baseReceita)}</b> · {delta(rl.atual, rl.anterior)}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Pós investimento e amortização</span>
          <span className={`${styles.kpiValue} ${pos.atual < 0 ? styles.neg : ""}`}>{compacto(pos.atual)}</span>
          <span className={styles.kpiFoot}>{delta(pos.atual, pos.anterior)}</span>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Receita por canal · {ano}</h2>
          <span className={styles.cardNote}>
            DRE consolidada · {brl(idx.soma(B, "Total Receitas", meses))} no ano (inclui meses projetados)
          </span>
        </div>
        <GraficoBarrasMensal meses={meses} series={seriesCanais} projecaoDesde={mesRef} totalLabel="Total receitas" />
      </section>

      <div className={styles.grid2}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Resultado líquido mês a mês</h2>
            <button type="button" className={styles.btnLink} onClick={onAbrirDre}>
              abrir a DRE
            </button>
          </div>
          <GraficoBarrasMensal
            meses={meses}
            series={[
              { key: "rl", label: "Resultado líquido", cor: "var(--cf-pos)", valores: idx.serie(B, "Resultado Líquido", meses) },
            ]}
            empilhado={false}
            divergente
            projecaoDesde={mesRef}
            altura={240}
          />
        </section>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Para onde foi o dinheiro</h2>
            <span className={styles.cardNote}>{recorte} · % da receita</span>
          </div>
          <div className={styles.cardBody}>
            {composicao.length ? (
              <BarrasHorizontais
                itens={composicao.map((c) => ({ ...c, nota: percentual(Math.abs(c.valor) / baseReceita) }))}
              />
            ) : (
              <div className={styles.muted}>Sem meses fechados neste ano.</div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
