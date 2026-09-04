import type { ColumnType, ReportPresetColumn, ReportRow } from "@/lib/reports/types";

import {
  exportCompraPorLojaXlsx,
  type CompraLojaExportColumn,
} from "@/lib/utils/exportCompraSugeridaAbcXlsx";

type CellValue = string | number | boolean | null;

/**
 * Export do relatório "Custos de Defeitos".
 *
 * Reaproveita o NÚCLEO do export "compra por loja" (o mesmo visual do XLSX de compra:
 * faixa de título, cabeçalho azul-escuro, células de total destacadas e a linha TOTAL no
 * rodapé) — sem colunas por loja. Os papéis mapeados fazem o Excel recalcular sozinho:
 *  - Qtde  → papel `compraTotal` (sem colunas de loja, fica um número editável)
 *  - Custo unit. → `custoUnit`
 *  - Custo total → `custoTotal`, escrito como FÓRMULA `custo unit. × qtde`
 * A linha TOTAL soma Qtde e Custo total. Mexeu na quantidade, o total anda junto.
 */
export async function exportCustosDefeitosXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    companyKey: string;
    companyName?: string;
    columnTypes?: Record<string, ColumnType>;
    sheetName?: string;
  }
): Promise<void> {
  const types = options.columnTypes ?? {};

  const mapped: CompraLojaExportColumn[] = columns.map((c) => {
    if (c.key === "QUANTIDADE") return { key: c.key, label: c.label, role: "compraTotal", type: "int" };
    if (c.key === "CUSTO_UNITARIO") return { key: c.key, label: c.label, role: "custoUnit", type: "currency" };
    if (c.key === "CUSTO_TOTAL") return { key: c.key, label: c.label, role: "custoTotal", type: "currency" };
    return { key: c.key, label: c.label, role: "value", type: types[c.key] ?? "text" };
  });

  const pecas = rows.reduce((acc, r) => acc + Number(r.QUANTIDADE ?? 0), 0);
  const hoje = new Date().toLocaleDateString("pt-BR");

  await exportCompraPorLojaXlsx(rows as Array<Record<string, CellValue>>, mapped, {
    fileLabel: "defeitos",
    companyKey: options.companyKey,
    sheetName: options.sheetName ?? "Custos de defeitos",
    titleLines: [
      `Custos de Defeitos${options.companyName ? ` · ${options.companyName}` : ""}`,
      `Gerado em ${hoje} · ${rows.length} item(ns) · ${pecas.toLocaleString("pt-BR")} peça(s)`,
    ],
    dateRange: null,
  });
}
