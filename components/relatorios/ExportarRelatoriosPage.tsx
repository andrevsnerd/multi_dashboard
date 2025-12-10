"use client";

import { useState, useEffect } from "react";
import { exportToExcel, exportToCSV } from "@/lib/utils/exportRelatorios";
import styles from "./ExportarRelatoriosPage.module.css";

type RelatorioType =
  | "produtos"
  | "estoque"
  | "vendas"
  | "ecommerce"
  | "entradas"
  | "produtos_barra"
  | "cores";

// Apenas relatórios que são realmente exportados (excluindo auxiliares como produtos_barra e cores)
type RelatorioExportavel = 
  | "produtos"
  | "estoque"
  | "vendas"
  | "ecommerce"
  | "entradas";

interface RelatorioStatus {
  tipo: RelatorioType;
  nome: string;
  status: "pendente" | "carregando" | "processando" | "pronto" | "erro";
  registros?: number;
  dados?: Record<string, any>[];
  erro?: string;
  tempoDecorrido?: number; // em segundos
}

// Mapeamento dos nomes de arquivo padrão (exatamente como no script Python)
const NOMES_ARQUIVO: Record<RelatorioType, string> = {
  produtos: "produtos_tratados",
  estoque: "estoque_tratados",
  vendas: "vendas_tratadas",
  ecommerce: "ecommerce",
  entradas: "entradas",
  produtos_barra: "produtos_barra",
  cores: "cores",
};

// Apenas relatórios que são realmente exportados (excluindo auxiliares como produtos_barra e cores)
const RELATORIO_INFO: Record<RelatorioExportavel, { nome: string; ordem: number }> = {
  produtos: { nome: "Produtos Tratados", ordem: 1 },
  estoque: { nome: "Estoque Tratado", ordem: 2 },
  vendas: { nome: "Vendas Tratadas", ordem: 3 },
  ecommerce: { nome: "E-commerce", ordem: 4 },
  entradas: { nome: "Entradas", ordem: 5 },
};

export default function ExportarRelatoriosPage() {
  const [relatorios, setRelatorios] = useState<RelatorioStatus[]>(() => {
    return Object.entries(RELATORIO_INFO)
      .sort(([, a], [, b]) => a.ordem - b.ordem)
      .map(([tipo, info]) => ({
        tipo: tipo as RelatorioType,
        nome: info.nome,
        status: "pendente" as const,
      }));
  });

  const [processando, setProcessando] = useState(false);
  const [tempoTotal, setTempoTotal] = useState<number | null>(null);
  const [progresso, setProgresso] = useState(0);

  const atualizarRelatorio = (
    tipo: RelatorioType,
    updates: Partial<RelatorioStatus>
  ) => {
    setRelatorios((prev) =>
      prev.map((r) => (r.tipo === tipo ? { ...r, ...updates } : r))
    );
  };

  const buscarDados = async (tipo: RelatorioType, inicioTempo?: number) => {
    const inicio = inicioTempo || Date.now();
    atualizarRelatorio(tipo, { status: "carregando", tempoDecorrido: 0 });

    try {
      const response = await fetch(`/api/relatorios/query?tipo=${tipo}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Erro ao buscar dados");
      }

      const tempoAteAgora = (Date.now() - inicio) / 1000;
      atualizarRelatorio(tipo, {
        status: "processando",
        registros: result.registros,
        dados: result.data,
        tempoDecorrido: tempoAteAgora,
      });

      return { data: result.data, inicioTempo: inicio };
    } catch (error) {
      const tempoAteAgora = (Date.now() - inicio) / 1000;
      atualizarRelatorio(tipo, {
        status: "erro",
        erro: error instanceof Error ? error.message : "Erro desconhecido",
        tempoDecorrido: tempoAteAgora,
      });
      throw error;
    }
  };

  const processarRelatorio = async (
    tipo: RelatorioType,
    dados: Record<string, any>[],
    dadosAuxiliares: Record<string, any> | undefined,
    inicioTempo: number
  ) => {
    try {
      const response = await fetch("/api/relatorios/processar", {
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

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Erro ao processar dados");
      }

      // Tempo total desde o início da busca até o fim do processamento
      const tempoTotal = (Date.now() - inicioTempo) / 1000;
      
      atualizarRelatorio(tipo, {
        status: "pronto",
        registros: result.registros,
        dados: result.data,
        tempoDecorrido: tempoTotal,
      });

      return result.data;
    } catch (error) {
      // Tempo total até o erro
      const tempoTotal = (Date.now() - inicioTempo) / 1000;
      
      atualizarRelatorio(tipo, {
        status: "erro",
        erro: error instanceof Error ? error.message : "Erro desconhecido",
        tempoDecorrido: tempoTotal,
      });
      throw error;
    }
  };

  const executarTodos = async () => {
    const inicioTotal = Date.now();
    setProcessando(true);
    setTempoTotal(null);
    setProgresso(0);
    
    // Resetar tempos dos relatórios
    relatorios.forEach(r => {
      atualizarRelatorio(r.tipo, { tempoDecorrido: 0 });
    });

    const totalEtapas = 10; // produtos busca, produtos processa, estoque busca, estoque processa, vendas busca, vendas processa, ecommerce busca, ecommerce processa, entradas busca, entradas processa
    let etapaAtual = 0;

    const atualizarProgresso = () => {
      etapaAtual++;
      setProgresso(Math.round((etapaAtual / totalEtapas) * 100));
    };

    try {
      // 1. Buscar dados auxiliares primeiro
      console.log("[1/10] Buscando produtos...");
      const inicioProdutos = Date.now();
      const produtosRawResult = await buscarDados("produtos");
      atualizarProgresso();
      
      // Códigos de barra e cores são apenas auxiliares - buscar sem mostrar na UI
      console.log("[Auxiliar] Buscando códigos de barras...");
      const codigosBarraResponse = await fetch("/api/relatorios/query?tipo=produtos_barra");
      const codigosBarraResult = await codigosBarraResponse.json();
      const codigosBarra = codigosBarraResult.data || [];
      
      console.log("[Auxiliar] Buscando cores...");
      const coresResponse = await fetch("/api/relatorios/query?tipo=cores");
      const coresResult = await coresResponse.json();
      const cores = coresResult.data || [];

      // 2. Processar produtos (usando o mesmo início do carregamento)
      console.log("[2/10] Processando produtos...");
      const produtosProcessados = await processarRelatorio(
        "produtos",
        produtosRawResult.data,
        { codigosBarra },
        inicioProdutos
      );
      atualizarProgresso();
      const tempoProdutosTotal = relatorios.find(r => r.tipo === "produtos")?.tempoDecorrido || 0;
      console.log(`✓ Produtos concluído em ${tempoProdutosTotal.toFixed(2)}s`);

      // 3. Buscar e processar estoque
      console.log("[3/10] Buscando estoque...");
      const inicioEstoque = Date.now();
      const estoqueRawResult = await buscarDados("estoque");
      atualizarProgresso();
      
      console.log("[4/10] Processando estoque...");
      await processarRelatorio(
        "estoque",
        estoqueRawResult.data,
        {
          produtos: produtosProcessados,
          codigosBarra,
        },
        inicioEstoque
      );
      atualizarProgresso();
      const tempoEstoqueTotal = relatorios.find(r => r.tipo === "estoque")?.tempoDecorrido || 0;
      console.log(`✓ Estoque concluído em ${tempoEstoqueTotal.toFixed(2)}s`);

      // 4. Buscar e processar vendas
      console.log("[5/10] Buscando vendas...");
      const inicioVendas = Date.now();
      const vendasRawResult = await buscarDados("vendas");
      atualizarProgresso();
      
      console.log("[6/10] Processando vendas...");
      await processarRelatorio(
        "vendas",
        vendasRawResult.data,
        { codigosBarra },
        inicioVendas
      );
      atualizarProgresso();
      const tempoVendasTotal = relatorios.find(r => r.tipo === "vendas")?.tempoDecorrido || 0;
      console.log(`✓ Vendas concluído em ${tempoVendasTotal.toFixed(2)}s`);

      // 5. Buscar e processar ecommerce
      console.log("[7/10] Buscando e-commerce...");
      const inicioEcommerce = Date.now();
      const ecommerceRawResult = await buscarDados("ecommerce");
      atualizarProgresso();
      
      console.log("[8/10] Processando e-commerce...");
      await processarRelatorio(
        "ecommerce",
        ecommerceRawResult.data,
        undefined,
        inicioEcommerce
      );
      atualizarProgresso();
      const tempoEcommerceTotal = relatorios.find(r => r.tipo === "ecommerce")?.tempoDecorrido || 0;
      console.log(`✓ E-commerce concluído em ${tempoEcommerceTotal.toFixed(2)}s`);

      // 6. Buscar e processar entradas
      console.log("[9/10] Buscando entradas...");
      const inicioEntradas = Date.now();
      const entradasRawResult = await buscarDados("entradas");
      atualizarProgresso();
      
      console.log("[10/10] Processando entradas...");
      await processarRelatorio(
        "entradas",
        entradasRawResult.data,
        {
          produtos: produtosProcessados,
          cores,
        },
        inicioEntradas
      );
      atualizarProgresso();
      const tempoEntradasTotal = relatorios.find(r => r.tipo === "entradas")?.tempoDecorrido || 0;
      console.log(`✓ Entradas concluído em ${tempoEntradasTotal.toFixed(2)}s`);

      const tempoTotalFinal = (Date.now() - inicioTotal) / 1000;
      setTempoTotal(tempoTotalFinal);
      console.log(`\n========================================`);
      console.log(`✅ EXPORTAÇÃO CONCLUÍDA!`);
      console.log(`Tempo total: ${tempoTotalFinal.toFixed(2)}s`);
      console.log(`========================================\n`);
    } catch (error) {
      console.error("Erro ao processar relatórios:", error);
      alert("Erro ao processar relatórios. Verifique o console para detalhes.");
    } finally {
      setProcessando(false);
    }
  };

  const handleExportExcel = (relatorio: RelatorioStatus) => {
    if (relatorio.dados && relatorio.dados.length > 0) {
      const nomeArquivo = NOMES_ARQUIVO[relatorio.tipo] || relatorio.nome;
      exportToExcel(relatorio.dados, nomeArquivo);
    }
  };

  const handleExportCSV = (relatorio: RelatorioStatus) => {
    if (relatorio.dados && relatorio.dados.length > 0) {
      const nomeArquivo = NOMES_ARQUIVO[relatorio.tipo] || relatorio.nome;
      exportToCSV(relatorio.dados, nomeArquivo);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Exportar Relatórios</h1>
        <p className={styles.subtitle}>
          Gere todos os relatórios processados e exporte para Excel ou CSV.
          <br />
          <span className={styles.subtitleHint}>
            O processo continua automaticamente mesmo se você trocar de aba ou sair do computador.
          </span>
        </p>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.buttonPrimary}
          onClick={executarTodos}
          disabled={processando}
        >
          {processando ? "Processando..." : "Iniciar Exportação"}
        </button>
      </div>

      {(processando || tempoTotal !== null) && (
        <div className={styles.progressContainer}>
          <div className={styles.progressHeader}>
            <div className={styles.progressInfo}>
              <span className={styles.progressLabel}>
                {processando ? "Exportando relatórios..." : "Exportação concluída!"}
              </span>
              {processando && (
                <span className={styles.progressPercent}>{progresso}%</span>
              )}
            </div>
            {tempoTotal !== null && (
              <div className={styles.timeInfo}>
                <span className={styles.tempoTotal}>
                  ✅ Tempo total: {formatarTempo(tempoTotal)}
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
        {relatorios.map((relatorio) => (
          <div key={relatorio.tipo} className={styles.relatorioCard}>
            <div className={styles.relatorioHeader}>
              <div className={styles.relatorioInfo}>
                <h3 className={styles.relatorioNome}>{relatorio.nome}</h3>
                <div className={styles.relatorioMetadata}>
                  {relatorio.registros != null && (
                    <span className={styles.relatorioRegistros}>
                      {relatorio.registros.toLocaleString("pt-BR")} registros
                    </span>
                  )}
                  {relatorio.tempoDecorrido !== undefined && relatorio.tempoDecorrido > 0 && (
                    <span className={styles.relatorioTempo}>
                      ⏱️ {formatarTempo(relatorio.tempoDecorrido)}
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

            {relatorio.status === "pronto" && (
              <div className={styles.exportButtons}>
                <button
                  className={styles.buttonExport}
                  onClick={() => handleExportExcel(relatorio)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 14H14V2H2V14ZM4 4H12V6H4V4ZM4 7H12V9H4V7ZM4 10H12V12H4V10Z"
                      fill="currentColor"
                    />
                  </svg>
                  Exportar XLSX
                </button>
                <button
                  className={styles.buttonExport}
                  onClick={() => handleExportCSV(relatorio)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 14H14V2H2V14ZM4 4H12V6H4V4ZM4 7H12V9H4V7ZM4 10H12V12H4V10Z"
                      fill="currentColor"
                    />
                  </svg>
                  Exportar CSV
                </button>
              </div>
            )}
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

