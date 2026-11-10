import "server-only";

import { query } from "@/lib/db/connection";
import type { ShopifyCompany } from "@/lib/shopify/config";
import {
  listAllShopifyVariants,
  listVariantMaps,
  saveVariantMaps,
  type MapaComponente,
  type ShopifyVariantMapRow,
  type ShopifyVariantRow,
} from "@/lib/shopify/catalog-store";

/**
 * Motor de vínculo variante Shopify → Linx (produto × cor × tamanho).
 *
 * Regras, na ordem (medidas em 10/11/2026 sobre o catálogo real):
 *   1. código de barras exato — barcode ou SKU = PRODUTOS_BARRA.CODIGO_BARRA (interno de 6
 *      dígitos ou EAN). Já traz produto, cor e tamanho. Scarf Me ≈ 52% das variantes.
 *      SKU com vários códigos separados por "/" = KIT (cada código vira um componente).
 *   2. produto + cor no SKU — "70.60.64-99" ou colado "13.23.011406" (produto 13.23.0114, cor 06).
 *   3. código de produto — SKU = PRODUTOS.PRODUTO; a cor sai da opção "Cor" da variante
 *      (pela descrição da cor) ou é a única cor do produto. Sem cor → sugerido.
 *   4. irmã — a variante "personalizar = Sim" (sem código) copia a "Não" do mesmo produto
 *      com as mesmas outras opções.
 *   5. nome — título + opções contra DESC_PRODUTO (índice de palavras). Só SUGERE: precisa
 *      de confirmação na tela. Cobre as capas ("Capa … Abaporu" + "iPhone 16 Pro Max" →
 *      "CP ABAPORU IP 16 PRO MAX") e o catálogo NERD, quase todo sem SKU.
 *   + vale-presente / cartão-presente → nao_linx (não é produto do Linx).
 *
 * Nunca toca em vínculo manual (origem = 'manual').
 */

interface LinxProduto {
  PRODUTO: string;
  DESC_PRODUTO: string;
  INATIVO: number | null;
}
interface LinxCor {
  PRODUTO: string;
  COR_PRODUTO: string;
  DESC_COR: string;
}
interface LinxBarra {
  CODIGO_BARRA: string;
  PRODUTO: string;
  COR_PRODUTO: string;
  TAMANHO: number | null;
  GRADE: string | null;
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const numKey = (s: string) => (/^\d+$/.test(s) ? String(Number(s)) : s);
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
const esc = (s: string) => s.replace(/'/g, "''");

const STOP = new Set(["DE", "DA", "DO", "DAS", "DOS", "EM", "E", "COM", "PARA", "A", "O", "AS", "OS", "NO", "NA", "X", "CM", "UN"]);
/** Abreviações que o cadastro do Linx usa e o Shopify escreve por extenso. */
const SYN: Record<string, string> = { IPHONE: "IP", CAPA: "CP", SAMSUNG: "SG", GALAXY: "SG", GALAXI: "SG", UTRA: "ULTRA", ALCAS: "ALCA", ECHARPE: "ECH", POLIESTER: "POLI" };
/** Complementos de modelo de celular: têm de ser IGUAIS dos dois lados (16 ≠ 16 Pro ≠ 16 Pro Max). */
const QUALIFICADORES = new Set(["PRO", "MAX", "PLUS", "AIR", "ULTRA", "MINI", "FE", "LITE"]);
/** Tipo de acessório de celular: se o título começa assim, o nome do Linx também precisa ter
 *  (senão "Alça/Capa Estampada Abaporu" casava com o LENÇO Abaporu). */
const TIPOS_OBRIGATORIOS = new Set(["CP", "ALCA", "PELICULA", "CABO", "CARREGADOR", "SUPORTE", "FONE"]);
const tokens = (s: string) =>
  norm(s)
    // "PROMAX" colado no cadastro do Linx (CP A NEGRA IP 16 PROMAX)
    .replace(/PROMAX/g, "PRO MAX")
    .split(" ")
    .map((t) => SYN[t] ?? t)
    .filter((t) => t.length > 0 && !STOP.has(t));

/** Nomes de cor "simples" — só eles podem descartar candidato por cor diferente. */
const CORES = new Set([
  "AZUL", "BRANCO", "BRANCA", "PRETO", "PRETA", "VERDE", "ROSA", "ROSE", "AMARELO", "AMARELA",
  "VERMELHO", "VERMELHA", "MARROM", "CINZA", "LARANJA", "ROXO", "ROXA", "LILAS", "BEGE",
  "BORDEAUX", "BORDO", "VINHO", "CARAMELO", "TERRACOTA", "OFF", "WHITE", "NUDE", "DOURADO",
  "DOURADA", "PRATA", "PINK", "MARINHO", "CORAL", "MOSTARDA", "TERRA", "CREME",
]);
/**
 * Palavras de cor de um texto ("Azul/Amarelo" → {AZUL, AMARELO}). `estrito`: devolve vazio
 * se houver qualquer palavra que não é cor (ex. "MULTICOLOR", "ESTAMPADO") — aí a cor do
 * Linx não serve para descartar, só para desempatar.
 */
function coresBasicas(texto: string | null | undefined, estrito = false): Set<string> {
  const ts = norm(texto).split(" ").filter(Boolean);
  if (estrito && ts.some((t) => !CORES.has(t))) return new Set();
  return new Set(ts.filter((t) => CORES.has(t)));
}

const isPersonalizacao = (name: string) => /personaliz/i.test(name);
const isGiftCard = (title: string) => /(cart[aã]o|vale)[ -]?presente|gift ?card/i.test(title);

class LinxIndex {
  produtos = new Map<string, LinxProduto>();
  cores = new Map<string, LinxCor[]>();
  barras = new Map<string, LinxBarra>();
  barrasPorProdutoCor = new Map<string, LinxBarra[]>();
  tokenIndex = new Map<string, string[]>();
  /** Soma do peso (IDF) das palavras do nome de cada produto do Linx. */
  tokenWeight = new Map<string, number>();
  idf = new Map<string, number>();
  tokensDe = new Map<string, Set<string>>();

  static async load(codes: string[]): Promise<LinxIndex> {
    const idx = new LinxIndex();
    const [produtos, cores] = await Promise.all([
      query<LinxProduto>(
        `SELECT LTRIM(RTRIM(PRODUTO)) AS PRODUTO, LTRIM(RTRIM(ISNULL(DESC_PRODUTO,''))) AS DESC_PRODUTO, INATIVO FROM PRODUTOS`,
      ),
      query<LinxCor>(
        `SELECT LTRIM(RTRIM(PRODUTO)) AS PRODUTO, LTRIM(RTRIM(COR_PRODUTO)) AS COR_PRODUTO,
                LTRIM(RTRIM(ISNULL(DESC_COR_PRODUTO,''))) AS DESC_COR FROM PRODUTO_CORES`,
      ),
    ]);
    for (const p of produtos) idx.produtos.set(up(p.PRODUTO), p);
    for (const c of cores) {
      const k = up(c.PRODUTO);
      const list = idx.cores.get(k);
      if (list) list.push(c);
      else idx.cores.set(k, [c]);
    }
    // Códigos de barra: só os que aparecem no Shopify (evita trazer ~94 mil linhas).
    // Coluna sem LTRIM no WHERE: o SQL Server ignora espaço à direita na igualdade e
    // assim o índice continua valendo.
    const unique = [...new Set(codes.map(up).filter(Boolean))];
    for (let i = 0; i < unique.length; i += 900) {
      const list = unique.slice(i, i + 900).map((c) => `'${esc(c)}'`).join(",");
      const rows = await query<LinxBarra>(
        `SELECT LTRIM(RTRIM(CODIGO_BARRA)) AS CODIGO_BARRA, LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
                LTRIM(RTRIM(COR_PRODUTO)) AS COR_PRODUTO, TAMANHO, LTRIM(RTRIM(ISNULL(GRADE,''))) AS GRADE
           FROM PRODUTOS_BARRA WHERE CODIGO_BARRA IN (${list})`,
      );
      for (const b of rows) idx.barras.set(up(b.CODIGO_BARRA), b);
    }
    // Índice de palavras do nome (só ativos, para sugestão por nome).
    // Peso por raridade (IDF): o nome da estampa ("A NEGRA") decide; "CP", "IP", "PRO" quase não.
    const ativos = produtos.filter((p) => !p.INATIVO);
    const tokensDe = idx.tokensDe;
    for (const p of ativos) {
      const ts = new Set(tokens(p.DESC_PRODUTO));
      tokensDe.set(up(p.PRODUTO), ts);
      for (const t of ts) {
        const list = idx.tokenIndex.get(t);
        if (list) list.push(up(p.PRODUTO));
        else idx.tokenIndex.set(t, [up(p.PRODUTO)]);
      }
    }
    const n = Math.max(1, ativos.length);
    for (const [t, list] of idx.tokenIndex) idx.idf.set(t, Math.log(n / list.length));
    for (const [p, ts] of tokensDe) {
      let w = 0;
      for (const t of ts) w += idx.idf.get(t) ?? 0;
      idx.tokenWeight.set(p, w);
    }
    return idx;
  }

  /** Barras (todos os tamanhos) de produtos×cor — para descobrir o tamanho. */
  async loadBarrasDosProdutos(produtos: string[]) {
    const unique = [...new Set(produtos.map(up))].filter((p) => !this.barrasPorProdutoCor.has(`${p}|*`));
    for (let i = 0; i < unique.length; i += 500) {
      const list = unique.slice(i, i + 500).map((c) => `'${esc(c)}'`).join(",");
      const rows = await query<LinxBarra>(
        `SELECT LTRIM(RTRIM(CODIGO_BARRA)) AS CODIGO_BARRA, LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
                LTRIM(RTRIM(COR_PRODUTO)) AS COR_PRODUTO, TAMANHO, LTRIM(RTRIM(ISNULL(GRADE,''))) AS GRADE
           FROM PRODUTOS_BARRA WHERE PRODUTO IN (${list})`,
      );
      for (const b of rows) {
        const k = `${up(b.PRODUTO)}|${numKey(up(b.COR_PRODUTO))}`;
        const l = this.barrasPorProdutoCor.get(k);
        if (l) {
          if (!l.some((x) => x.TAMANHO === b.TAMANHO)) l.push(b);
        } else this.barrasPorProdutoCor.set(k, [b]);
      }
      for (const p of unique.slice(i, i + 500)) this.barrasPorProdutoCor.set(`${p}|*`, []);
    }
  }

  findCor(produto: string, cor: string) {
    return (this.cores.get(up(produto)) ?? []).find((c) => numKey(up(c.COR_PRODUTO)) === numKey(up(cor)));
  }

  /** Cor pelo texto da opção ("Vermelho") contra DESC_COR_PRODUTO do produto. */
  corPorDescricao(produto: string, valor: string | null) {
    const cores = this.cores.get(up(produto)) ?? [];
    if (cores.length === 1) return cores[0];
    if (!valor) return null;
    const v = norm(valor);
    const exato = cores.filter((c) => norm(c.DESC_COR) === v);
    if (exato.length === 1) return exato[0];
    const contem = cores.filter((c) => norm(c.DESC_COR).includes(v) || v.includes(norm(c.DESC_COR)));
    return contem.length === 1 ? contem[0] : null;
  }

  /** Tamanho: único da cor, ou o rótulo da grade (PRODUTOS_BARRA.GRADE) = opção "Tamanho". */
  tamanho(produto: string, cor: string | null, valorTamanho: string | null): number | null {
    if (cor == null) return null;
    const list = this.barrasPorProdutoCor.get(`${up(produto)}|${numKey(up(cor))}`) ?? [];
    if (list.length === 1) return list[0].TAMANHO ?? null;
    if (!valorTamanho) return null;
    const v = norm(valorTamanho);
    const hit = list.filter((b) => norm(b.GRADE) === v);
    return hit.length === 1 ? hit[0].TAMANHO ?? null : null;
  }

  matchCode(code: string | null): { produto: string; cor: string | null; tamanho: number | null; metodo: string } | null {
    const c = up(code);
    if (!c) return null;
    const b = this.barras.get(c);
    if (b) return { produto: b.PRODUTO, cor: b.COR_PRODUTO, tamanho: b.TAMANHO ?? null, metodo: "código de barras" };
    const p = this.produtos.get(c);
    if (p) return { produto: p.PRODUTO, cor: null, tamanho: null, metodo: "código do produto" };
    const dash = c.lastIndexOf("-");
    if (dash > 0) {
      const prod = c.slice(0, dash);
      const cor = this.produtos.has(prod) ? this.findCor(prod, c.slice(dash + 1)) : undefined;
      if (cor) return { produto: this.produtos.get(prod)!.PRODUTO, cor: cor.COR_PRODUTO, tamanho: null, metodo: "produto-cor no SKU" };
    }
    for (let i = c.length - 1; i >= 4; i -= 1) {
      const prod = c.slice(0, i);
      if (!this.produtos.has(prod)) continue;
      const cor = this.findCor(prod, c.slice(i));
      if (cor) return { produto: this.produtos.get(prod)!.PRODUTO, cor: cor.COR_PRODUTO, tamanho: null, metodo: "produto+cor no SKU" };
    }
    return null;
  }

  /**
   * Melhor candidato por nome, ponderado pela raridade das palavras (IDF):
   *   score = 0,7 × (peso casado / peso do nome Linx) + 0,3 × (peso casado / peso do texto Shopify)
   * Travas (medidas nas capas da NERD, 10/11/2026):
   *   - casar ≥ 60% do peso do TÍTULO (o nome da estampa/produto), não só das opções;
   *   - toda palavra com número nas opções (modelo: "S24", "16", "17") tem de estar no nome
   *     do Linx — senão a capa Samsung de uma estampa que só existe para iPhone virava
   *     "CP SPACE SG S24" ou a capa iPhone 15. Sem candidato que passe = pendente (certo:
   *     o produto não existe no Linx).
   */
  matchNome(
    titulo: string,
    opcoes: string,
    padraoDaLoja: Set<string> = new Set(),
    corOpcao: string | null = null,
  ): { produto: string; score: number; margem: number } | null {
    // Palavras de vitrine que a loja repete em dezenas de títulos ("anti-impacto
    // personalizada", "estampada") não identificam o produto: fora da conta do título.
    const tTit = [...new Set(tokens(titulo))].filter((t) => this.idf.has(t) && !padraoDaLoja.has(t));
    const tOpc = [...new Set(tokens(opcoes))].filter((t) => this.idf.has(t) && !tTit.includes(t));
    if (tTit.length === 0) return null;
    const w = (t: string) => this.idf.get(t) ?? 0;
    const pesoTit = tTit.reduce((a, t) => a + w(t), 0) || 1;
    const pesoTexto = pesoTit + tOpc.reduce((a, t) => a + w(t), 0);
    const numericos = tOpc.filter((t) => /\d/.test(t));
    // Modelo (opção com número): os complementos PRO/MAX/PLUS… têm de bater exatamente.
    const qualOpc = numericos.length > 0 ? tOpc.filter((t) => QUALIFICADORES.has(t)).sort().join(" ") : null;
    const tipo = tokens(titulo)[0];
    const tipoObrigatorio = tipo && TIPOS_OBRIGATORIOS.has(tipo) ? tipo : null;
    // Acessório: número no nome da estampa também é obrigatório ("7 Cavalos" ≠ "CAVALOS").
    const numerosTitulo = tipoObrigatorio ? [...new Set(tokens(titulo))].filter((t) => /\d/.test(t)) : [];
    // Cor da variante (opção "Cor"): candidato só com cores claramente diferentes sai
    // ("Azul" × produto do Linx só em BRANCO, 10/11/2026); cor que confere desempata.
    const corVar = coresBasicas(corOpcao);
    const candidatos = new Set<string>();
    for (const t of tTit) for (const p of this.tokenIndex.get(t) ?? []) candidatos.add(p);

    let best: string | null = null;
    let bestScore = 0;
    let second = 0;
    for (const p of candidatos) {
      const ts = this.tokensDe.get(p);
      if (!ts) continue;
      if (numericos.some((t) => !ts.has(t))) continue;
      if (qualOpc !== null && [...ts].filter((t) => QUALIFICADORES.has(t)).sort().join(" ") !== qualOpc) continue;
      if (tipoObrigatorio && !ts.has(tipoObrigatorio)) continue;
      if (numerosTitulo.some((t) => !ts.has(t))) continue;
      let bonusCor = 0;
      if (corVar.size > 0) {
        const cores = this.cores.get(p) ?? [];
        const coresLinx = cores.map((c) => coresBasicas(c.DESC_COR, true));
        const confere = coresLinx.some((s) => [...s].some((t) => corVar.has(t)));
        const todasBasicas = coresLinx.length > 0 && coresLinx.every((s) => s.size > 0);
        if (!confere && todasBasicas) continue;
        if (confere) bonusCor = 0.03;
      }
      let casTit = 0;
      for (const t of tTit) if (ts.has(t)) casTit += w(t);
      if (casTit / pesoTit < 0.6) continue;
      let casOpc = 0;
      for (const t of tOpc) if (ts.has(t)) casOpc += w(t);
      const total = this.tokenWeight.get(p) || 1;
      const score =
        0.7 * Math.min(1, (casTit + casOpc) / total) + 0.3 * ((casTit + casOpc) / pesoTexto) + bonusCor;
      if (score > bestScore) {
        second = bestScore;
        bestScore = score;
        best = p;
      } else if (score > second) second = score;
    }
    return best ? { produto: this.produtos.get(best)!.PRODUTO, score: bestScore, margem: bestScore - second } : null;
  }

  descProduto(produto: string) {
    return this.produtos.get(up(produto))?.DESC_PRODUTO ?? null;
  }
  descCor(produto: string, cor: string | null) {
    if (cor == null) return null;
    return this.findCor(produto, cor)?.DESC_COR ?? null;
  }
}

const optionValue = (v: ShopifyVariantRow, pattern: RegExp) =>
  v.options.find((o) => pattern.test(o.name))?.value ?? null;

function codesOf(v: ShopifyVariantRow): string[] {
  return [v.barcode, v.sku].filter((x): x is string => !!x).flatMap((x) => x.split("/").map((s) => s.trim()));
}

/** Calcula o vínculo automático de todas as variantes (não grava). */
export async function computeAutoMaps(
  variants: ShopifyVariantRow[],
): Promise<Map<string, ShopifyVariantMapRow>> {
  const idx = await LinxIndex.load(variants.flatMap(codesOf));
  const out = new Map<string, ShopifyVariantMapRow>();
  const row = (v: ShopifyVariantRow, r: Partial<ShopifyVariantMapRow> & { status: ShopifyVariantMapRow["status"] }) =>
    out.set(v.variant_id, {
      variant_id: v.variant_id,
      origem: "auto",
      metodo: null,
      score: null,
      produto: null,
      cor_produto: null,
      tamanho: null,
      desc_produto: null,
      desc_cor: null,
      componentes: null,
      ...r,
    });

  // 1–3: por código
  const pendentesTamanho: Array<{ v: ShopifyVariantRow; produto: string; cor: string | null }> = [];
  for (const v of variants) {
    if (isGiftCard(v.product_title)) {
      row(v, { status: "nao_linx", metodo: "vale-presente" });
      continue;
    }
    // Kit: vários códigos de barra, todos precisam existir.
    const sku = v.sku ?? v.barcode ?? "";
    if (sku.includes("/")) {
      const parts = sku.split("/").map((s) => s.trim()).filter(Boolean);
      const comps: MapaComponente[] = [];
      for (const part of parts) {
        const m = idx.matchCode(part);
        if (!m) break;
        comps.push({ codigo: part, produto: m.produto, cor: m.cor, tamanho: m.tamanho, descProduto: idx.descProduto(m.produto) });
      }
      if (comps.length === parts.length && comps.length > 0) {
        row(v, { status: "vinculado", metodo: `kit (${comps.length} itens)`, componentes: comps });
        continue;
      }
    }
    const m = idx.matchCode(v.barcode) ?? idx.matchCode(v.sku);
    if (!m) continue;
    let cor = m.cor;
    let metodo = m.metodo;
    if (cor == null) {
      const c = idx.corPorDescricao(m.produto, optionValue(v, /^cor$/i));
      if (c) {
        cor = c.COR_PRODUTO;
        metodo += " + cor pela opção";
      }
    }
    row(v, {
      status: cor == null && (idx.cores.get(up(m.produto))?.length ?? 0) > 1 ? "sugerido" : "vinculado",
      metodo: cor == null ? `${metodo} (cor a definir)` : metodo,
      produto: m.produto,
      cor_produto: cor,
      tamanho: m.tamanho,
    });
    if (m.tamanho == null) pendentesTamanho.push({ v, produto: m.produto, cor });
  }

  // 4: irmã — mesma variante sem a opção de personalização.
  const semPers = (v: ShopifyVariantRow) =>
    `${v.product_id}|${v.options.filter((o) => !isPersonalizacao(o.name)).map((o) => norm(o.value)).join("/")}`;
  const irmas = new Map<string, ShopifyVariantMapRow>();
  for (const v of variants) {
    const r = out.get(v.variant_id);
    if (r && r.status === "vinculado") irmas.set(semPers(v), r);
  }
  for (const v of variants) {
    if (out.has(v.variant_id)) continue;
    const r = irmas.get(semPers(v));
    if (r) out.set(v.variant_id, { ...r, variant_id: v.variant_id, metodo: "igual à variante sem personalização" });
  }

  // 5: nome (título + opções que não são personalização/cor) — só sugere.
  // "Padrão da loja" = palavra presente em ≥ 15 títulos (e ≥ 1% deles) do próprio Shopify,
  // exceto o tipo de acessório (CP, ALCA…), que continua obrigatório.
  const dfLoja = new Map<string, number>();
  const titulos = new Set(variants.map((v) => v.product_title));
  for (const t of titulos) for (const tok of new Set(tokens(t))) dfLoja.set(tok, (dfLoja.get(tok) ?? 0) + 1);
  const limiar = Math.max(15, titulos.size * 0.01);
  const padraoDaLoja = new Set([...dfLoja].filter(([t, n]) => n >= limiar && !TIPOS_OBRIGATORIOS.has(t)).map(([t]) => t));
  for (const v of variants) {
    if (out.has(v.variant_id)) continue;
    const extras = v.options.filter((o) => !isPersonalizacao(o.name) && !/^title$/i.test(o.name) && o.value !== "Default Title");
    const n = idx.matchNome(
      v.product_title,
      extras.map((o) => o.value).join(" "),
      padraoDaLoja,
      optionValue(v, /^cor$/i),
    );
    if (!n || n.score < 0.55) {
      row(v, { status: "pendente" });
      continue;
    }
    const c = idx.corPorDescricao(n.produto, optionValue(v, /^cor$/i));
    row(v, {
      status: "sugerido",
      metodo: `nome (${Math.round(n.score * 100)}%${n.margem < 0.05 ? ", empate" : ""})`,
      score: Math.round(n.score * 1000) / 1000,
      produto: n.produto,
      cor_produto: c?.COR_PRODUTO ?? null,
    });
    pendentesTamanho.push({ v, produto: n.produto, cor: c?.COR_PRODUTO ?? null });
  }

  // Tamanho e descrições.
  await idx.loadBarrasDosProdutos(pendentesTamanho.map((p) => p.produto));
  for (const p of pendentesTamanho) {
    const r = out.get(p.v.variant_id);
    if (r && r.tamanho == null) r.tamanho = idx.tamanho(p.produto, r.cor_produto, optionValue(p.v, /^tamanho$/i));
  }
  for (const r of out.values()) {
    if (r.produto) {
      r.desc_produto = idx.descProduto(r.produto);
      r.desc_cor = idx.descCor(r.produto, r.cor_produto);
    }
  }

  // Código casou, mas o nome não tem NADA em comum com o produto nem com a cor do Linx:
  // pode ser código reaproveitado/errado no Shopify (10/11/2026: 4 pareôs de estampas
  // diferentes no mesmo "COCAR 10/19"). Não vincula direto — vai para conferência.
  // (Estampa na COR do Linx — "DELICADO" cor "PRIMAVERA" — conta como nome em comum.)
  const distintivas = (s: string | null | undefined) =>
    new Set(tokens(s ?? "").filter((t) => t.length > 1 && !/\d/.test(t) && !padraoDaLoja.has(t) && !CORES.has(t)));
  const byId = new Map(variants.map((v) => [v.variant_id, v]));
  for (const r of out.values()) {
    if (r.status !== "vinculado" || !r.produto || !r.metodo || r.componentes) continue;
    if (!/^(código|produto)/.test(r.metodo)) continue;
    const v = byId.get(r.variant_id);
    if (!v) continue;
    const titulo = distintivas(v.product_title);
    const linx = new Set([...distintivas(r.desc_produto), ...distintivas(r.desc_cor)]);
    if (titulo.size === 0 || linx.size === 0) continue;
    if ([...titulo].some((t) => linx.has(t))) continue;
    r.status = "sugerido";
    r.metodo = `${r.metodo} · nome diferente no Linx, conferir`;
  }
  return out;
}

export interface RematchResult {
  variantes: number;
  gravadas: number;
  manuaisPreservadas: number;
  porStatus: Record<string, number>;
}

/** Recalcula o vínculo automático da empresa inteira (ou de algumas variantes). */
export async function rematchShopifyVariants(
  company: ShopifyCompany,
  onlyVariantIds?: string[],
): Promise<RematchResult> {
  const all = await listAllShopifyVariants(company);
  const variants = onlyVariantIds ? all.filter((v) => onlyVariantIds.includes(v.variant_id)) : all;
  // A regra da irmã precisa ver o produto inteiro.
  const productIds = new Set(variants.map((v) => v.product_id));
  const scope = all.filter((v) => productIds.has(v.product_id));
  const existing = await listVariantMaps(company);
  const computed = await computeAutoMaps(scope);
  const targets = new Set(variants.map((v) => v.variant_id));
  const toSave: ShopifyVariantMapRow[] = [];
  let manuais = 0;
  const porStatus: Record<string, number> = {};
  for (const [id, r] of computed) {
    if (!targets.has(id)) continue;
    if (existing.get(id)?.origem === "manual") {
      manuais += 1;
      continue;
    }
    toSave.push(r);
    porStatus[r.status] = (porStatus[r.status] ?? 0) + 1;
  }
  await saveVariantMaps(company, toSave, { onlyAuto: true });
  return { variantes: variants.length, gravadas: toSave.length, manuaisPreservadas: manuais, porStatus };
}

/** Dados do Linx para o vínculo manual: descrição do produto + cores. */
export async function fetchLinxProdutoParaVinculo(produto: string) {
  const p = esc(produto.trim());
  const [prod] = await query<LinxProduto>(
    `SELECT LTRIM(RTRIM(PRODUTO)) AS PRODUTO, LTRIM(RTRIM(ISNULL(DESC_PRODUTO,''))) AS DESC_PRODUTO, INATIVO
       FROM PRODUTOS WHERE LTRIM(RTRIM(PRODUTO)) = '${p}'`,
  );
  if (!prod) return null;
  const cores = await query<LinxCor>(
    `SELECT LTRIM(RTRIM(PRODUTO)) AS PRODUTO, LTRIM(RTRIM(COR_PRODUTO)) AS COR_PRODUTO,
            LTRIM(RTRIM(ISNULL(DESC_COR_PRODUTO,''))) AS DESC_COR
       FROM PRODUTO_CORES WHERE LTRIM(RTRIM(PRODUTO)) = '${p}'`,
  );
  const barras = await query<LinxBarra>(
    `SELECT LTRIM(RTRIM(CODIGO_BARRA)) AS CODIGO_BARRA, LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(COR_PRODUTO)) AS COR_PRODUTO, TAMANHO, LTRIM(RTRIM(ISNULL(GRADE,''))) AS GRADE
       FROM PRODUTOS_BARRA WHERE LTRIM(RTRIM(PRODUTO)) = '${p}'`,
  );
  return { produto: prod, cores, barras };
}

/**
 * Vínculo manual: aplica o mesmo produto a várias variantes. Cor: a escolhida, ou (se
 * "auto") a que casar com a opção "Cor" de cada variante; tamanho pela opção "Tamanho".
 */
export async function vincularManual(
  company: ShopifyCompany,
  variantIds: string[],
  produto: string,
  cor: string | "auto" | null,
  username: string,
) {
  const info = await fetchLinxProdutoParaVinculo(produto);
  if (!info) throw new Error(`Produto ${produto} não existe no Linx.`);
  const all = await listAllShopifyVariants(company);
  const variants = all.filter((v) => variantIds.includes(v.variant_id));
  const corPorOpcao = (valor: string | null) => {
    if (info.cores.length === 1) return info.cores[0];
    if (!valor) return null;
    const v = norm(valor);
    const exato = info.cores.filter((c) => norm(c.DESC_COR) === v);
    if (exato.length === 1) return exato[0];
    const contem = info.cores.filter((c) => norm(c.DESC_COR).includes(v) || v.includes(norm(c.DESC_COR)));
    return contem.length === 1 ? contem[0] : null;
  };
  const rows: ShopifyVariantMapRow[] = variants.map((v) => {
    const c =
      cor === "auto"
        ? corPorOpcao(optionValue(v, /^cor$/i))
        : cor == null
          ? null
          : info.cores.find((x) => numKey(up(x.COR_PRODUTO)) === numKey(up(cor))) ?? null;
    const barras = c ? info.barras.filter((b) => numKey(up(b.COR_PRODUTO)) === numKey(up(c.COR_PRODUTO))) : [];
    const tamanhos = [...new Map(barras.map((b) => [b.TAMANHO, b])).values()];
    const valorTam = optionValue(v, /^tamanho$/i);
    const tam =
      tamanhos.length === 1
        ? tamanhos[0].TAMANHO
        : valorTam
          ? tamanhos.find((b) => norm(b.GRADE) === norm(valorTam))?.TAMANHO ?? null
          : null;
    return {
      variant_id: v.variant_id,
      status: "vinculado",
      origem: "manual",
      metodo: "manual",
      score: null,
      produto: info.produto.PRODUTO,
      cor_produto: c?.COR_PRODUTO ?? null,
      tamanho: tam ?? null,
      desc_produto: info.produto.DESC_PRODUTO,
      desc_cor: c?.DESC_COR ?? null,
      componentes: null,
    };
  });
  await saveVariantMaps(company, rows, { onlyAuto: false, updatedBy: username });
  return { gravadas: rows.length, semCor: rows.filter((r) => r.cor_produto == null).length };
}
