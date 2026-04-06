/**
 * Exporta consulta de estoque para Excel com múltiplas abas:
 *  - "Linhas"            → resumo por linha/categoria (dados já carregados no dashboard)
 *  - "Produtos por Filial" → pivot com estoque de cada produto por filial (busca via API)
 */
// @ts-ignore - xlsx tipos incompletos
import * as XLSX from 'xlsx';

interface CategoriaEstoque {
  categoria: string;
  estoqueAtual: number;
  custoTotal: number;
  custoUnitario: number;
  vendasPeriodo: number;
  duracao: number;
  projecaoMes: number;
  projecaoAnual: number;
  projecaoVendasMes: number;
  tendenciaSemanal: number;
  estoqueSemanaPassada: number;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
}

interface ProdutoVariacaoPorFilial {
  produto: string;
  descricao: string;
  linha: string;
  subgrupo: string;
  grade: string;
  colecao: string;
  cor: string;
  filial: string;
  estoque: number;
  preco: number;
  custoUnitario: number;
  custoTotal: number;
  vendasTotais: number;
}

interface ProdutoDetalhesPorFilial {
  nomeProduto: string;
  resumo: {
    totalFiliais: number;
    estoqueTotal: number;
    custoTotal: number;
    vendasTotais: number;
  };
  variacoes: ProdutoVariacaoPorFilial[];
}

export interface ExportEstoqueConsultaOptions {
  companyKey: string;
  companyName: string;
  filial: string | null;
  linhas: string[];
  subgrupos: string[];
  grades: string[];
  colecoes: string[];
  grupos: string[];
  categorias: CategoriaEstoque[];
}

async function fetchProdutosPorFilial(
  options: ExportEstoqueConsultaOptions
): Promise<ProdutoDetalhesPorFilial | null> {
  const params = new URLSearchParams({ company: options.companyKey });
  if (options.filial) params.set('filial', options.filial);
  if (options.linhas.length === 1) params.set('linha', options.linhas[0]);
  if (options.grupos.length === 1) params.set('grupo', options.grupos[0]);
  if (options.subgrupos.length === 1) params.set('subgrupo', options.subgrupos[0]);
  if (options.grades.length === 1) params.set('grade', options.grades[0]);
  if (options.colecoes.length === 1) params.set('colecao', options.colecoes[0]);

  const res = await fetch(`/api/controle-estoque/detalhes-por-filial?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const json = await res.json() as { data: ProdutoDetalhesPorFilial };
  return json.data;
}

function autoWidth(ws: XLSX.WorkSheet): void {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const colWidths: number[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      const len = cell ? String(cell.v ?? '').length : 0;
      colWidths[C] = Math.min(Math.max(colWidths[C] ?? 8, len + 2), 40);
    }
  }
  ws['!cols'] = colWidths.map(w => ({ wch: w }));
}

export async function exportEstoqueConsultaXlsx(
  options: ExportEstoqueConsultaOptions
): Promise<void> {
  const { companyKey, companyName, categorias } = options;

  const workbook = XLSX.utils.book_new();

  // ─── ABA 1: RESUMO POR LINHA ──────────────────────────────────────────────
  const isScarfme = companyKey === 'scarfme';

  const linhasHeaders = [
    'Linha / Categoria',
    ...(isScarfme ? ['Subgrupo', 'Grade', 'Coleção'] : ['Subgrupo', 'Grade']),
    'Estoque Atual',
    'Custo Unitário (R$)',
    'Custo Total (R$)',
    'Vendas Período',
    'Duração (dias)',
    'Proj. Vendas Mês',
    'Proj. Estoque Fim Mês',
    'Proj. Estoque Fim Ano',
    'Tendência Semanal',
    'Estoque Semana Passada',
  ];

  const linhasRows = categorias.map(c => {
    const base = [
      c.categoria,
      c.subgrupo ?? '',
      c.grade ?? '',
      ...(isScarfme ? [c.colecao ?? ''] : []),
      c.estoqueAtual,
      c.custoUnitario,
      c.custoTotal,
      c.vendasPeriodo,
      c.duracao,
      c.projecaoVendasMes,
      c.projecaoMes,
      c.projecaoAnual,
      c.tendenciaSemanal,
      c.estoqueSemanaPassada,
    ];
    return base;
  });

  const wsLinhas = XLSX.utils.aoa_to_sheet([linhasHeaders, ...linhasRows]);
  autoWidth(wsLinhas);
  XLSX.utils.book_append_sheet(workbook, wsLinhas, 'Linhas');

  // ─── ABA 2: PRODUTOS POR FILIAL ───────────────────────────────────────────
  const dadosPorFilial = await fetchProdutosPorFilial(options);

  if (dadosPorFilial && dadosPorFilial.variacoes.length > 0) {
    const variacoes = dadosPorFilial.variacoes;

    // Coletar filiais únicas (ordenadas)
    const filiaisSet = new Set<string>();
    variacoes.forEach(v => filiaisSet.add(v.filial));
    const filiais = Array.from(filiaisSet).sort();

    // Agrupar por produto + cor (chave única)
    type ProdKey = string;
    const map = new Map<ProdKey, {
      produto: string;
      descricao: string;
      linha: string;
      subgrupo: string;
      grade: string;
      colecao: string;
      cor: string;
      estoqueFilial: Record<string, number>;
      preco: number;
      custoUnitario: number;
      vendasTotais: number;
    }>();

    variacoes.forEach(v => {
      const key = `${v.produto}||${v.cor}`;
      if (!map.has(key)) {
        map.set(key, {
          produto: v.produto,
          descricao: v.descricao,
          linha: v.linha,
          subgrupo: v.subgrupo,
          grade: v.grade,
          colecao: v.colecao,
          cor: v.cor,
          estoqueFilial: {},
          preco: v.preco,
          custoUnitario: v.custoUnitario,
          vendasTotais: 0,
        });
      }
      const row = map.get(key)!;
      row.estoqueFilial[v.filial] = (row.estoqueFilial[v.filial] ?? 0) + v.estoque;
      row.vendasTotais += v.vendasTotais;
    });

    const prodHeaders = [
      'Produto',
      'Descrição',
      'Linha',
      'Subgrupo',
      'Grade',
      'Coleção',
      'Cor',
      ...filiais,
      'Total Estoque',
      'Preço (R$)',
      'Custo Unit. (R$)',
      'Custo Total (R$)',
      'Vendas Mês',
    ];

    const prodRows = Array.from(map.values()).map(r => {
      const estoqueFiliais = filiais.map(f => r.estoqueFilial[f] ?? 0);
      const totalEstoque = estoqueFiliais.reduce((a, b) => a + b, 0);
      const custoTotal = totalEstoque * r.custoUnitario;
      return [
        r.produto,
        r.descricao,
        r.linha,
        r.subgrupo,
        r.grade,
        r.colecao,
        r.cor,
        ...estoqueFiliais,
        totalEstoque,
        r.preco,
        r.custoUnitario,
        custoTotal,
        r.vendasTotais,
      ];
    });

    const wsProd = XLSX.utils.aoa_to_sheet([prodHeaders, ...prodRows]);
    autoWidth(wsProd);
    XLSX.utils.book_append_sheet(workbook, wsProd, 'Produtos por Filial');
  }

  // ─── ABA 3: RESUMO POR FILIAL (pivot estoque por linha × filial) ──────────
  if (dadosPorFilial && dadosPorFilial.variacoes.length > 0) {
    const variacoes = dadosPorFilial.variacoes;

    const filiaisSet = new Set<string>();
    variacoes.forEach(v => filiaisSet.add(v.filial));
    const filiais = Array.from(filiaisSet).sort();

    // Agrupar por linha
    const linhaMap = new Map<string, Record<string, number>>();
    variacoes.forEach(v => {
      const linha = v.linha || '(sem linha)';
      if (!linhaMap.has(linha)) linhaMap.set(linha, {});
      const entry = linhaMap.get(linha)!;
      entry[v.filial] = (entry[v.filial] ?? 0) + v.estoque;
    });

    const resumoHeaders = ['Linha', ...filiais, 'Total'];
    const resumoRows = Array.from(linhaMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([linha, estoqueFilial]) => {
        const vals = filiais.map(f => estoqueFilial[f] ?? 0);
        const total = vals.reduce((a, b) => a + b, 0);
        return [linha, ...vals, total];
      });

    const wsResumo = XLSX.utils.aoa_to_sheet([resumoHeaders, ...resumoRows]);
    autoWidth(wsResumo);
    XLSX.utils.book_append_sheet(workbook, wsResumo, 'Estoque Linha x Filial');
  }

  // ─── Download ─────────────────────────────────────────────────────────────
  const dateStr = new Date().toISOString().split('T')[0];
  const filialLabel = options.filial ? `-${options.filial.replace(/\s+/g, '_')}` : '';
  const filename = `estoque-consulta-${companyKey}${filialLabel}-${dateStr}.xlsx`;

  XLSX.writeFile(workbook, filename);
}
