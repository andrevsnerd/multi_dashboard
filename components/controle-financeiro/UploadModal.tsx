"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AbaLida, RegistroFin } from "@/lib/financeiro/planilha";

import { Diferencas, TabelaResumo } from "./Importacoes";
import { type ResumoImportacao, inteiro, useFinanceiroApi } from "./shared";
import styles from "./ControleFinanceiro.module.css";

/*
 * Atualização da base: o arquivo é lido NO NAVEGADOR (15 MB não passam no limite de
 * request do Vercel), vai em lotes para o staging, o servidor compara com a base e
 * mostra o que muda. Só "Aplicar" grava — até lá a base continua como estava.
 */

type Etapa = "escolher" | "lendo" | "enviando" | "analisando" | "revisar" | "aplicando" | "concluido";

const LOTE = 2500;
const PARALELO = 3;

interface Props {
  companyKey: string;
  onFechar: () => void;
  onAplicado: () => void;
}

export default function UploadModal({ companyKey, onFechar, onAplicado }: Props) {
  const api = useFinanceiroApi(companyKey);
  const [etapa, setEtapa] = useState<Etapa>("escolher");
  const [arrastando, setArrastando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [abas, setAbas] = useState<AbaLida[] | null>(null);
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 });
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const idRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ocupado = etapa === "lendo" || etapa === "enviando" || etapa === "analisando" || etapa === "aplicando";

  const descartar = useCallback(async () => {
    const id = idRef.current;
    idRef.current = null;
    if (id != null) await api.send(`/importacoes/${id}`, "DELETE").catch(() => undefined);
  }, [api]);

  const fechar = useCallback(() => {
    if (ocupado) return;
    if (etapa !== "concluido") void descartar();
    onFechar();
  }, [ocupado, etapa, descartar, onFechar]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [fechar]);

  // Fechar a aba no meio do envio: avisa o navegador.
  useEffect(() => {
    if (!ocupado) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [ocupado]);

  const processar = async (file: File) => {
    setErro(null);
    setArquivo(file);
    setResumo(null);
    if (!/\.xls[xm]?$/i.test(file.name)) {
      setErro("Envie a planilha em Excel (.xlsx).");
      return;
    }
    try {
      // 1) ler no navegador
      setEtapa("lendo");
      await new Promise((r) => setTimeout(r, 30)); // deixa a tela pintar antes do parse pesado
      const buf = await file.arrayBuffer();
      const { lerPlanilhaFinanceira } = await import("@/lib/financeiro/ler-planilha");
      const lida = lerPlanilhaFinanceira(buf);
      setAbas(lida.abas);
      const reconhecidas = lida.abas.filter((a) => a.tipo === "lancamento" || a.tipo === "dre");
      if (!reconhecidas.length) {
        throw new Error(
          "Este arquivo não parece o Controle Financeiro: nenhuma aba de lançamentos (Data Competência / Valor / Status) nem DRE foi encontrada."
        );
      }

      // 2) abrir a importação e mandar os registros em lotes
      setEtapa("enviando");
      const todos: RegistroFin[] = lida.abas.flatMap((a) => a.registros);
      const meta = lida.abas.map(({ registros, ...m }) => ({ ...m, totalRegistros: registros.length }));
      const { id } = await api.send<{ id: number }>("/importacoes", "POST", {
        arquivo: file.name,
        tamanho: file.size,
        abas: meta,
        totalEsperado: todos.length,
      });
      idRef.current = id;
      const lotes: RegistroFin[][] = [];
      for (let i = 0; i < todos.length; i += LOTE) lotes.push(todos.slice(i, i + LOTE));
      setProgresso({ feito: 0, total: lotes.length });
      let feitos = 0;
      let proximo = 0;
      const trabalhador = async () => {
        while (proximo < lotes.length) {
          const lote = lotes[proximo++];
          let tentativa = 0;
          for (;;) {
            try {
              await api.send(`/importacoes/${id}`, "POST", { acao: "lote", registros: lote });
              break;
            } catch (e) {
              if (++tentativa >= 3) throw e;
              await new Promise((r) => setTimeout(r, 1500 * tentativa));
            }
          }
          feitos++;
          setProgresso({ feito: feitos, total: lotes.length });
        }
      };
      await Promise.all(Array.from({ length: PARALELO }, trabalhador));

      // 3) comparar com a base
      setEtapa("analisando");
      const r = await api.send<{ resumo: ResumoImportacao }>(`/importacoes/${id}`, "POST", { acao: "analisar" });
      setResumo(r.resumo);
      setEtapa("revisar");
    } catch (e) {
      await descartar();
      setErro(e instanceof Error ? e.message : "Falha ao processar a planilha.");
      setEtapa("escolher");
    }
  };

  const aplicar = async () => {
    const id = idRef.current;
    if (id == null) return;
    setErro(null);
    setEtapa("aplicando");
    try {
      const r = await api.send<{ resumo: ResumoImportacao }>(`/importacoes/${id}`, "POST", { acao: "aplicar" });
      setResumo(r.resumo);
      idRef.current = null;
      setEtapa("concluido");
      onAplicado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao aplicar.");
      setEtapa("revisar");
    }
  };

  const semMudanca = resumo && !resumo.totais.novos && !resumo.totais.alterados && !resumo.totais.removidos;
  const pct = progresso.total ? Math.round((progresso.feito / progresso.total) * 100) : 0;

  const PASSOS: { k: Etapa[]; label: string }[] = [
    { k: ["lendo"], label: "Ler a planilha no navegador" },
    { k: ["enviando"], label: "Enviar os registros" },
    { k: ["analisando"], label: "Comparar com a base atual" },
    { k: ["revisar", "aplicando", "concluido"], label: "Revisar e aplicar" },
  ];
  const ordem: Etapa[] = ["lendo", "enviando", "analisando", "revisar", "aplicando", "concluido"];

  return (
    <>
      <div className={styles.overlay} onClick={fechar} role="presentation" />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cf-upload-titulo">
        <div className={styles.modalHead}>
          <div>
            <h2 id="cf-upload-titulo">Atualizar planilha do Controle Financeiro</h2>
            <p>
              Arraste a versão nova da planilha (mesma estrutura). O sistema reconhece valores alterados, itens novos
              e itens que saíram — nada é gravado antes da sua confirmação.
            </p>
          </div>
          <button type="button" className={styles.fechar} onClick={fechar} disabled={ocupado} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}

          {etapa === "escolher" && (
            <div
              className={`${styles.dropzone} ${arrastando ? styles.dropzoneAtiva : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastando(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void processar(f);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            >
              <strong>Arraste o arquivo .xlsx aqui</strong>
              <span>ou clique para escolher</span>
              <small>Ex.: “Controle Financeiro - Scarf Me 2024-7.xlsx” · todas as abas são lidas</small>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void processar(f);
                }}
              />
            </div>
          )}

          {etapa !== "escolher" && (
            <>
              <div className={styles.passos}>
                {arquivo && (
                  <div>
                    <b>{arquivo.name}</b> · {(arquivo.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB
                    {abas && ` · ${abas.length} abas · ${inteiro(abas.reduce((t, a) => t + a.registros.length, 0))} registros`}
                  </div>
                )}
                {PASSOS.map((p) => {
                  const iAtual = ordem.indexOf(etapa);
                  const iPasso = ordem.indexOf(p.k[0]);
                  const feito = iAtual > iPasso && !p.k.includes(etapa);
                  const atual = p.k.includes(etapa);
                  return (
                    <div key={p.label} className={feito ? styles.passoFeito : atual ? styles.passoAtual : undefined}>
                      {feito ? "✓" : atual ? "›" : "·"} {p.label}
                      {atual && etapa === "lendo" && " — pode levar uns 15 segundos"}
                      {atual && etapa === "enviando" && ` — ${progresso.feito}/${progresso.total} lotes`}
                    </div>
                  );
                })}
              </div>
              {etapa === "enviando" && (
                <div className={styles.progresso}>
                  <i style={{ width: `${pct}%` }} />
                </div>
              )}
            </>
          )}

          {resumo && (etapa === "revisar" || etapa === "aplicando" || etapa === "concluido") && (
            <>
              <div className={styles.kpis}>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Novos</span>
                  <span className={`${styles.kpiValue} ${styles.good}`}>{inteiro(resumo.totais.novos)}</span>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Alterados</span>
                  <span className={`${styles.kpiValue} ${styles.warn}`}>{inteiro(resumo.totais.alterados)}</span>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Removidos</span>
                  <span className={`${styles.kpiValue} ${styles.crit}`}>{inteiro(resumo.totais.removidos)}</span>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Sem mudança</span>
                  <span className={styles.kpiValue}>{inteiro(resumo.totais.iguais)}</span>
                </div>
              </div>
              {resumo.cargaInicial && (
                <div className={`${styles.aviso} ${styles.avisoInfo}`}>Primeira carga: todos os registros entram como novos.</div>
              )}
              {semMudanca && (
                <div className={`${styles.aviso} ${styles.avisoInfo}`}>
                  O arquivo é idêntico à base atual — não há nada para atualizar.
                </div>
              )}
              {resumo.abas.some((a) => a.removidos > 0) && !resumo.cargaInicial && (
                <div className={styles.aviso}>
                  <b>Removidos</b> são linhas que estão na base e não vieram neste arquivo (apagadas ou com descrição,
                  data de competência ou classificação reescritas). A planilha manda: ao aplicar, elas saem da base e
                  ficam registradas no histórico de importações.
                </div>
              )}
              {resumo.ausentes.length > 0 && (
                <div className={styles.aviso}>
                  Abas na base que não vieram no arquivo (serão mantidas como estão): <b>{resumo.ausentes.join(", ")}</b>
                </div>
              )}
              <TabelaResumo resumo={resumo} />
              {resumo.exemplos.length > 0 && (
                <div>
                  <div className={styles.kpiLabel} style={{ marginBottom: 6 }}>
                    Exemplos de valores alterados
                  </div>
                  <div className={styles.passos}>
                    {resumo.exemplos.slice(0, 12).map((e, i) => (
                      <div key={i}>
                        <b>{e.aba}</b> · linha {e.linha} <Diferencas campos={e.campos} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {etapa === "concluido" && (
                <div className={`${styles.aviso} ${styles.avisoInfo}`}>
                  <b>Base atualizada.</b> O detalhe de cada mudança fica na aba Importações.
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.modalFoot}>
          {etapa === "revisar" && (
            <>
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  void descartar();
                  setEtapa("escolher");
                  setResumo(null);
                  setAbas(null);
                }}
              >
                Escolher outro arquivo
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => void aplicar()}
                disabled={!!semMudanca}
              >
                Aplicar atualização
              </button>
            </>
          )}
          {(etapa === "escolher" || etapa === "concluido") && (
            <button type="button" className={`${styles.btn} ${etapa === "concluido" ? styles.btnPrimary : ""}`} onClick={fechar}>
              {etapa === "concluido" ? "Fechar" : "Cancelar"}
            </button>
          )}
          {ocupado && (
            <button type="button" className={styles.btn} disabled>
              {etapa === "aplicando" ? "Gravando…" : "Processando…"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
