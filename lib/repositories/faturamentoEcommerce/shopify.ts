import "server-only";

import sql from "mssql";
import { withRequest } from "@/lib/db/connection";
import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import type { RequestLike } from "@/lib/db/proxy";
import { consultarCep } from "@/lib/faturamento-ecommerce/cep";
import { PADROES, regiaoDaUf, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type {
  ClienteCandidato,
  ItemImportado,
  LinhaNaoMapeada,
  PedidoShopifyImport,
  PedidoShopifyResumo,
} from "@/lib/faturamento-ecommerce/types";
import { shopifyGraphql } from "@/lib/shopify/client";
import { fetchFiliaisNota } from "./clientes";
import { filiaisNotaDaEmpresa } from "./filiais-nota";

/**
 * Faturamento E-commerce — importação de pedidos do Shopify da própria empresa
 * (NERD → loja NERD, Scarf Me → loja Scarf Me). Lê o pedido ao vivo (o espelho do
 * Neon não guarda endereço nem CPF), reconhece o cliente no Linx e monta a NF com os
 * itens pelo mapeamento Shopify → Linx (shopify_variant_map; SKU/código de barras de reserva).
 * Nada aqui grava no Linx.
 */

type Req = sql.Request;

const money = (x: { shopMoney?: { amount?: string } } | null | undefined) => Number(x?.shopMoney?.amount ?? 0) || 0;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Remove caracteres invisíveis (o checkout da Scarf Me grava U+2060 no endereço). */
const limpar = (s: unknown) =>
  String(s ?? "")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const numericId = (gid: string | null | undefined) => (gid ? (/(\d+)$/.exec(gid)?.[1] ?? gid) : "");

// ── NFs já emitidas para pedidos do site ────────────────────────────────────

/** Mapa nº do pedido (sem #) → NFs não canceladas das filiais da empresa com esse nº na OBS. */
async function notasPorPedido(empresa: EmpresaFat, numeros: string[], desde: Date) {
  const mapa = new Map<string, { filial: string; nf: string }[]>();
  if (numeros.length === 0) return mapa;
  const alvo = new Set(numeros);
  const filiais = await filiaisNotaDaEmpresa(empresa);
  const rows = await withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as Req;
    filiais.forEach((f, i) => req.input(`f${i}`, sql.VarChar(25), f));
    req.input("desde", sql.DateTime, desde);
    const r = await req.query(`
      SELECT LTRIM(RTRIM(FILIAL)) AS filial, LTRIM(RTRIM(NF_SAIDA)) AS nf, CAST(OBS AS VARCHAR(500)) AS obs
        FROM FATURAMENTO WITH (NOLOCK)
       WHERE FILIAL IN (${filiais.map((_, i) => `@f${i}`).join(",")})
         AND NOTA_CANCELADA = 0 AND EMISSAO >= @desde AND OBS LIKE '%#%'`);
    return r.recordset as { filial: string; nf: string; obs: string }[];
  });
  for (const r of rows) {
    for (const m of String(r.obs ?? "").matchAll(/#\s*(\d{3,})/g)) {
      if (!alvo.has(m[1])) continue;
      const lista = mapa.get(m[1]) ?? [];
      lista.push({ filial: r.filial, nf: r.nf });
      mapa.set(m[1], lista);
    }
  }
  return mapa;
}

/**
 * Reserva para NF sem o nº do pedido na OBS (a NERD deixou vazio em parte das NFs):
 * NF não cancelada do mesmo CPF, emitida a partir do dia do pedido, com o mesmo valor total.
 */
async function notasPorClienteValor(
  empresa: EmpresaFat,
  pedidos: { numero: string; cpf: string; total: number; criadoEm: string }[]
) {
  const mapa = new Map<string, { filial: string; nf: string; provavel: true }[]>();
  const comCpf = pedidos.filter((p) => p.cpf.length === 11 || p.cpf.length === 14);
  if (comCpf.length === 0) return mapa;
  const filiais = await filiaisNotaDaEmpresa(empresa);
  const desde = new Date(Math.min(...comCpf.map((p) => new Date(p.criadoEm).getTime())) - 86_400_000);
  const rows = await withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as Req;
    filiais.forEach((f, i) => req.input(`f${i}`, sql.VarChar(25), f));
    const docs = [...new Set(comCpf.map((p) => p.cpf))];
    docs.forEach((d, i) => req.input(`d${i}`, sql.VarChar(19), d));
    req.input("desde", sql.DateTime, desde);
    const r = await req.query(`
      SELECT LTRIM(RTRIM(F.FILIAL)) AS filial, LTRIM(RTRIM(F.NF_SAIDA)) AS nf, LTRIM(RTRIM(C.CGC_CPF)) AS cpf,
             F.VALOR_TOTAL AS valor, F.EMISSAO AS emissao
        FROM FATURAMENTO F WITH (NOLOCK)
        JOIN CADASTRO_CLI_FOR C WITH (NOLOCK) ON C.NOME_CLIFOR = F.NOME_CLIFOR
       WHERE F.FILIAL IN (${filiais.map((_, i) => `@f${i}`).join(",")}) AND F.NOTA_CANCELADA = 0
         AND F.EMISSAO >= @desde AND C.CGC_CPF IN (${docs.map((_, i) => `@d${i}`).join(",")})`);
    return r.recordset as { filial: string; nf: string; cpf: string; valor: number; emissao: Date }[];
  });
  for (const p of comCpf) {
    const dia = new Date(p.criadoEm).toISOString().slice(0, 10);
    const achadas = rows.filter(
      (r) => r.cpf === p.cpf && Math.abs(Number(r.valor) - p.total) < 0.05 && new Date(r.emissao).toISOString().slice(0, 10) >= dia
    );
    if (achadas.length) mapa.set(p.numero, achadas.map((r) => ({ filial: r.filial, nf: r.nf, provavel: true as const })));
  }
  return mapa;
}

// ── Lista de pedidos ────────────────────────────────────────────────────────

interface GqlResumo {
  orders: {
    nodes: {
      name: string;
      createdAt: string;
      displayFulfillmentStatus: string | null;
      paymentGatewayNames: string[];
      currentTotalPriceSet: { shopMoney: { amount: string } };
      currentSubtotalLineItemsQuantity: number;
      shippingAddress: { name: string | null; city: string | null; provinceCode: string | null } | null;
      customer: { displayName: string | null } | null;
      localizedFields: { nodes: { key: string; value: string | null }[] };
    }[];
  };
}

export async function listarPedidosShopifyFat(
  empresa: EmpresaFat,
  params: { busca?: string; dias?: number }
): Promise<PedidoShopifyResumo[]> {
  const dias = Math.min(Math.max(Number(params.dias) || 10, 1), 90);
  const desde = new Date(Date.now() - dias * 86_400_000);
  const busca = limpar(params.busca);
  const filtros = ["financial_status:paid", "-status:cancelled"];
  if (/^#?\d{3,}$/.test(busca)) filtros.push(`name:#${busca.replace("#", "")}`);
  else {
    filtros.push(`created_at:>=${desde.toISOString().slice(0, 10)}`);
    if (busca) filtros.push(`"${busca.replace(/"/g, "")}"`);
  }
  const data = await shopifyGraphql<GqlResumo>(
    empresa,
    `query($q: String!) { orders(first: 100, sortKey: CREATED_AT, reverse: true, query: $q) { nodes {
       name createdAt displayFulfillmentStatus paymentGatewayNames
       currentTotalPriceSet { shopMoney { amount } } currentSubtotalLineItemsQuantity
       shippingAddress { name city provinceCode } customer { displayName }
       localizedFields(first: 5) { nodes { key value } }
     } } }`,
    { q: filtros.join(" ") }
  );
  const pedidos = data.orders.nodes;
  const notas = await notasPorPedido(
    empresa,
    pedidos.map((p) => p.name.replace("#", "")),
    new Date(Math.min(desde.getTime(), ...pedidos.map((p) => new Date(p.createdAt).getTime())) - 2 * 86_400_000)
  );
  const semObs = pedidos.filter((p) => !notas.has(p.name.replace("#", "")));
  const provaveis = await notasPorClienteValor(
    empresa,
    semObs.map((p) => ({
      numero: p.name.replace("#", ""),
      cpf: (p.localizedFields?.nodes.find((f) => f.key === "TAX_CREDENTIAL_BR")?.value ?? "").replace(/\D/g, ""),
      total: money(p.currentTotalPriceSet),
      criadoEm: p.createdAt,
    }))
  );
  return pedidos.map((p) => ({
    nome: p.name,
    criadoEm: p.createdAt,
    cliente: limpar(p.shippingAddress?.name || p.customer?.displayName),
    cidade: limpar(p.shippingAddress?.city),
    uf: limpar(p.shippingAddress?.provinceCode),
    total: money(p.currentTotalPriceSet),
    pecas: Number(p.currentSubtotalLineItemsQuantity) || 0,
    pagamento: (p.paymentGatewayNames ?? []).join(", "),
    fulfillment: p.displayFulfillmentStatus ?? "",
    notas: notas.get(p.name.replace("#", "")) ?? provaveis.get(p.name.replace("#", "")) ?? [],
  }));
}

// ── Importação de um pedido ─────────────────────────────────────────────────

interface GqlAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  zip: string | null;
  phone: string | null;
}

interface GqlPedido {
  orders: {
    nodes: {
      name: string;
      createdAt: string;
      email: string | null;
      phone: string | null;
      paymentGatewayNames: string[];
      customAttributes: { key: string; value: string | null }[];
      localizedFields: { nodes: { key: string; value: string | null }[] };
      customer: { displayName: string | null; email: string | null; phone: string | null } | null;
      shippingAddress: GqlAddress | null;
      billingAddress: GqlAddress | null;
      currentSubtotalPriceSet: { shopMoney: { amount: string } };
      currentTotalPriceSet: { shopMoney: { amount: string } };
      shippingLines: { nodes: { discountedPriceSet: { shopMoney: { amount: string } } }[] };
      lineItems: {
        nodes: {
          title: string;
          variantTitle: string | null;
          sku: string | null;
          currentQuantity: number;
          variant: { id: string; barcode: string | null; sku: string | null } | null;
          originalUnitPriceSet: { shopMoney: { amount: string } };
          discountAllocations: { allocatedAmountSet: { shopMoney: { amount: string } } }[];
        }[];
      };
    }[];
  };
}

/** "Rua X, 604" → { rua, numero }. */
function separarNumero(linha: string): { rua: string; numero: string } {
  const s = limpar(linha);
  const virgula = s.lastIndexOf(",");
  if (virgula > 0) {
    const depois = s.slice(virgula + 1).trim();
    if (/\d|s\/?n/i.test(depois) && depois.length <= 15) return { rua: s.slice(0, virgula).trim(), numero: depois };
  }
  const m = /^(.*?)[\s,]+(\d+[A-Za-z]?)$/.exec(s);
  if (m) return { rua: m[1], numero: m[2] };
  return { rua: s, numero: "S/N" };
}

export async function importarPedidoShopifyFat(
  empresa: EmpresaFat,
  nome: string,
  filialNota?: string
): Promise<PedidoShopifyImport> {
  const numero = limpar(nome).replace(/\D/g, "");
  if (!numero) throw new Error("Informe o nº do pedido (ex.: #1711).");
  const data = await shopifyGraphql<GqlPedido>(
    empresa,
    `query($q: String!) { orders(first: 1, query: $q) { nodes {
       name createdAt email phone paymentGatewayNames
       customAttributes { key value }
       localizedFields(first: 10) { nodes { key value } }
       customer { displayName email phone }
       shippingAddress { name address1 address2 city provinceCode zip phone }
       billingAddress { name address1 address2 city provinceCode zip phone }
       currentSubtotalPriceSet { shopMoney { amount } }
       currentTotalPriceSet { shopMoney { amount } }
       shippingLines(first: 5) { nodes { discountedPriceSet { shopMoney { amount } } } }
       lineItems(first: 100) { nodes {
         title variantTitle sku currentQuantity
         variant { id barcode sku }
         originalUnitPriceSet { shopMoney { amount } }
         discountAllocations { allocatedAmountSet { shopMoney { amount } } }
       } }
     } } }`,
    { q: `name:#${numero}` }
  );
  const o = data.orders.nodes.find((x) => x.name.replace("#", "") === numero);
  if (!o) throw new Error(`Pedido #${numero} não encontrado na loja ${PADROES[empresa].nome} do Shopify.`);

  // ── Cliente ──
  const end = o.shippingAddress ?? o.billingAddress;
  const cpf = (
    o.localizedFields.nodes.find((f) => f.key === "TAX_CREDENTIAL_BR")?.value ??
    o.customAttributes.find((a) => a.key === "payment_additional_taxid")?.value ??
    ""
  ).replace(/\D/g, "");
  const nomeCliente = limpar(end?.name || o.customer?.displayName).toUpperCase();
  const { rua, numero: numeroEnd } = separarNumero(end?.address1 ?? "");
  const cepInfo = await consultarCep(end?.zip ?? "");
  const partes2 = limpar(end?.address2)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const bairro = limpar(cepInfo?.bairro) || partes2[partes2.length - 1] || "";
  const complemento = partes2.filter((p) => semAcento(p) !== semAcento(bairro)).join(", ");
  let fone = (end?.phone || o.phone || o.customer?.phone || "").replace(/\D/g, "");
  if (fone.length >= 12 && fone.startsWith("55")) fone = fone.slice(2);
  const uf = (cepInfo?.uf || limpar(end?.provinceCode)).toUpperCase();

  const cliente: PedidoShopifyImport["cliente"] = {
    razaoSocial: nomeCliente,
    cpfCnpj: cpf,
    email: limpar(o.email || o.customer?.email).toUpperCase(),
    ddd: fone.slice(0, 2),
    telefone: fone.slice(2),
    endereco: {
      cep: (end?.zip ?? "").replace(/\D/g, ""),
      endereco: (rua || cepInfo?.endereco || "").toUpperCase(),
      numero: numeroEnd.toUpperCase(),
      complemento: complemento.toUpperCase(),
      bairro: bairro.toUpperCase(),
      cidade: (cepInfo?.cidade || limpar(end?.city)).toUpperCase(),
      uf,
      codMunicipioIbge: cepInfo?.codMunicipioIbge ?? "",
    },
    regiao: regiaoDaUf(uf),
    telefoneOriginal: limpar(end?.phone),
    enderecoOriginal: [end?.address1, end?.address2, end?.city, end?.provinceCode, end?.zip].map(limpar).filter(Boolean).join(" · "),
  };

  // ── Clientes parecidos no Linx ──
  // Mesmo CPF primeiro; entre eles, o cadastro da própria empresa.
  const filialCliente = PADROES[empresa].cliente.filial;
  const candidatos = (await reconhecerCliente(cpf, nomeCliente, cliente.endereco.cep, cliente.endereco.numero)).sort(
    (a, b) => Number(b.forte) - Number(a.forte) || Number(b.filial === filialCliente) - Number(a.filial === filialCliente)
  );

  // ── Itens ──
  // Sem filial informada (ou de outra empresa): a principal do rodízio, não a 1ª da lista.
  const filiais = await filiaisNotaDaEmpresa(empresa);
  const filialEstoque = filialNota && filiais.includes(filialNota) ? filialNota : (await fetchFiliaisNota(empresa)).padrao;
  const { itens, naoMapeados } = await mapearItens(empresa, o.lineItems.nodes, filialEstoque);
  const descontoItens = round2(itens.reduce((s, i) => s + (i as ItemImportado & { _desc: number })._desc, 0));
  for (const i of itens) delete (i as Partial<ItemImportado & { _desc: number }>)._desc;

  const notas =
    (await notasPorPedido(empresa, [numero], new Date(new Date(o.createdAt).getTime() - 2 * 86_400_000))).get(numero) ??
    (await notasPorClienteValor(empresa, [{ numero, cpf, total: money(o.currentTotalPriceSet), criadoEm: o.createdAt }])).get(numero) ??
    [];

  return {
    nome: o.name,
    criadoEm: o.createdAt,
    pagamento: (o.paymentGatewayNames ?? []).join(", "),
    cliente,
    candidatos,
    itens,
    naoMapeados,
    subtotalShopify: money(o.currentSubtotalPriceSet),
    descontoItens,
    frete: round2(o.shippingLines.nodes.reduce((s, l) => s + money(l.discountedPriceSet), 0)),
    totalShopify: money(o.currentTotalPriceSet),
    notas,
  };
}

/** Mesmo CPF (forte) e nome parecido (todos os cadastros, qualquer empresa). */
async function reconhecerCliente(cpf: string, nome: string, cep: string, numero: string): Promise<ClienteCandidato[]> {
  const palavras = semAcento(nome)
    .split(" ")
    .filter((p) => p.length >= 3 && !["DE", "DA", "DO", "DOS", "DAS"].includes(p));
  const padraoNome = palavras.length >= 2 ? `%${palavras[0]}%${palavras[palavras.length - 1]}%` : palavras[0] ? `%${palavras[0]}%` : "";
  const rows = await withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as Req;
    req.input("doc", sql.VarChar(19), cpf || "-");
    req.input("nome", sql.VarChar(100), padraoNome || "-");
    const r = await req.query(`
      SELECT TOP 15
        LTRIM(RTRIM(cf.CLIFOR)) AS codigo, RTRIM(cf.NOME_CLIFOR) AS nome, LTRIM(RTRIM(cf.RAZAO_SOCIAL)) AS razao,
        LTRIM(RTRIM(cf.CGC_CPF)) AS cpf, LTRIM(RTRIM(cf.CEP)) AS cep, LTRIM(RTRIM(cf.NUMERO)) AS numero,
        LTRIM(RTRIM(cf.CIDADE)) AS cidade, LTRIM(RTRIM(cf.UF)) AS uf, LTRIM(RTRIM(ISNULL(ca.FILIAL,''))) AS filial,
        CASE WHEN cf.CGC_CPF = @doc THEN 1 ELSE 0 END AS mesmoCpf
      FROM CADASTRO_CLI_FOR cf WITH (NOLOCK)
      JOIN CLIENTES_ATACADO ca WITH (NOLOCK) ON ca.CLIENTE_ATACADO = cf.NOME_CLIFOR
      WHERE cf.CGC_CPF = @doc
         ${padraoNome ? "OR cf.RAZAO_SOCIAL COLLATE Latin1_General_CI_AI LIKE @nome" : ""}
      ORDER BY CASE WHEN cf.CGC_CPF = @doc THEN 0 ELSE 1 END, cf.CADASTRAMENTO DESC`);
    return r.recordset as Record<string, unknown>[];
  });
  const cepDigits = cep.replace(/\D/g, "");
  const numNorm = numero.replace(/\D/g, "");
  return rows.map((r) => {
      const mesmoCpf = Number(r.mesmoCpf) === 1;
      const mesmoCep = String(r.cep ?? "").replace(/\D/g, "") === cepDigits && cepDigits.length === 8;
      const enderecoDifere = !mesmoCep || String(r.numero ?? "").replace(/\D/g, "") !== numNorm;
      return {
        codigo: String(r.codigo),
        nomeClifor: String(r.nome ?? ""),
        razaoSocial: String(r.razao ?? ""),
        cpfCnpj: String(r.cpf ?? ""),
        cep: String(r.cep ?? ""),
        numero: String(r.numero ?? ""),
        cidade: String(r.cidade ?? ""),
        uf: String(r.uf ?? ""),
        filial: String(r.filial ?? ""),
        motivo: mesmoCpf ? (mesmoCep ? "mesmo CPF e CEP" : "mesmo CPF") : mesmoCep ? "nome parecido e mesmo CEP" : "nome parecido",
        forte: mesmoCpf,
        enderecoDifere,
      };
    });
}

type LinhaShopify = GqlPedido["orders"]["nodes"][number]["lineItems"]["nodes"][number];

/**
 * Shopify → Linx: 1º o mapeamento da página Shopify (shopify_variant_map, vinculado ou
 * sugerido), depois o SKU e o código de barras em PRODUTOS_BARRA (o Linx fatura pelo SKU).
 */
const PRECO_BRINDE = 0.01; // o Linx fatura brinde a R$ 0,01 (sacola, lenço de presente)

async function mapearItens(empresa: EmpresaFat, linhas: LinhaShopify[], filial: string) {
  const ativas = linhas.filter((l) => Number(l.currentQuantity) > 0);
  const variantIds = ativas.map((l) => numericId(l.variant?.id)).filter(Boolean);

  const mapa = new Map<string, { status: string; produto: string; cor: string; tamanho: number | null }>();
  /** Lotes anteriores da mesma peça (reposição/coleção nova ganha código novo no Linx). */
  const extras = new Map<string, { produto: string; cor: string }[]>();
  if (variantIds.length > 0 && hasPostgres()) {
    try {
      const neon = getNeonSql();
      const rows = (await neon.query(
        `SELECT variant_id, status, produto, cor_produto, tamanho FROM shopify_variant_map
          WHERE company = $1 AND variant_id = ANY($2) AND status IN ('vinculado','sugerido') AND produto IS NOT NULL`,
        [empresa, variantIds]
      )) as { variant_id: string; status: string; produto: string; cor_produto: string | null; tamanho: number | null }[];
      for (const r of rows) mapa.set(r.variant_id, { status: r.status, produto: r.produto, cor: r.cor_produto ?? "", tamanho: r.tamanho });
      const ex = (await neon.query(
        `SELECT variant_id, produto, cor_produto FROM shopify_variant_linx_extra WHERE company = $1 AND variant_id = ANY($2)`,
        [empresa, variantIds]
      )) as { variant_id: string; produto: string; cor_produto: string }[];
      for (const r of ex) extras.set(r.variant_id, [...(extras.get(r.variant_id) ?? []), { produto: r.produto, cor: r.cor_produto }]);
    } catch (err) {
      console.error("[faturamento-ecommerce/shopify] mapeamento indisponível, usando SKU", err);
    }
  }

  // Códigos de barras (SKU e barcode) → produto/cor/tamanho no Linx
  const codigos = [...new Set(ativas.flatMap((l) => [l.sku, l.variant?.sku, l.variant?.barcode].map((c) => limpar(c)).filter(Boolean)))];
  const barras = new Map<string, { produto: string; cor: string; tamanho: number }>();
  if (codigos.length > 0) {
    const rows = await withRequest(async (request: sql.Request | RequestLike) => {
      const req = request as Req;
      codigos.forEach((c, i) => req.input(`b${i}`, sql.VarChar(25), c));
      const r = await req.query(`
        SELECT LTRIM(RTRIM(CODIGO_BARRA)) AS cb, LTRIM(RTRIM(PRODUTO)) AS produto, LTRIM(RTRIM(COR_PRODUTO)) AS cor, ISNULL(TAMANHO,1) AS tam
          FROM PRODUTOS_BARRA WITH (NOLOCK) WHERE CODIGO_BARRA IN (${codigos.map((_, i) => `@b${i}`).join(",")})`);
      return r.recordset as { cb: string; produto: string; cor: string; tam: number }[];
    });
    for (const r of rows) if (!barras.has(r.cb)) barras.set(r.cb, { produto: r.produto, cor: r.cor, tamanho: Number(r.tam) || 1 });
  }

  type Parcial = { produto: string; cor: string; tamanho: number | null; origem: string; conferir: boolean };
  const resolvidos: { linha: LinhaShopify; alvo: Parcial; alternativas: Parcial[] }[] = [];
  const naoMapeados: LinhaNaoMapeada[] = [];
  for (const l of ativas) {
    const qtde = Number(l.currentQuantity) || 0;
    const desconto = round2(l.discountAllocations.reduce((s, d) => s + money(d.allocatedAmountSet), 0));
    const preco = money(l.originalUnitPriceSet);
    const m = mapa.get(numericId(l.variant?.id));
    let alvo: Parcial | null = null;
    if (m) alvo = { produto: m.produto, cor: m.cor, tamanho: m.tamanho, origem: `mapeamento (${m.status})`, conferir: m.status !== "vinculado" };
    else {
      for (const [cod, origem] of [
        [limpar(l.sku), "SKU"],
        [limpar(l.variant?.barcode), "código de barras"],
      ] as const) {
        const b = cod ? barras.get(cod) : undefined;
        if (b) {
          alvo = { ...b, origem, conferir: false };
          break;
        }
      }
    }
    if (!alvo) {
      naoMapeados.push({
        titulo: [l.title, l.variantTitle].filter(Boolean).join(" — "),
        sku: limpar(l.sku) || null,
        qtde,
        preco,
        desconto,
        motivo: l.variant ? "variante sem vínculo com o Linx (mapear na página Shopify)" : "item sem variante (ex.: embrulho/serviço)",
      });
      continue;
    }
    if (alvo.tamanho === null) {
      // Mapeamento sem tamanho: usa o do código de barras do mesmo produto/cor, senão o 1º da grade.
      const b = [limpar(l.sku), limpar(l.variant?.barcode)].map((c) => barras.get(c)).find((x) => x && x.produto === alvo!.produto && x.cor === alvo!.cor);
      alvo.tamanho = b?.tamanho ?? 1;
    }
    const alternativas = (extras.get(numericId(l.variant?.id)) ?? [])
      .filter((x) => x.cor && !(x.produto === alvo!.produto && x.cor === alvo!.cor))
      .map((x) => ({ produto: x.produto, cor: x.cor, tamanho: alvo!.tamanho, origem: "lote anterior com estoque", conferir: true }));
    resolvidos.push({ linha: l, alvo, alternativas });
  }

  // Descrição, grade, estoque (filial emissora) e preço da tabela 01 no Linx
  const info = new Map<
    string,
    { descricao: string; descCor: string; tamLabel: string; estoque: number | null; existe: boolean; precoLinx: number | null }
  >();
  if (resolvidos.length > 0) {
    const todos = resolvidos.flatMap((r) => [r.alvo, ...r.alternativas]);
    const chaves = [...new Map(todos.map((a) => [`${a.produto}|${a.cor}|${a.tamanho}`, a])).values()];
    const rows = await withRequest(async (request: sql.Request | RequestLike) => {
      const req = request as Req;
      req.input("filial", sql.VarChar(25), filial);
      const values = chaves.map((c, i) => {
        req.input(`p${i}`, sql.VarChar(12), c.produto);
        req.input(`c${i}`, sql.VarChar(10), c.cor);
        req.input(`t${i}`, sql.Int, c.tamanho ?? 1);
        return `(@p${i}, @c${i}, @t${i})`;
      });
      const r = await req.query(`
        SELECT V.produto, V.cor, V.tam, LTRIM(RTRIM(P.DESC_PRODUTO)) AS descricao, LTRIM(RTRIM(PC.DESC_COR_PRODUTO)) AS descCor,
               CASE V.tam ${Array.from({ length: 48 }, (_, i) => `WHEN ${i + 1} THEN G.TAMANHO_${i + 1}`).join(" ")} END AS tamLabel,
               CASE V.tam ${Array.from({ length: 48 }, (_, i) => `WHEN ${i + 1} THEN E.ES${i + 1}`).join(" ")} END AS estoque,
               CASE WHEN P.PRODUTO IS NULL OR PC.COR_PRODUTO IS NULL THEN 0 ELSE 1 END AS existe,
               (SELECT TOP 1 PP.PRECO1 FROM PRODUTOS_PRECOS PP WITH (NOLOCK)
                 WHERE PP.PRODUTO = V.produto AND PP.CODIGO_TAB_PRECO = '01') AS precoLinx
          FROM (VALUES ${values.join(",")}) V(produto, cor, tam)
          LEFT JOIN PRODUTOS P WITH (NOLOCK) ON P.PRODUTO = V.produto
          LEFT JOIN PRODUTO_CORES PC WITH (NOLOCK) ON PC.PRODUTO = V.produto AND PC.COR_PRODUTO = V.cor
          LEFT JOIN PRODUTOS_TAMANHOS G WITH (NOLOCK) ON G.GRADE = P.GRADE
          LEFT JOIN ESTOQUE_PRODUTOS E WITH (NOLOCK) ON E.FILIAL = @filial AND E.PRODUTO = V.produto AND E.COR_PRODUTO = V.cor`);
      return r.recordset as Record<string, unknown>[];
    });
    for (const r of rows) {
      info.set(`${r.produto}|${r.cor}|${r.tam}`, {
        descricao: String(r.descricao ?? ""),
        descCor: String(r.descCor ?? ""),
        tamLabel: String(r.tamLabel ?? "").trim(),
        estoque: r.estoque === null || r.estoque === undefined ? null : Number(r.estoque),
        existe: Number(r.existe) === 1,
        precoLinx: r.precoLinx === null || r.precoLinx === undefined ? null : Number(r.precoLinx),
      });
    }
  }

  // Junta linhas iguais (mesmo produto/cor/tamanho/preço)
  const itens: (ItemImportado & { _desc: number })[] = [];
  for (const r of resolvidos) {
    const qtde = Number(r.linha.currentQuantity) || 0;
    const chave = (a: Parcial) => `${a.produto}|${a.cor}|${a.tamanho}`;
    // Código principal sem estoque e lote anterior com estoque → fatura o lote anterior (como o operador faz).
    let alvo = r.alvo;
    const estPrincipal = info.get(chave(alvo))?.estoque ?? null;
    if ((estPrincipal === null || estPrincipal < qtde) && r.alternativas.length > 0) {
      const comEstoque = r.alternativas.find((a) => {
        const i = info.get(chave(a));
        return i?.existe && (i.estoque ?? 0) >= qtde;
      });
      if (comEstoque) alvo = comEstoque;
    }
    const linha = r.linha;
    const k = chave(alvo);
    const inf = info.get(k);
    let preco = money(linha.originalUnitPriceSet);
    const desc = round2(linha.discountAllocations.reduce((s, d) => s + money(d.allocatedAmountSet), 0));
    // Embalagem de presente não sai na NF; brinde (preço zero) sai a R$ 0,01, como no Linx.
    if (preco <= 0 && /^EMBALAGEM/i.test(inf?.descricao ?? "")) {
      naoMapeados.push({
        titulo: [linha.title, linha.variantTitle].filter(Boolean).join(" — "),
        sku: limpar(linha.sku) || null,
        qtde,
        preco,
        desconto: desc,
        motivo: "embalagem de presente — não vai na NF",
      });
      continue;
    }
    const brinde = preco <= 0;
    if (brinde) preco = PRECO_BRINDE;
    if (!inf?.existe) {
      naoMapeados.push({
        titulo: [linha.title, linha.variantTitle].filter(Boolean).join(" — "),
        sku: limpar(linha.sku) || null,
        qtde,
        preco,
        desconto: desc,
        motivo: `vinculado a ${alvo.produto} ${alvo.cor}, que não existe no Linx`,
      });
      continue;
    }
    const igual = itens.find((i) => `${i.produto}|${i.cor}|${i.tamanho}` === k && i.preco === preco);
    if (igual) {
      igual.qtde += qtde;
      igual._desc = round2(igual._desc + desc);
      continue;
    }
    itens.push({
      produto: alvo.produto,
      cor: alvo.cor,
      tamanho: alvo.tamanho ?? 1,
      qtde,
      preco,
      descricao: inf.descricao,
      descCor: inf.descCor,
      tamanhoLabel: inf.tamLabel,
      estoque: inf.estoque,
      origem: brinde ? `${alvo.origem} · brinde a R$ 0,01` : alvo.origem,
      conferir: alvo.conferir,
      tituloShopify: [linha.title, linha.variantTitle].filter(Boolean).join(" — "),
      precoLinx: inf.precoLinx,
      brinde,
      _desc: desc,
    });
  }
  return { itens, naoMapeados };
}
