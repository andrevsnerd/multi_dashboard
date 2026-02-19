/**
 * Exporta tabela do detalhado (colunas + linhas) para XLSX simples.
 * Usado nos níveis: estoquedetalhado01, estoquedetalhado01-produto, estoquedetalhado02.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - xlsx tipos incompletos
import * as XLSX from 'xlsx';

export function exportDetalhadoToXlsx(
  columns: string[],
  rows: (string | number)[][],
  filename: string
): void {
  const aoa: (string | number)[][] = [columns, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detalhes');
  XLSX.writeFile(wb, filename);
}
