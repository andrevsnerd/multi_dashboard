import { NextResponse } from "next/server";

import { autorizarPrecos, parsePrecoCompany } from "@/lib/auth/precos-guard";
import {
  filterStockCarryingFilials,
  getFilialLabelForDisplay,
  normalizeFilialLookupKey,
} from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { chaveCor, fetchEstoqueProdutosPorFilial, fetchItensBlackFriday } from "@/lib/repositories/blackFriday";
import { fetchFilialProdutoSales, type FilialProdutoSalesRow } from "@/lib/repositories/performance";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { addDiasYmd, hojeBrasilia, listarDias, MATRIZ_FILIAIS, mapWithConcurrency } from "@/lib/blackfriday/datas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Base pré-Black: 4 semanas cheias antes do início (mesma mistura de dias da semana). */
const DIAS_BASE = 28;
const CONCURRENCY = 6;

/** Venda por loja de um item: período da Black, hoje e base pré-Black. */
interface VendaLoja {
  v: number;
  q: number;
  vh: number;
  qh: number;
  vb: number;
  qb: number;
}

/**
 * Painel Black Friday: itens da Black (histórico de preço) × venda CANÔNICA
 * (`fetchFilialProdutoSales`, com trocas) dia a dia desde o início + 28 dias antes
 * como base de ritmo, e estoque do Linx por loja (perna ativa, só positivos).
 *
 * A venda do período é a soma das consultas diárias — mesma CTE validada, só fatiada
 * por dia para dar a curva; nada de SQL de venda novo.
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ("erro" in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const companyKey = parsePrecoCompany(searchParams.get("company"));
  if (!companyKey) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  }

  try {
    const company = await resolveCompanyDynamic(companyKey);
    if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });

    const { inicio, itens } = await fetchItensBlackFriday(companyKey);
    const agora = hojeBrasilia();

    if (!inicio || itens.length === 0) {
      return NextResponse.json(
        {
          inicio,
          hoje: agora.ymd,
          diasDecorridos: 0,
          dias: [],
          base: null,
          lojas: [],
          itens: [],
          podeExecutar: autorizacao.auth.podeExecutar,
          geradoEm: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const produtos = itens.map((i) => i.produto);
    const dias = listarDias(inicio, agora.ymd);
    const baseInicio = addDiasYmd(inicio, -DIAS_BASE);
    const baseFim = addDiasYmd(inicio, -1);

    // Universo de venda: tudo menos a matriz (depósito). E-commerce entra como canal.
    const matriz = new Set((MATRIZ_FILIAIS[companyKey] ?? []).map(normalizeFilialLookupKey));
    const ecommerceSet = new Set((company.ecommerceFilials ?? []).map(normalizeFilialLookupKey));
    const vendaFiliais = (company.filialFilters.sales ?? []).filter((f) => !matriz.has(normalizeFilialLookupKey(f)));
    const pos = vendaFiliais.filter((f) => !ecommerceSet.has(normalizeFilialLookupKey(f)));
    const ecom = vendaFiliais.filter((f) => ecommerceSet.has(normalizeFilialLookupKey(f)));

    const buscar = (start: string, end: string) =>
      fetchFilialProdutoSales(companyKey, pos, ecom, normalizeRangeForQuery({ start, end }), "month", {
        groupByCor: true,
        groupByFilial: true,
        produtoIds: produtos,
        includePrevious: false,
        limit: 0,
      });

    // Estoque: perna ATIVA de cada grupo (saldo de CNPJ parado não se vende).
    const estoqueFiliais = filterStockCarryingFilials(company, company.filialFilters.inventory ?? []);
    const estoqueSet = new Set(estoqueFiliais.map(normalizeFilialLookupKey));

    const [porDia, base, estoqueRows] = await Promise.all([
      mapWithConcurrency(dias, CONCURRENCY, (d) => buscar(d, d)),
      buscar(baseInicio, baseFim),
      fetchEstoqueProdutosPorFilial(produtos),
    ]);

    // ── lojas (rótulo de exibição: grupos colapsados, e-commerce numa linha só) ──
    const lojas = new Map<string, { key: string; label: string; ecommerce: boolean; matriz: boolean }>();
    const lojaDe = (rawFilial: string) => {
      const label = getFilialLabelForDisplay(company, rawFilial);
      if (!lojas.has(label)) {
        const norm = normalizeFilialLookupKey(rawFilial);
        lojas.set(label, {
          key: label,
          label,
          ecommerce: ecommerceSet.has(norm) || label === "E-COMMERCE",
          matriz: matriz.has(norm),
        });
      }
      return label;
    };

    type Acc = {
      v: number;
      q: number;
      vh: number;
      qh: number;
      vb: number;
      qb: number;
      dia: Array<{ v: number; q: number }>;
      lojas: Map<string, VendaLoja>;
      estoque: number;
      estoqueLojas: Map<string, number>;
    };
    const novo = (): Acc => ({
      v: 0, q: 0, vh: 0, qh: 0, vb: 0, qb: 0,
      dia: dias.map(() => ({ v: 0, q: 0 })),
      lojas: new Map(),
      estoque: 0,
      estoqueLojas: new Map(),
    });

    // Produto (preço vale para todas as cores) e produto × cor (detalhamento, igual à Curva ABC).
    const acc = new Map<string, Acc>();
    for (const p of produtos) acc.set(p, novo());
    const accCor = new Map<string, Map<string, { cor: string; desc: string; a: Acc }>>();
    const descCadastro = new Map<string, Map<string, string>>();
    for (const item of itens) {
      descCadastro.set(item.produto, new Map(item.coresCadastro.map((c) => [chaveCor(c.cor), c.desc])));
    }
    const corDe = (produto: string, cor: string, descVenda?: string) => {
      let m = accCor.get(produto);
      if (!m) {
        m = new Map();
        accCor.set(produto, m);
      }
      const k = chaveCor(cor);
      let c = m.get(k);
      if (!c) {
        c = { cor: cor.trim(), desc: descCadastro.get(produto)?.get(k) || (descVenda ?? "").trim() || cor.trim(), a: novo() };
        m.set(k, c);
      }
      return c.a;
    };

    const lojaAcc = (a: Acc, label: string) => {
      let l = a.lojas.get(label);
      if (!l) {
        l = { v: 0, q: 0, vh: 0, qh: 0, vb: 0, qb: 0 };
        a.lojas.set(label, l);
      }
      return l;
    };

    // Soma TODAS as linhas da função canônica (inclusive negativas) — é o que fecha
    // com o Dashboard/Gerador. Produto = soma das cores (mesma consulta, só por cor).
    const ultimo = dias.length - 1;
    porDia.forEach((rows: FilialProdutoSalesRow[], idx) => {
      for (const r of rows) {
        const ap = acc.get(r.produto);
        if (!ap) continue;
        const v = Number(r.vendas ?? 0);
        const q = Number(r.qtde ?? 0);
        const label = lojaDe(r.filial ?? "");
        for (const a of [ap, corDe(r.produto, r.cor ?? "", r.corDescricao)]) {
          a.v += v;
          a.q += q;
          a.dia[idx].v += v;
          a.dia[idx].q += q;
          const l = lojaAcc(a, label);
          l.v += v;
          l.q += q;
          if (idx === ultimo) {
            a.vh += v;
            a.qh += q;
            l.vh += v;
            l.qh += q;
          }
        }
      }
    });
    for (const r of base) {
      const ap = acc.get(r.produto);
      if (!ap) continue;
      const v = Number(r.vendas ?? 0);
      const q = Number(r.qtde ?? 0);
      const label = lojaDe(r.filial ?? "");
      for (const a of [ap, corDe(r.produto, r.cor ?? "", r.corDescricao)]) {
        a.vb += v;
        a.qb += q;
        const l = lojaAcc(a, label);
        l.vb += v;
        l.qb += q;
      }
    }
    for (const r of estoqueRows) {
      const ap = acc.get(r.produto);
      if (!ap) continue;
      if (!estoqueSet.has(normalizeFilialLookupKey(r.filial))) continue;
      const label = lojaDe(r.filial);
      for (const a of [ap, corDe(r.produto, r.cor)]) {
        a.estoque += r.estoque;
        a.estoqueLojas.set(label, (a.estoqueLojas.get(label) ?? 0) + r.estoque);
      }
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const serializar = (a: Acc) => {
      const porLoja: Record<string, VendaLoja> = {};
      for (const [label, l] of a.lojas) {
        porLoja[label] = { v: r2(l.v), q: l.q, vh: r2(l.vh), qh: l.qh, vb: r2(l.vb), qb: l.qb };
      }
      return {
        vendas: a.v,
        qtde: a.q,
        vendasHoje: a.vh,
        qtdeHoje: a.qh,
        vendasBase: a.vb,
        qtdeBase: a.qb,
        dia: a.dia.map((d) => [r2(d.v), d.q] as [number, number]),
        porLoja,
        estoque: Math.round(a.estoque),
        estoqueLojas: Object.fromEntries([...a.estoqueLojas].map(([k, n]) => [k, Math.round(n)])),
      };
    };

    const saida = itens.map((item) => {
      // Só cores que venderam ou têm estoque; cadastro sem movimento não vira linha.
      const cores = [...(accCor.get(item.produto)?.values() ?? [])]
        .map((c) => ({ cor: c.cor, corDesc: c.desc, ...serializar(c.a) }))
        .filter((c) => c.qtde !== 0 || c.vendas !== 0 || c.estoque > 0 || c.qtdeBase !== 0)
        .sort((a, b) => b.vendas - a.vendas || b.estoque - a.estoque);
      const { coresCadastro: _cadastro, ...resto } = item;
      void _cadastro;
      return { ...resto, ...serializar(acc.get(item.produto)!), cores };
    });

    // Dias decorridos (fração): de 00:00 do início até agora, relógio de Brasília.
    const [y, m, d] = inicio.split("-").map(Number);
    const diasDecorridos = Math.max((agora.pseudoUtcMs - Date.UTC(y, m - 1, d)) / 86_400_000, 1 / 24);

    return NextResponse.json(
      {
        inicio,
        hoje: agora.ymd,
        diasDecorridos,
        dias,
        base: { inicio: baseInicio, fim: baseFim, dias: DIAS_BASE },
        lojas: [...lojas.values()],
        itens: saida,
        podeExecutar: autorizacao.auth.podeExecutar,
        geradoEm: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[black-friday/painel] erro", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao montar o painel da Black Friday." },
      { status: 500 }
    );
  }
}
