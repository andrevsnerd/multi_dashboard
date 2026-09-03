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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Último dia do mês (1-12) como 'yyyy-MM-dd'. */
function lastDayOfMonth(ano: number, mes: number): string {
  const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${pad2(mes)}-${pad2(dia)}`;
}

/** Roda `fn` sobre a lista com no máximo `limite` chamadas simultâneas. */
async function mapLimit<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
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
  // `item=produto||cor` (repetido) recorta a seleção EXATA de produto x cor — usado quando o
  // usuário escolhe itens a dedo. Sem ele, um produto entraria com todas as suas cores.
  const itemKeys = new Set(
    searchParams
      .getAll('item')
      .map((v) => v.trim())
      .filter((v) => v.includes('||'))
  );
  const produtoIds = Array.from(
    new Set(
      [
        ...searchParams.getAll('produto'),
        ...(searchParams.get('produtos') ?? '').split(','),
        ...Array.from(itemKeys).map((k) => k.split('||')[0]),
      ]
        .map((p) => p.trim())
        .filter(Boolean)
    )
  );

  // Recortes por dimensão do cadastro (um select por dimensão na tela, cada um repetível).
  const readDim = (name: string) =>
    Array.from(
      new Set(
        searchParams
          .getAll(name)
          .flatMap((v) => v.split(','))
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean)
      )
    );
  const dimensoes = {
    grupos: readDim('grupo'),
    linhas: readDim('linha'),
    subgrupos: readDim('subgrupo'),
    grades: readDim('grade'),
    colecoes: readDim('colecao'),
    cores: readDim('cor'),
    tipos: readDim('tipo'),
  };
  const temDimensao = Object.values(dimensoes).some((values) => values.length > 0);

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" obrigatório' }, { status: 400 });
  }
  if (!isValidYmd(baseParam)) {
    return NextResponse.json({ error: 'Parâmetro "base" (yyyy-MM-dd) inválido' }, { status: 400 });
  }
  // Sem escopo algum a projeção seria "a rede inteira somada", que não é um cenário de
  // compra útil (e custaria 5 varreduras completas). A tela cobra ao menos um recorte.
  if (produtoIds.length === 0 && !temDimensao) {
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

  // Escopo comum a todas as consultas: mesma lógica VALIDADA de vendas, só recortada.
  const escopo = {
    produtoIds: produtoIds.length > 0 ? produtoIds : null,
    dimensoes,
    includePrevious: false as const,
    limit: 0,
  };
  /** Fora da seleção exata de produto x cor a linha não entra na conta. */
  const noEscopo = (produto: string, cor: string | undefined) =>
    itemKeys.size === 0 || itemKeys.has(`${produto}||${(cor ?? '').trim()}`);

  const anoBase = Number(baseParam.slice(0, 4));
  const mesBase = Number(baseParam.slice(5, 7));

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
          ...escopo,
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
        if (!noEscopo(r.produto, r.cor)) return;
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
        // Quantidade LÍQUIDA da janela, como veio da regra global (pode ser negativa quando
        // houve mais troca que venda). Não se aplica piso por item: descartar linha negativa
        // antes de somar infla o total — ver [[vendas-nunca-filtrar-linhas-da-regra-global]].
        // O piso 0 é aplicado no total do escopo, na tela.
        item.qtde[dias] = Math.round(Number(r.qtde ?? 0));
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

    // ── Série MENSAL: ano da data base + o mesmo mês do ano anterior, para a regra
    //    comparativa de crescimento (jan/26 x jan/25, fev x fev …). Meses ainda no futuro
    //    não são consultados (venda futura é sempre 0); do ano anterior vêm todos os 12.
    //    O mês da data base fecha em base−1, igual às janelas, então é PARCIAL.
    const mesesConsulta: Array<{ ano: number; mes: number }> = [];
    for (let mes = 1; mes <= 12; mes += 1) mesesConsulta.push({ ano: anoBase - 1, mes });
    for (let mes = 1; mes <= mesBase; mes += 1) mesesConsulta.push({ ano: anoBase, mes });

    // Sem seleção exata nem filtro de cor não precisa quebrar por cor — o total do mês é o
    // mesmo e a consulta fica bem mais leve (some o join de PRODUTO_CORES).
    const mensalPorCor = itemKeys.size > 0 || dimensoes.cores.length > 0;

    const totaisMes = await mapLimit(mesesConsulta, 4, async ({ ano, mes }) => {
      const primeiro = `${ano}-${pad2(mes)}-01`;
      // No mês da data base a janela para no dia anterior à base (mês em curso, parcial).
      const ultimo =
        ano === anoBase && mes === mesBase ? addDaysYmd(baseParam, -1) : lastDayOfMonth(ano, mes);
      if (ultimo < primeiro) return { chave: `${ano}-${pad2(mes)}`, qtde: 0 };
      const range = normalizeRangeForQuery({ start: primeiro, end: ultimo });
      const rows = await fetchFilialProdutoSales(companyKey, posMembers, ecomMembers, range, 'month', {
        groupByCor: mensalPorCor,
        ...escopo,
      });
      const qtde = rows.reduce(
        (soma, r) => (noEscopo(r.produto, r.cor) ? soma + Number(r.qtde ?? 0) : soma),
        0
      );
      return { chave: `${ano}-${pad2(mes)}`, qtde: Math.round(qtde) };
    });

    const qtdePorMes = new Map(totaisMes.map(({ chave, qtde }) => [chave, qtde]));
    const mensal = Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      return {
        mes: `${anoBase}-${pad2(mes)}`,
        qtde: qtdePorMes.get(`${anoBase}-${pad2(mes)}`) ?? 0,
        qtdeAnoAnterior: qtdePorMes.get(`${anoBase - 1}-${pad2(mes)}`) ?? 0,
        /** Mês em curso: fechado só até a data base, não serve de base de crescimento. */
        parcial: mes === mesBase,
        futuro: mes > mesBase,
      };
    });

    return NextResponse.json(
      { dataBase: baseParam, windows: WINDOWS, itens, mensal },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Erro em /api/projecao-compra:', error);
    return NextResponse.json({ error: 'Erro ao calcular projeção' }, { status: 500 });
  }
}
