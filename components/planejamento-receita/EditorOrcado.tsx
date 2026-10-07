"use client";

import { useMemo, useState } from "react";

import type { CanalPlanejamento } from "@/lib/config/planejamento-receita";
import type { PlanejamentoReceitaResponse } from "@/lib/types/planejamento-receita";
import { parseMoeda } from "@/components/compras/gastos-compra-format";

import { inteiro, MESES_CURTOS } from "./calc";
import styles from "./PlanejamentoReceita.module.css";

interface Props {
  data: PlanejamentoReceitaResponse;
  companyKey: string;
  username: string;
  onFechar: () => void;
  onSalvo: () => void;
}

const LINHAS: { canal: CanalPlanejamento; label: string }[] = [
  { canal: "lojas", label: "Lojas" },
  { canal: "web", label: "Web" },
  { canal: "corporativo", label: "Corporativo" },
];

type Rascunho = Record<CanalPlanejamento, string[]>;

const paraTexto = (v: number) => inteiro(v);
const centavos = (v: number) => Math.round(v * 100) / 100;

function rascunhoDe(data: PlanejamentoReceitaResponse): Rascunho {
  return {
    lojas: data.orcado.lojas.map(paraTexto),
    web: data.orcado.web.map(paraTexto),
    corporativo: data.orcado.corporativo.map(paraTexto),
  };
}

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Edição do orçado de um ano. A planilha é a base; o que sai daqui grava por cima, célula
 * a célula, e "voltar à planilha" apaga a edição. O valor só vai pro banco no Salvar.
 */
export default function EditorOrcado({ data, companyKey, username, onFechar, onSalvo }: Props) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDe(data));
  const [pct, setPct] = useState<Record<CanalPlanejamento, string>>({ lojas: "", web: "", corporativo: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const anoAnterior = data.ano - 1;
  const temAnterior = !!data.orcadoAnoAnterior;

  const valor = (canal: CanalPlanejamento, i: number) => parseMoeda(rascunho[canal][i] ?? "");
  const salvo = (canal: CanalPlanejamento, i: number) => data.orcado[canal][i] ?? 0;
  // A tela trabalha em reais inteiros (como a planilha); o salvo pode ter centavos
  // (Lojas 2027 = 2026 × 1,025), então só conta como mudança o que muda o real.
  const mudou = (canal: CanalPlanejamento, i: number) =>
    Math.round(valor(canal, i)) !== Math.round(salvo(canal, i));

  const edicaoDe = useMemo(() => {
    const mapa = new Map<string, PlanejamentoReceitaResponse["edicoes"][number]>();
    for (const e of data.edicoes) mapa.set(`${e.canal}-${e.mes}`, e);
    return mapa;
  }, [data.edicoes]);

  const alteracoes = LINHAS.flatMap(({ canal }) =>
    rascunho[canal].map((_, i) => i).filter((i) => mudou(canal, i)).map((i) => ({
      canal,
      mes: i + 1,
      valor: centavos(valor(canal, i)),
    }))
  );

  const somaCanal = (canal: CanalPlanejamento) => rascunho[canal].reduce((s, _, i) => s + valor(canal, i), 0);
  const somaMes = (i: number, canais: CanalPlanejamento[]) => canais.reduce((s, c) => s + valor(c, i), 0);

  const definirCelula = (canal: CanalPlanejamento, i: number, texto: string) =>
    setRascunho((r) => ({ ...r, [canal]: r[canal].map((v, k) => (k === i ? texto : v)) }));

  const aplicarPct = (canal: CanalPlanejamento) => {
    if (!data.orcadoAnoAnterior) return;
    const p = Number(String(pct[canal]).replace(",", "."));
    if (!Number.isFinite(p)) return;
    const base = data.orcadoAnoAnterior[canal];
    setRascunho((r) => ({ ...r, [canal]: base.map((v) => paraTexto(v * (1 + p / 100))) }));
  };

  const voltarPlanilha = (canal: CanalPlanejamento) => {
    if (!data.planilha) return;
    const base = data.planilha[canal];
    setRascunho((r) => ({ ...r, [canal]: base.map(paraTexto) }));
  };

  const salvar = async () => {
    if (alteracoes.length === 0) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/planejamento-receita/orcado", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, ano: data.ano, alteracoes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Erro ao salvar");
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  };

  const ultima = data.edicoes
    .filter((e) => e.updatedAt)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];

  return (
    <section className={`${styles.card} ${styles.editor}`}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Editar orçado {data.ano}</h2>
        <span className={styles.cardNote}>
          {data.planilha ? "Base: planilha do financeiro" : "Ano criado na tela"}
          {ultima ? ` · última alteração: ${ultima.updatedBy ?? "?"} em ${dataHora(ultima.updatedAt)}` : ""}
        </span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.editorTable}`}>
          <thead>
            <tr>
              <th>R$</th>
              {MESES_CURTOS.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th className={styles.colTotal}>Ano</th>
            </tr>
          </thead>
          <tbody>
            {LINHAS.map(({ canal, label }) => (
              <tr key={canal}>
                <td className={styles.rowLabel}>
                  <div className={styles.editorRotulo}>
                    <b>{label}</b>
                    <div className={styles.editorFerramentas}>
                      {temAnterior && (
                        <span className={styles.editorPct}>
                          <input
                            className={styles.editorPctInput}
                            inputMode="decimal"
                            placeholder="%"
                            aria-label={`Percentual sobre ${anoAnterior} para ${label}`}
                            value={pct[canal]}
                            onChange={(e) => setPct((p) => ({ ...p, [canal]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && aplicarPct(canal)}
                          />
                          <button
                            type="button"
                            className={styles.linkBtn}
                            onClick={() => aplicarPct(canal)}
                            title={`Preenche os 12 meses com ${anoAnterior} × (1 + %)`}
                          >
                            % sobre {anoAnterior}
                          </button>
                        </span>
                      )}
                      {data.planilha && (
                        <button type="button" className={styles.linkBtn} onClick={() => voltarPlanilha(canal)}>
                          voltar à planilha
                        </button>
                      )}
                    </div>
                  </div>
                </td>
                {rascunho[canal].map((texto, i) => {
                  const edicao = edicaoDe.get(`${canal}-${i + 1}`);
                  const planilhaValor = data.planilha?.[canal][i];
                  const titulo = [
                    planilhaValor != null ? `Planilha: ${inteiro(planilhaValor)}` : null,
                    edicao ? `Alterado por ${edicao.updatedBy ?? "?"} em ${dataHora(edicao.updatedAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <td key={i} className={styles.editorCelula}>
                      <input
                        className={`${styles.editorInput} ${mudou(canal, i) ? styles.editorMudou : ""} ${
                          edicao && data.planilha ? styles.editorEditado : ""
                        }`}
                        inputMode="decimal"
                        value={texto}
                        title={titulo || undefined}
                        aria-label={`${label} ${MESES_CURTOS[i]}`}
                        onChange={(e) => definirCelula(canal, i, e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => definirCelula(canal, i, paraTexto(valor(canal, i)))}
                      />
                    </td>
                  );
                })}
                <td className={styles.colTotal}>{inteiro(somaCanal(canal))}</td>
              </tr>
            ))}
            <tr className={styles.rowForte}>
              <td className={styles.rowLabel}>Lojas + Web</td>
              {MESES_CURTOS.map((m, i) => (
                <td key={m}>{inteiro(somaMes(i, ["lojas", "web"]))}</td>
              ))}
              <td className={styles.colTotal}>{inteiro(somaCanal("lojas") + somaCanal("web"))}</td>
            </tr>
            <tr className={styles.rowFraca}>
              <td className={styles.rowLabel}>Total geral</td>
              {MESES_CURTOS.map((m, i) => (
                <td key={m}>{inteiro(somaMes(i, ["lojas", "web", "corporativo"]))}</td>
              ))}
              <td className={styles.colTotal}>
                {inteiro(somaCanal("lojas") + somaCanal("web") + somaCanal("corporativo"))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.editorRodape}>
        <span className={styles.cardNote}>
          <span className={`${styles.editorLegenda} ${styles.editorMudou}`} /> alterado agora (não salvo)
          {data.planilha && (
            <>
              {"  "}
              <span className={`${styles.editorLegenda} ${styles.editorEditado}`} /> diferente da planilha
            </>
          )}
        </span>
        {erro && <span className={styles.crit}>{erro}</span>}
        <div className={styles.headTools}>
          <button type="button" className={styles.btn} onClick={onFechar} disabled={salvando}>
            Cancelar
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void salvar()}
            disabled={salvando || alteracoes.length === 0}
          >
            {salvando
              ? "Salvando…"
              : alteracoes.length === 0
                ? "Nada alterado"
                : `Salvar ${alteracoes.length} ${alteracoes.length === 1 ? "alteração" : "alterações"}`}
          </button>
        </div>
      </div>
    </section>
  );
}
