"use client";

import { useState } from "react";
import styles from "./ExportarRelatoriosPage.module.css";

type RelatorioExportavel =
  | "produtos"
  | "estoque"
  | "vendas"
  | "ecommerce"
  | "entradas"
  | "saidas";

interface ArquivoInfo {
  arquivo: string;
  tamanho: number;
}

interface ArquivoGerado {
  relatorio: RelatorioExportavel;
  base: string;
  registros: number | null;
  xlsx?: ArquivoInfo;
  csv?: ArquivoInfo;
}

interface RelatorioStatus {
  tipo: RelatorioExportavel;
  nome: string;
  status: "pendente" | "processando" | "pronto" | "erro";
  registros?: number | null;
  base?: string;
  xlsx?: ArquivoInfo;
  csv?: ArquivoInfo;
  erro?: string;
}

const RELATORIOS_EXPORTAVEIS: RelatorioExportavel[] = [
  "produtos",
  "estoque",
  "vendas",
  "ecommerce",
  "entradas",
  "saidas",
];

const RELATORIO_INFO: Record<RelatorioExportavel, { nome: string; ordem: number }> = {
  produtos: { nome: "Produtos Tratados", ordem: 1 },
  estoque: { nome: "Estoque Tratado", ordem: 2 },
  vendas: { nome: "Vendas Tratadas", ordem: 3 },
  ecommerce: { nome: "E-commerce", ordem: 4 },
  entradas: { nome: "Entradas", ordem: 5 },
  saidas: { nome: "Saidas", ordem: 6 },
};

function criarRelatoriosIniciais(): RelatorioStatus[] {
  return Object.entries(RELATORIO_INFO)
    .sort(([, a], [, b]) => a.ordem - b.ordem)
    .map(([tipo, info]) => ({
      tipo: tipo as RelatorioExportavel,
      nome: info.nome,
      status: "pendente" as const,
    }));
}

function formatarTempo(segundos: number): string {
  if (segundos < 60) {
    return `${segundos.toFixed(1)}s`;
  }
  const minutos = Math.floor(segundos / 60);
  const segs = Math.floor(segundos % 60);
  return `${minutos}m ${segs}s`;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExportarRelatoriosPage() {
  const [relatorios, setRelatorios] = useState<RelatorioStatus[]>(criarRelatoriosIniciais);
  const [selecionados, setSelecionados] = useState<RelatorioExportavel[]>(RELATORIOS_EXPORTAVEIS);
  const [processando, setProcessando] = useState(false);
  const [tempoTotal, setTempoTotal] = useState<number | null>(null);
  const [rotuloProcessamento, setRotuloProcessamento] = useState("");

  const alternarSelecionado = (tipo: RelatorioExportavel) => {
    if (processando) return;
    setSelecionados(prev =>
      prev.includes(tipo) ? prev.filter(item => item !== tipo) : [...prev, tipo]
    );
  };

  const executarRelatorios = async (relatoriosProcessar: RelatorioExportavel[]) => {
    if (processando || relatoriosProcessar.length === 0) return;

    setProcessando(true);
    setTempoTotal(null);
    setRotuloProcessamento(
      relatoriosProcessar.length === RELATORIOS_EXPORTAVEIS.length
        ? "Gerando todos os relatorios no servidor..."
        : `Gerando ${relatoriosProcessar.map(r => RELATORIO_INFO[r].nome).join(", ")}...`
    );

    setRelatorios(prev =>
      prev.map(relatorio =>
        relatoriosProcessar.includes(relatorio.tipo)
          ? {
              ...relatorio,
              status: "processando",
              registros: undefined,
              base: undefined,
              xlsx: undefined,
              csv: undefined,
              erro: undefined,
            }
          : relatorio
      )
    );

    try {
      const response = await fetch("/api/relatorios/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relatorios: relatoriosProcessar }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.details || result.error || "Erro ao gerar relatorios");
      }

      const arquivosPorTipo = new Map<RelatorioExportavel, ArquivoGerado>();
      (result.arquivos as ArquivoGerado[]).forEach(arq => {
        arquivosPorTipo.set(arq.relatorio, arq);
      });

      setRelatorios(prev =>
        prev.map(relatorio => {
          if (!relatoriosProcessar.includes(relatorio.tipo)) return relatorio;
          const arq = arquivosPorTipo.get(relatorio.tipo);
          if (!arq) {
            return { ...relatorio, status: "erro", erro: "Arquivo nao gerado" };
          }
          return {
            ...relatorio,
            status: "pronto",
            registros: arq.registros,
            base: arq.base,
            xlsx: arq.xlsx,
            csv: arq.csv,
            erro: undefined,
          };
        })
      );

      setTempoTotal(result.tempoTotal ?? null);
      setRotuloProcessamento("Exportacao concluida");
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Erro ao gerar relatorios";
      setRelatorios(prev =>
        prev.map(relatorio =>
          relatoriosProcessar.includes(relatorio.tipo) && relatorio.status === "processando"
            ? { ...relatorio, status: "erro", erro: mensagem }
            : relatorio
        )
      );
      setRotuloProcessamento("Falha na exportacao");
      window.alert(mensagem);
    } finally {
      setProcessando(false);
    }
  };

  const executarSelecionados = () => {
    if (selecionados.length === 0) {
      window.alert("Selecione pelo menos um relatorio");
      return;
    }
    void executarRelatorios(selecionados);
  };

  const baixar = (relatorio: RelatorioStatus, fmt: "xlsx" | "csv") => {
    if (!relatorio.base) return;
    const url = `/api/relatorios/download?arquivo=${encodeURIComponent(
      relatorio.base
    )}&fmt=${fmt}`;
    window.location.href = url;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Exportar Relatorios</h1>
        <p className={styles.subtitle}>
          Gera todos os relatorios ou apenas os selecionados, direto do banco.
          <br />
          <span className={styles.subtitleHint}>
            Usa a mesma logica do exportar_todos_relatorios.py (processado no servidor) e
            disponibiliza os arquivos XLSX e CSV para download.
          </span>
        </p>
      </div>

      <div className={styles.selectionBar}>
        <div className={styles.selectionActions}>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => setSelecionados(RELATORIOS_EXPORTAVEIS)}
            disabled={processando}
          >
            Selecionar todos
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => setSelecionados([])}
            disabled={processando}
          >
            Limpar selecao
          </button>
        </div>
        <div className={styles.selectionGrid}>
          {RELATORIOS_EXPORTAVEIS.map(tipo => (
            <label key={tipo} className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={selecionados.includes(tipo)}
                onChange={() => alternarSelecionado(tipo)}
                disabled={processando}
              />
              {RELATORIO_INFO[tipo].nome}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.buttonPrimary}
          onClick={executarSelecionados}
          disabled={processando || selecionados.length === 0}
        >
          {processando ? "Processando..." : "Iniciar selecionados"}
        </button>
        <button
          className={styles.buttonSecondary}
          onClick={() => void executarRelatorios(RELATORIOS_EXPORTAVEIS)}
          disabled={processando}
        >
          Exportar todos
        </button>
      </div>

      {(processando || tempoTotal !== null) && (
        <div className={styles.progressContainer}>
          <div className={styles.progressHeader}>
            <div className={styles.progressInfo}>
              <span className={styles.progressLabel}>
                {rotuloProcessamento || (processando ? "Gerando relatorios..." : "Exportacao concluida")}
              </span>
            </div>
            {tempoTotal !== null && (
              <div className={styles.timeInfo}>
                <span className={styles.tempoTotal}>
                  Tempo total: {formatarTempo(tempoTotal)}
                </span>
              </div>
            )}
          </div>
          {processando && (
            <div className={styles.progressBar}>
              <div className={styles.progressBarFill} style={{ width: "100%" }} />
            </div>
          )}
        </div>
      )}

      <div className={styles.relatoriosList}>
        {relatorios.map(relatorio => (
          <div key={relatorio.tipo} className={styles.relatorioCard}>
            <div className={styles.relatorioHeader}>
              <div className={styles.relatorioInfo}>
                <label className={styles.relatorioTitleLine}>
                  <input
                    type="checkbox"
                    checked={selecionados.includes(relatorio.tipo)}
                    onChange={() => alternarSelecionado(relatorio.tipo)}
                    disabled={processando}
                  />
                  <h3 className={styles.relatorioNome}>{relatorio.nome}</h3>
                </label>
                <div className={styles.relatorioMetadata}>
                  {relatorio.registros != null && (
                    <span className={styles.relatorioRegistros}>
                      {relatorio.registros.toLocaleString("pt-BR")} registros
                    </span>
                  )}
                  {relatorio.xlsx && (
                    <span className={styles.relatorioTempo}>
                      XLSX {formatarTamanho(relatorio.xlsx.tamanho)}
                    </span>
                  )}
                  {relatorio.csv && (
                    <span className={styles.relatorioTempo}>
                      CSV {formatarTamanho(relatorio.csv.tamanho)}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.relatorioStatus}>
                <StatusBadge status={relatorio.status} />
              </div>
            </div>

            {relatorio.erro && (
              <div className={styles.erro}>
                <strong>Erro:</strong> {relatorio.erro}
              </div>
            )}

            <div className={styles.cardActions}>
              <button
                type="button"
                className={styles.buttonSmall}
                onClick={() => void executarRelatorios([relatorio.tipo])}
                disabled={processando}
              >
                Gerar este relatorio
              </button>

              {relatorio.status === "pronto" && (
                <div className={styles.exportButtons}>
                  <button
                    className={styles.buttonExport}
                    onClick={() => baixar(relatorio, "xlsx")}
                    disabled={!relatorio.xlsx}
                  >
                    Baixar XLSX
                  </button>
                  <button
                    className={styles.buttonExport}
                    onClick={() => baixar(relatorio, "csv")}
                    disabled={!relatorio.csv}
                  >
                    Baixar CSV
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RelatorioStatus["status"] }) {
  const statusConfig = {
    pendente: { label: "Pendente", className: styles.badgePendente },
    processando: { label: "Processando...", className: styles.badgeProcessando },
    pronto: { label: "Pronto", className: styles.badgePronto },
    erro: { label: "Erro", className: styles.badgeErro },
  };

  const config = statusConfig[status];

  return (
    <span className={`${styles.badge} ${config.className}`}>
      {config.label}
    </span>
  );
}
