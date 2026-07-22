import { NextResponse } from 'next/server';

import { fetchFilialProdutoSales } from '@/lib/repositories/performance';
import { type CompanyKey } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { normalizeRangeForQuery } from '@/lib/utils/date';

export const maxDuration = 300;

// Janelas de ritmo (em dias) — mesma ideia da imagem: 30/60/90/120 dias + 12 meses.
// A janela cobre os N dias ANTERIORES à data base (a data base em si fica de fora, pois
// costuma ser o "hoje" parcial).
const WINDOWS = [30, 60, 90, 120, 365] as const;

const MATRIZ_FILIAIS: Record<string, string[]> = {
  scarfme: ['SCARF ME - MATRIZ'],
  nerd: ['NERD'],
};

/** Soma/subtrai dias de uma data 'yyyy-MM-dd' no calendário (UTC-noon evita saltos de fuso/DST). */
function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function isValidYmd(value: string | null): value is string {
  if (!value) return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return !Number.isNaN(dt.getTime());
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company') as CompanyKey;
  const baseParam = searchParams.get('base');
  // Aceita repetido (?produto=a&produto=b) ou CSV (?produtos=a,b).
  const produtoIds = [
    ...searchParams.getAll('produto'),
    ...(searchParams.get('produtos') ?? '').split(','),
  ]
    .map((p) => p.trim())
    .filter(Boolean);

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" obrigatório' }, { status: 400 });
  }
  if (!isValidYmd(baseParam)) {
    return NextResponse.json({ error: 'Parâmetro "base" (yyyy-MM-dd) inválido' }, { status: 400 });
  }
  if (produtoIds.length === 0) {
    return NextResponse.json({ dataBase: baseParam, windows: WINDOWS, itens: [] });
  }

  const company = await resolveCompanyDynamic(companyKey);
  if (!company) {
    return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
  }

  // Escopo de vendas = REDE inteira (loja + e-commerce), como diz a legenda da planilha.
  // A Matriz não vende (fica de fora do ritmo). Nomes VIVOS via resolveCompanyDynamic.
  const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
  const matrizSet = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const filiais = (company.filialFilters.sales ?? []).filter((f) => !matrizSet.has(f));
  const posMembers = filiais.filter((f) => !ecommerceFilials.has(f));
  const ecomMembers = filiais.filter((f) => ecommerceFilials.has(f));

  try {
    // Uma consulta por janela (a maior é 365d), escopada aos produtos selecionados → leve.
    // Reusa a lógica VALIDADA de vendas (fetchFilialProdutoSales: POS com trocas + e-commerce).
    const perWindow = await Promise.all(
      WINDOWS.map(async (dias) => {
        const range = normalizeRangeForQuery({
          start: addDaysYmd(baseParam, -dias),
          end: addDaysYmd(baseParam, -1),
        });
        const rows = await fetchFilialProdutoSales(companyKey, posMembers, ecomMembers, range, 'month', {
          groupByCor: true,
          produtoIds,
          includePrevious: false,
          limit: 0,
        });
        return { dias, rows };
      })
    );

    // Monta produto||cor → { metadata, d30, d60, ... }
    type ItemAcc = {
      produto: string;
      cor: string;
      corDescricao: string;
      descricao: string;
      codigoBarra: string;
      grade: string;
      subgrupo: string;
      colecao: string;
      qtde: Record<number, number>;
    };
    const acc = new Map<string, ItemAcc>();

    perWindow.forEach(({ dias, rows }) => {
      rows.forEach((r) => {
        const cor = (r.cor ?? '').trim();
        const key = `${r.produto}||${cor}`;
        let item = acc.get(key);
        if (!item) {
          item = {
            produto: r.produto,
            cor,
            corDescricao: r.corDescricao ?? '',
            descricao: r.descricao ?? '',
            codigoBarra: r.codigoBarra ?? '',
            grade: r.grade ?? '',
            subgrupo: r.subgrupo ?? '',
            colecao: r.colecao ?? '',
            qtde: {},
          };
          acc.set(key, item);
        }
        // Metadados chegam iguais em todas as janelas; preenche o que ainda faltar.
        if (!item.corDescricao && r.corDescricao) item.corDescricao = r.corDescricao;
        if (!item.descricao && r.descricao) item.descricao = r.descricao;
        if (!item.codigoBarra && r.codigoBarra) item.codigoBarra = r.codigoBarra;
        // A quantidade líquida da janela pode ser negativa (mais trocas que vendas) — piso 0.
        item.qtde[dias] = Math.max(0, Math.round(Number(r.qtde ?? 0)));
      });
    });

    const itens = Array.from(acc.values()).map((item) => ({
      produto: item.produto,
      cor: item.cor,
      corDescricao: item.corDescricao,
      descricao: item.descricao,
      codigoBarra: item.codigoBarra,
      grade: item.grade,
      subgrupo: item.subgrupo,
      colecao: item.colecao,
      janelas: Object.fromEntries(WINDOWS.map((d) => [d, item.qtde[d] ?? 0])),
    }));

    return NextResponse.json(
      { dataBase: baseParam, windows: WINDOWS, itens },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Erro em /api/produto-projecao-compra:', error);
    return NextResponse.json({ error: 'Erro ao calcular projeção' }, { status: 500 });
  }
}
