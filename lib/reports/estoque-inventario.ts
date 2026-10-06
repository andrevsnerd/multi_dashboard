import type { CompanyKey } from "@/lib/config/company";
import type { ReportColumnDef, ReportPresetDef, ReportTypeMeta } from "./types";

export const ESTOQUE_INVENTARIO_ID = "estoque-inventario";

/**
 * Lojas do "Estoque inventário" — porte 1:1 de `LOJAS_INVENTARIO` do script
 * C:\NERD\AUTOMACOES\estoque_inventario.py. Mantenha os dois em sincronia.
 *
 * Cada loja lista o COD_FILIAL de TODAS as filiais que já foram aquela loja (troca de
 * CNPJ). As antigas só ampliam a lista de produtos (saem com ESTOQUE 0); o estoque vem
 * apenas da filial ativa, detectada pela venda/faturamento mais recente (o 1º código é o
 * fallback). Ficaram de fora por serem outra loja: GUARULHOS T3 / GRU T3 (aeroporto),
 * PATIO PAULISTA, IGUATEMI CAMPINAS/POA/RJR, JK IGUATEMI e IBIRAPUERA (desativada).
 *
 * Esta lista é PROPOSITALMENTE separada do filial-registry: ela inclui CNPJs antigos que
 * o registry não carrega.
 */
export interface LojaInventarioDef {
  /** Slug estável — também é o nome do arquivo: estoque-<slug>.xlsx. */
  slug: string;
  company: Exclude<CompanyKey, "corporativo">;
  display: string;
  cods: string[];
}

export const LOJAS_INVENTARIO: LojaInventarioDef[] = [
  // ===================== NERD =====================
  { slug: "nerd-center-norte", company: "nerd", display: "CENTER NORTE", cods: ["000089"] },
  { slug: "nerd-higienopolis", company: "nerd", display: "HIGIENOPOLIS", cods: ["000073", "000090"] },
  { slug: "nerd-leblon", company: "nerd", display: "LEBLON", cods: ["000095"] },
  { slug: "nerd-morumbi-1", company: "nerd", display: "MORUMBI 1", cods: ["000099", "000116", "000091", "000072"] },
  { slug: "nerd-morumbi-2", company: "nerd", display: "MORUMBI 2", cods: ["000115"] },
  { slug: "nerd-eldorado", company: "nerd", display: "ELDORADO", cods: ["000114"] },
  { slug: "nerd-villa-lobos", company: "nerd", display: "VILLA LOBOS", cods: ["000076"] },
  { slug: "nerd-matriz", company: "nerd", display: "MATRIZ", cods: ["000069", "000092", "000086"] },
  // ===================== SCARF ME =====================
  { slug: "scarfme-guarulhos", company: "scarfme", display: "GUARULHOS", cods: ["000079", "000075", "000058", "000057", "000027"] },
  { slug: "scarfme-iguatemi", company: "scarfme", display: "IGUATEMI", cods: ["000059", "000060", "000052", "000045", "000005"] },
  { slug: "scarfme-morumbi", company: "scarfme", display: "MORUMBI", cods: ["000055", "000078", "000041", "000039", "100010"] },
  { slug: "scarfme-oscar-freire", company: "scarfme", display: "OSCAR FREIRE", cods: ["000062", "000064"] },
  { slug: "scarfme-higienopolis", company: "scarfme", display: "HIGIENÓPOLIS", cods: ["000038", "000077", "000004"] },
  { slug: "scarfme-paulista", company: "scarfme", display: "PAULISTA", cods: ["000117", "000088", "000046", "000112"] },
  { slug: "scarfme-villa-lobos", company: "scarfme", display: "VILLA LOBOS", cods: ["000085", "800562"] },
  { slug: "scarfme-galeao", company: "scarfme", display: "GALEÃO RJ", cods: ["000109"] },
  { slug: "scarfme-matriz", company: "scarfme", display: "MATRIZ", cods: ["001"] },
  { slug: "scarfme-ecommerce", company: "scarfme", display: "E-COMMERCE", cods: ["000118", "000111", "000108", "000083", "000082"] },
];

/** Lojas exibidas na tela da empresa. Corporativo (sem lojas próprias) vê todas. */
export function getLojasInventario(companyKey: CompanyKey): LojaInventarioDef[] {
  const proprias = LOJAS_INVENTARIO.filter((l) => l.company === companyKey);
  return proprias.length > 0 ? proprias : LOJAS_INVENTARIO;
}

/** Resumo de cada loja exportada (mesmo que o script imprime no terminal). */
export interface InventarioLojaResumo {
  slug: string;
  filialAtiva: string;
  cods: string[];
  linhas: number;
  comSaldo: number;
  pecas: number;
}

/** Layout do arquivo — idêntico ao do script: FILIAL | CODIGO_BARRA | DESC_PRODUTO | CODIGO_COR | ESTOQUE. */
export const ESTOQUE_INVENTARIO_COLUMNS: ReportColumnDef[] = [
  { key: "FILIAL", defaultLabel: "FILIAL", type: "text" },
  { key: "CODIGO_BARRA", defaultLabel: "CODIGO_BARRA", type: "text" },
  { key: "DESC_PRODUTO", defaultLabel: "DESC_PRODUTO", type: "text" },
  { key: "CODIGO_COR", defaultLabel: "CODIGO_COR", type: "text" },
  { key: "ESTOQUE", defaultLabel: "ESTOQUE", type: "int" },
];

const ESTOQUE_INVENTARIO_PRESETS: ReportPresetDef[] = [
  {
    id: "builtin-estoque-inventario",
    name: "Estoque inventário",
    builtin: true,
    columns: ESTOQUE_INVENTARIO_COLUMNS.map((c) => ({ key: c.key, label: c.defaultLabel })),
  },
];

export function buildEstoqueInventarioPresets(): ReportPresetDef[] {
  return ESTOQUE_INVENTARIO_PRESETS;
}

export const estoqueInventarioMeta: ReportTypeMeta = {
  id: ESTOQUE_INVENTARIO_ID,
  label: "Estoque inventário",
  fileSlug: "inventario",
  description:
    "Arquivo de inventário por loja (FILIAL | CODIGO_BARRA | DESC_PRODUTO | CODIGO_COR | ESTOQUE), igual ao estoque_inventario.py. Lojas que trocaram de CNPJ trazem os produtos de todas as filiais antigas com ESTOQUE 0 e o saldo só da filial ativa. Só códigos de barra de até 8 dígitos; quando há mais de um para o mesmo produto × cor × tamanho, só o principal leva o estoque.",
  // Sem filtros: a entrada é a escolha das lojas (a tela mostra o painel próprio).
  supportedFilters: [],
  columns: ESTOQUE_INVENTARIO_COLUMNS,
  defaultPresets: ESTOQUE_INVENTARIO_PRESETS,
  productBased: false,
};
