"use client";

import { useState } from "react";
import { exportToExcel, exportToCSV } from "@/lib/utils/exportRelatorios";
import styles from "./ExportarRelatoriosPage.module.css";

type RelatorioType =
  | "produtos"
  | "estoque"
  | "vendas"
  | "ecommerce"
  | "entradas"
  | "saidas"
  | "produtos_barra"
  | "cores"
  | "filiais";

type RelatorioExportavel =
  | "produtos"
  | "estoque"
  | "vendas"
  | "ecommerce"
  | "entradas"
  | "saidas";

type RelatorioRow = Record<string, unknown>;

interface RelatorioStatus {
  tipo: RelatorioExportavel;
  nome: string;
  status: "pendente" | "carregando" | "processando" | "pronto" | "erro";
  registros?: number;
  dados?: RelatorioRow[];
  erro?: string;
  tempoDecorrido?: number;
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

const NOMES_ARQUIVO: Record<RelatorioExportavel, string> = {
  produtos: "produtos_tratados",
  estoque: "estoque_tratados",
  vendas: "vendas_tratadas",
  ecommerce: "ecommerce",
  entradas: "entradas",
  saidas: "saidas",
};

const DEPENDENCIAS: Record<RelatorioExportavel, RelatorioType[]> = {
  produtos: ["produtos_barra"],
  estoque: ["produtos", "produtos_barra"],
  vendas: ["produtos_barra"],
  ecommerce: [],
  entradas: ["produtos", "cores"],
  saidas: ["produtos", "cores"],
};

const FILIAIS_CONSIDERADAS = [
  "SCARF ME - HIGIENOPOLIS 2",
  "SCARFME - IBIRAPUERA LLL",
  "SCARFME ME - PAULISTA FFF",
  "SCARF ME - PAULISTA RSR",
  "SCARF ME - PAULISTA FFFR",
  "SCARFME MATRIZ CMS",
  "SCARF ME - MATRIZ",
  "SCARF ME - MATRIZ LLL",
  "SCARF ME MATRIZ - FFF",
  "SCARF ME MATRIZ - RSR",
  "MSC COMERCIO DE LENCOS LT",
  "CIDADE DE SP - LLL",
  "GUARULHOS - RSR",
  "IGUATEMI SP - JJJ",
  "MORUMBI - JJJ",
  "NERD CAMPINAS",
  "NERD CENTER NORTE",
  "NERD HIGIENOPOLIS",
  "NERD LEBLON",
  "NERD MORUMBI RDRRRJ",
  "NERD MORUMBI RDRRX",
  "NERD TIJUCA RDRRX",
  "NERD VILLA LOBOS",
  "OSCAR FREIRE - FSZ",
  "VILLA LOBOS - LLL",
];

function criarRelatoriosIniciais(): RelatorioStatus[] {
  return Object.entries(RELATORIO_INFO)
    .sort(([, a], [, b]) => a.ordem - b.ordem)
    .map(([tipo, info]) => ({
      tipo: tipo as RelatorioExportavel,
      nome: info.nome,
      status: "pendente" as const,
    }));
}

function normalizarFilial(valor: unknown): string {
  return String(valor ?? "").replace(/\u00a0/g, " ").trim();
}

function determinarQueriesNecessarias(relatorios: RelatorioExportavel[]): Set<RelatorioType> {
  const queries = new Set<RelatorioType>(relatorios);

  relatorios.forEach(relatorio => {
    DEPENDENCIAS[relatorio].forEach(dep => queries.add(dep));
  });

  let mudou = true;
  while (mudou) {
    mudou = false;
    Array.from(queries).forEach(item => {
      if (item in DEPENDENCIAS) {
        DEPENDENCIAS[item as RelatorioExportavel].forEach(dep => {
          if (!queries.has(dep)) {
            queries.add(dep);
            mudou = true;
          }
        });
      }
    });
  }

  if (relatorios.some(r => ["vendas", "estoque", "ecommerce", "entradas", "saidas"].includes(r))) {
    queries.add("filiais");
  }

  return queries;
}

function filtrarPorFiliais(dfs: Partial<Record<RelatorioType, RelatorioRow[]>>) {
  const consideradas = new Set(FILIAIS_CONSIDERADAS.map(normalizarFilial));
  const filiais = dfs.filiais ?? [];
  const codFiliaisConsiderados = new Set<number>();

  filiais.forEach(row => {
    if (consideradas.has(normalizarFilial(row.FILIAL))) {
      const cod = Number(row.COD_FILIAL);
      if (Number.isFinite(cod)) codFiliaisConsiderados.add(Math.trunc(cod));
    }
  });

  (["vendas", "ecommerce", "entradas", "saidas"] as RelatorioExportavel[]).forEach(tipo => {
    const dados = dfs[tipo];
    if (!dados || dados.length === 0) return;

    if (tipo === "vendas" && "CODIGO_FILIAL" in dados[0] && codFiliaisConsiderados.size > 0) {
      dfs[tipo] = dados.filter(row => codFiliaisConsiderados.has(Math.trunc(Number(row.CODIGO_FILIAL))));
      return;
    }

    if ("FILIAL" in dados[0]) {
      dfs[tipo] = dados.filter(row => consideradas.has(normalizarFilial(row.FILIAL)));
    }
  });
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.details || result.error || "Erro ao consultar relatorio");
  }

  return result as T;
}

export default function ExportarRelatoriosPage() {
  const [relatorios, setRelatorios] = useState<RelatorioStatus[]>(criarRelatoriosIniciais);
  const [selecionados, setSelecionados] = useState<RelatorioExportavel[]>(RELATORIOS_EXPORTAVEIS);
  const [processando, setProcessando] = useState(false);
  const [tempoTotal, setTempoTotal] = useState<number | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [rotuloProcessamento, setRotuloProcessamento] = useState("");

  const atualizarRelatorio = (
    tipo: RelatorioExportavel,
    updates: Partial<RelatorioStatus>
  ) => {
    setRelatorios(prev =>
      prev.map(r => (r.tipo === tipo ? { ...r, ...updates } : r))
    );
  };

  const alternarSelecionado = (tipo: RelatorioExportavel) => {
    setSelecionados(prev =>
      prev.includes(tipo) ? prev.filter(item => item !== tipo) : [...prev, tipo]
    );
  };

  const buscarDados = async (
    tipo: RelatorioType,
    inicioRelatorio?: number,
    exibirStatus = false
  ) => {
    if (exibirStatus) {
      atualizarRelatorio(tipo as RelatorioExportavel, {
        status: "carregando",
        erro: undefined,
        tempoDecorrido: 0,
      });
    }

    const result = await fetchJson<{
      success: boolean;
      tipo: RelatorioType;
      registros: number;
      data: RelatorioRow[];
    }>(`/api/relatorios/query?tipo=${tipo}`);

    if (exibirStatus && inicioRelatorio) {
      atualizarRelatorio(tipo as RelatorioExportavel, {
        registros: result.registros,
        tempoDecorrido: (Date.now() - inicioRelatorio) / 1000,
      });
    }

    return result.data;
  };

  const processarNoServidor = async (
    tipo: RelatorioType,
    dados: RelatorioRow[],
    dadosAuxiliares?: Record<string, unknown>
  ) => {
    const result = await fetchJson<{
      success: boolean;
      tipo: RelatorioType;
      registros: number;
      data: RelatorioRow[];
    }>("/api/relatorios/processar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tipo,
        dados,
        dadosAuxiliares,
      }),
    });

    return result;
  };

  const processarRelatorioComStatus = async (
    tipo: RelatorioExportavel,
    dados: RelatorioRow[],
    dadosAuxiliares: Record<string, unknown> | undefined,
    inicioRelatorio: number
  ) => {
    atualizarRelatorio(tipo, { status: "processando" });

    try {
      const result = await processarNoServidor(tipo, dados, dadosAuxiliares);
      atualizarRelatorio(tipo, {
        status: "pronto",
        registros: result.registros,
        dados: result.data,
        tempoDecorrido: (Date.now() - inicioRelatorio) / 1000,
      });
      return result.data;
    } catch (error) {
      atualizarRelatorio(tipo, {
        status: "erro",
        erro: error instanceof Error ? error.message : "Erro desconhecido",
        tempoDecorrido: (Date.now() - inicioRelatorio) / 1000,
      });
      throw error;
    }
  };

  const executarRelatorios = async (relatoriosProcessar: RelatorioExportavel[]) => {
    if (processando || relatoriosProcessar.length === 0) return;

    const inicioTotal = Date.now();
    const inicioPorRelatorio: Partial<Record<RelatorioExportavel, number>> = {};
    const queriesNecessarias = determinarQueriesNecessarias(relatoriosProcessar);
    const totalEtapas = queriesNecessarias.size + relatoriosProcessar.length;
    let etapaAtual = 0;

    const concluirEtapa = () => {
      etapaAtual += 1;
      setProgresso(Math.min(100, Math.round((etapaAtual / totalEtapas) * 100)));
    };

    setProcessando(true);
    setTempoTotal(null);
    setProgresso(0);
    setRotuloProcessamento(
      relatoriosProcessar.length === RELATORIOS_EXPORTAVEIS.length
        ? "Exportando todos os relatorios..."
        : `Exportando ${relatoriosProcessar.map(r => RELATORIO_INFO[r].nome).join(", ")}...`
    );

    setRelatorios(prev =>
      prev.map(relatorio =>
        relatoriosProcessar.includes(relatorio.tipo)
          ? {
              ...relatorio,
              status: "pendente",
              registros: undefined,
              dados: undefined,
              erro: undefined,
              tempoDecorrido: 0,
            }
          : relatorio
      )
    );

    try {
      const dfs: Partial<Record<RelatorioType, RelatorioRow[]>> = {};

      for (const tipo of queriesNecessarias) {
        const tipoExportavel = RELATORIOS_EXPORTAVEIS.includes(tipo as RelatorioExportavel)
          ? (tipo as RelatorioExportavel)
          : null;
        const exibirStatus = Boolean(tipoExportavel && relatoriosProcessar.includes(tipoExportavel));

        if (tipoExportavel && exibirStatus) {
          inicioPorRelatorio[tipoExportavel] = Date.now();
        }

        setRotuloProcessamento(`Extraindo ${tipoExportavel ? RELATORIO_INFO[tipoExportavel].nome : tipo}...`);
        dfs[tipo] = await buscarDados(tipo, tipoExportavel ? inicioPorRelatorio[tipoExportavel] : undefined, exibirStatus);
        concluirEtapa();
      }

      filtrarPorFiliais(dfs);

      let produtosProcessados: RelatorioRow[] | null = null;
      const codigosBarra = dfs.produtos_barra ?? [];
      const cores = dfs.cores ?? [];

      if (relatoriosProcessar.includes("produtos")) {
        produtosProcessados = await processarRelatorioComStatus(
          "produtos",
          dfs.produtos ?? [],
          { codigosBarra },
          inicioPorRelatorio.produtos ?? inicioTotal
        );
        concluirEtapa();
      } else if (queriesNecessarias.has("produtos")) {
        const produtos = await processarNoServidor("produtos", dfs.produtos ?? [], { codigosBarra });
        produtosProcessados = produtos.data;
      }

      if (relatoriosProcessar.includes("estoque")) {
        if (!produtosProcessados) {
          const produtos = await processarNoServidor("produtos", dfs.produtos ?? [], { codigosBarra });
          produtosProcessados = produtos.data;
        }
        setRotuloProcessamento("Processando Estoque Tratado...");
        await processarRelatorioComStatus(
          "estoque",
          dfs.estoque ?? [],
          { produtos: produtosProcessados, codigosBarra },
          inicioPorRelatorio.estoque ?? inicioTotal
        );
        concluirEtapa();
      }

      if (relatoriosProcessar.includes("vendas")) {
        setRotuloProcessamento("Processando Vendas Tratadas...");
        await processarRelatorioComStatus(
          "vendas",
          dfs.vendas ?? [],
          { codigosBarra },
          inicioPorRelatorio.vendas ?? inicioTotal
        );
        concluirEtapa();
      }

      if (relatoriosProcessar.includes("ecommerce")) {
        setRotuloProcessamento("Processando E-commerce...");
        await processarRelatorioComStatus(
          "ecommerce",
          dfs.ecommerce ?? [],
          undefined,
          inicioPorRelatorio.ecommerce ?? inicioTotal
        );
        concluirEtapa();
      }

      if (relatoriosProcessar.includes("entradas")) {
        if (!produtosProcessados) {
          const produtos = await processarNoServidor("produtos", dfs.produtos ?? [], { codigosBarra });
          produtosProcessados = produtos.data;
        }
        setRotuloProcessamento("Processando Entradas...");
        await processarRelatorioComStatus(
          "entradas",
          dfs.entradas ?? [],
          { produtos: produtosProcessados, cores },
          inicioPorRelatorio.entradas ?? inicioTotal
        );
        concluirEtapa();
      }

      if (relatoriosProcessar.includes("saidas")) {
        if (!produtosProcessados) {
          const produtos = await processarNoServidor("produtos", dfs.produtos ?? [], { codigosBarra });
          produtosProcessados = produtos.data;
        }
        setRotuloProcessamento("Processando Saidas...");
        await processarRelatorioComStatus(
          "saidas",
          dfs.saidas ?? [],
          { produtos: produtosProcessados, cores },
          inicioPorRelatorio.saidas ?? inicioTotal
        );
        concluirEtapa();
      }

      setTempoTotal((Date.now() - inicioTotal) / 1000);
      setProgresso(100);
      setRotuloProcessamento("Exportacao concluida");
    } catch (error) {
      console.error("Erro ao processar relatorios:", error);
      window.alert(error instanceof Error ? error.message : "Erro ao processar relatorios");
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

  const handleExportExcel = (relatorio: RelatorioStatus) => {
    if (relatorio.dados && relatorio.dados.length > 0) {
      exportToExcel(relatorio.dados, NOMES_ARQUIVO[relatorio.tipo]);
    }
  };

  const handleExportCSV = (relatorio: RelatorioStatus) => {
    if (relatorio.dados && relatorio.dados.length > 0) {
      exportToCSV(relatorio.dados, NOMES_ARQUIVO[relatorio.tipo]);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Exportar Relatorios</h1>
        <p className={styles.subtitle}>
          Gere todos os relatorios ou selecione apenas os arquivos que voce precisa.
          <br />
          <span className={styles.subtitleHint}>
            A ordem, dependencias e filtros seguem o exportar_todos_relatorios.py.
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
                {rotuloProcessamento || (processando ? "Exportando relatorios..." : "Exportacao concluida")}
              </span>
              {processando && (
                <span className={styles.progressPercent}>{progresso}%</span>
              )}
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
              <div
                className={styles.progressBarFill}
                style={{ width: `${progresso}%` }}
              />
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
                  {relatorio.tempoDecorrido !== undefined && relatorio.tempoDecorrido > 0 && (
                    <span className={styles.relatorioTempo}>
                      {formatarTempo(relatorio.tempoDecorrido)}
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
                    onClick={() => handleExportExcel(relatorio)}
                  >
                    Exportar XLSX
                  </button>
                  <button
                    className={styles.buttonExport}
                    onClick={() => handleExportCSV(relatorio)}
                  >
                    Exportar CSV
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
    carregando: { label: "Carregando...", className: styles.badgeCarregando },
    processando: {
      label: "Processando...",
      className: styles.badgeProcessando,
    },
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

function formatarTempo(segundos: number): string {
  if (segundos < 60) {
    return `${segundos.toFixed(2)}s`;
  }
  const minutos = Math.floor(segundos / 60);
  const segs = Math.floor(segundos % 60);
  return `${minutos}m ${segs}s`;
}
