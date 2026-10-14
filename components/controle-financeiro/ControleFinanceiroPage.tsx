"use client";

import { useCallback, useEffect, useState } from "react";

import Budget from "./Budget";
import Dre from "./Dre";
import FluxoCaixa from "./FluxoCaixa";
import Importacoes from "./Importacoes";
import Lancamentos from "./Lancamentos";
import Planilha from "./Planilha";
import Recebimentos from "./Recebimentos";
import UploadModal from "./UploadModal";
import VisaoGeral from "./VisaoGeral";
import {
  type FiltroInicialLancamentos,
  type MetaFinanceiro,
  dataBr,
  dataHoraBr,
  inteiro,
  mesReferencia,
  useFinanceiroApi,
} from "./shared";
import styles from "./ControleFinanceiro.module.css";

type Aba =
  | "visao"
  | "dre"
  | "lancamentos"
  | "caixa"
  | "recebimentos"
  | "budget"
  | "planilha"
  | "importacoes";

const ABAS: { key: Aba; label: string }[] = [
  { key: "visao", label: "Visão geral" },
  { key: "dre", label: "DRE" },
  { key: "lancamentos", label: "Lançamentos" },
  { key: "caixa", label: "Fluxo de caixa" },
  { key: "recebimentos", label: "Recebimentos" },
  { key: "budget", label: "Budget" },
  { key: "planilha", label: "Planilha (todas as abas)" },
  { key: "importacoes", label: "Importações" },
];

interface Props {
  companyKey: string;
  companyName: string;
}

export default function ControleFinanceiroPage({ companyKey, companyName }: Props) {
  const api = useFinanceiroApi(companyKey);
  const [meta, setMeta] = useState<MetaFinanceiro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("visao");
  const [upload, setUpload] = useState(false);
  const [versao, setVersao] = useState(0);
  const [anoDre, setAnoDre] = useState<number | null>(null);
  const [drill, setDrill] = useState<FiltroInicialLancamentos | null>(null);

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    api
      .get<MetaFinanceiro>("")
      .then((m) => vivo && (setMeta(m), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro ao carregar"));
    return () => {
      vivo = false;
    };
  }, [api, versao]);

  const limparDrill = useCallback(() => setDrill(null), []);

  const ref = mesReferencia(meta);
  const anoRef = ref ? Number(ref.slice(0, 4)) : new Date().getFullYear();
  const dataRef = (meta?.abas ?? [])
    .filter((a) => a.tipo === "lancamento" && a.dataReferencia)
    .map((a) => a.dataReferencia!)
    .sort()
    .pop();
  const porTipo = (tipo: string) => meta?.abas.find((a) => a.tipo === tipo) ?? null;
  const vazio = meta && meta.totalRegistros === 0;

  return (
    <div className={styles.wrapper}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.titulo}>Controle Financeiro</h1>
          <p className={styles.subtitulo}>
            {companyName}
            {dataRef ? ` · planilha atualizada até ${dataBr(dataRef)}` : ""}
            {meta?.ultimaImportacao
              ? ` · importada em ${dataHoraBr(meta.ultimaImportacao.aplicadoEm)} por ${meta.ultimaImportacao.aplicadoPor}`
              : ""}
            {meta && meta.totalRegistros > 0 ? ` · ${inteiro(meta.totalRegistros)} registros` : ""}
          </p>
        </div>
        <div className={styles.headTools}>
          {meta?.podeImportar && (
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setUpload(true)}>
              Atualizar planilha
            </button>
          )}
        </div>
      </div>

      {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}
      {!meta && !erro && <div className={styles.aviso}>Carregando…</div>}

      {vazio && (
        <section className={styles.card}>
          <div className={styles.vazio}>
            <h2>Nenhuma planilha importada ainda</h2>
            <p>Envie a planilha “Controle Financeiro” para montar a DRE, os lançamentos e o fluxo de caixa.</p>
            {meta?.podeImportar ? (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setUpload(true)}>
                Enviar planilha
              </button>
            ) : (
              <p className={styles.muted}>Peça a um administrador para importar.</p>
            )}
          </div>
        </section>
      )}

      {meta && !vazio && (
        <>
          <div className={styles.tabs} role="tablist">
            {ABAS.map((a) => (
              <button
                key={a.key}
                type="button"
                role="tab"
                aria-selected={aba === a.key}
                className={aba === a.key ? styles.tabAtiva : undefined}
                onClick={() => setAba(a.key)}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* key={versao}: depois de uma importação, toda tela recarrega do zero. */}
          <div key={versao} className={styles.tela}>
            {aba === "visao" && (
              <VisaoGeral
                companyKey={companyKey}
                meta={meta}
                onAbrirDre={(ano) => {
                  setAnoDre(ano);
                  setAba("dre");
                }}
              />
            )}
            {aba === "dre" && (
              <Dre
                companyKey={companyKey}
                anoInicial={anoDre ?? anoRef}
                mesRef={ref}
                onAbrirLancamentos={(classificacao, mes) => {
                  setDrill({ classificacao, mes, token: Date.now() });
                  setAba("lancamentos");
                }}
              />
            )}
            {aba === "lancamentos" && (
              <Lancamentos companyKey={companyKey} anoPadrao={anoRef} inicial={drill} onDrillAplicado={limparDrill} />
            )}
            {aba === "caixa" &&
              (porTipo("caixa_diario") ? (
                <FluxoCaixa companyKey={companyKey} aba={porTipo("caixa_diario")!} />
              ) : (
                <div className={styles.aviso}>A planilha não trouxe a aba de caixa diário.</div>
              ))}
            {aba === "recebimentos" && (
              <Recebimentos
                companyKey={companyKey}
                abaBancos={porTipo("entrada_banco")}
                abaAtacado={porTipo("entrada_atacado")}
                anoPadrao={anoRef}
              />
            )}
            {aba === "budget" &&
              (porTipo("budget") ? (
                <Budget companyKey={companyKey} aba={porTipo("budget")!} />
              ) : (
                <div className={styles.aviso}>A planilha não trouxe a aba de budget.</div>
              ))}
            {aba === "planilha" && <Planilha companyKey={companyKey} abas={meta.abas} />}
            {aba === "importacoes" && <Importacoes companyKey={companyKey} versao={versao} />}
          </div>
        </>
      )}

      {upload && (
        <UploadModal
          companyKey={companyKey}
          onFechar={() => setUpload(false)}
          onAplicado={() => setVersao((v) => v + 1)}
        />
      )}
    </div>
  );
}
