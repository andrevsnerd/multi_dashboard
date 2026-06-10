// @ts-ignore - xlsx tipos incompletos
import * as XLSX from 'xlsx';

import type { ProdutoParadoDetalhado } from '@/lib/repositories/controleEstoque';

function autoWidth(ws: XLSX.WorkSheet): void {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const colWidths: number[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      const len = cell ? String(cell.v ?? '').length : 0;
      colWidths[C] = Math.min(Math.max(colWidths[C] ?? 8, len + 2), 50);
    }
  }
  ws['!cols'] = colWidths.map(w => ({ wch: w }));
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Nunca';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function diasLabel(dias: number): string {
  if (dias >= 9999) return 'Nunca vendeu';
  return String(dias);
}

export function exportProdutosParadosXlsx(
  data: ProdutoParadoDetalhado[],
  companyName: string,
  minDias: number,
  filial: string | null
): void {
  const workbook = XLSX.utils.book_new();

  const headers = [
    'Produto',
    'Código de Barras',
    'Descrição',
    'Cor',
    'Grade',
    'Linha',
    'Subgrupo',
    'Coleção',
    'Estoque',
    'Dias Parado',
    'Última Venda',
  ];

  const rows = data.map(r => [
    r.produto,
    r.codigoBarra,
    r.descricao,
    r.cor,
    r.grade,
    r.linha,
    r.subgrupo,
    r.colecao,
    r.estoque,
    diasLabel(r.diasParado),
    formatDate(r.ultimaVenda),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  autoWidth(ws);
  XLSX.utils.book_append_sheet(workbook, ws, 'Produtos Parados');

  const dateStr = new Date().toISOString().split('T')[0];
  const company = companyName.replace(/\s+/g, '_');
  const filialLabel = filial ? `-${filial.replace(/\s+/g, '_')}` : '';
  const diasLabel2 = minDias >= 9998 ? '-nunca-vendeu' : minDias > 0 ? `-${minDias}d` : '';
  const filename = `produtos-parados-${company}${filialLabel}${diasLabel2}-${dateStr}.xlsx`;

  XLSX.writeFile(workbook, filename);
}
