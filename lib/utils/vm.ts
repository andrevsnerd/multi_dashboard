import type { CompanyKey } from "@/lib/config/company";

/**
 * VM (Visual Merchandising) — peças em exposição.
 *
 * Diferença essencial em relação ao Produto Descontinuado (que é só um flag de exibição
 * + veto na Compra Ideal): o VM MOVE ESTOQUE de verdade. Ao entrar na lista, a peça sai
 * do estoque da filial por um romaneio de SAÍDA com TIPO_ROMANEIO = 'VM'; ao sair da
 * lista, volta por um romaneio de ENTRADA com o mesmo tipo — o mesmo mecanismo da tela
 * Saídas e Entradas de Produtos. Por isso nenhuma tela de análise precisa subtrair nada:
 * o saldo já é o real, o ritmo de venda já não conta os dias em que a loja tinha "só o
 * VM", e a Compra Ideal enxerga a ruptura naturalmente.
 *
 * VM é SEMPRE 1 unidade — a linha da lista É a unidade. Não existe quantidade.
 */

/**
 * Empresas com VM habilitado. O movimento de estoque (saída/entrada tipo VM) só existe
 * para NERD por enquanto — a página nem aparece nas outras.
 */
export const VM_COMPANIES: CompanyKey[] = ["nerd"];

export function isVmCompany(company: string | null | undefined): boolean {
  return VM_COMPANIES.includes(String(company ?? "") as CompanyKey);
}

/** Uma peça em VM: sempre 1 unidade de um SKU (produto+cor) numa filial. */
export interface VmItem {
  company: CompanyKey;
  /** Código da filial (COD_FILIAL) — o VM é sempre por filial. */
  filial: string;
  /** Nome da filial resolvido no momento do cadastro (exibição). */
  filialNome: string;
  produto: string;
  /** Cor obrigatória: o estoque é chaveado por PRODUTO+COR_PRODUTO+FILIAL. */
  cor: string;
  descricao: string;
  descCor: string;
  /** ROMANEIO_PRODUTO da saída VM que tirou a peça do estoque. */
  romaneio: string | null;
  criadoPor: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Direção do movimento de estoque gerado pelo VM. */
export type VmDirecao = "saida" | "entrada";

/** Uma linha do log de movimentos do VM (auditoria própria, além do extrato do Linx). */
export interface VmMovimento {
  id: number;
  company: CompanyKey;
  filial: string;
  produto: string;
  cor: string;
  descricao: string;
  descCor: string;
  direcao: VmDirecao;
  romaneio: string | null;
  usuario: string | null;
  obs: string | null;
  criadoEm: string;
}

/**
 * TIPO_ROMANEIO cadastrado no Linx (ESTOQUE_ROMANEIO_TIPO), com
 * UTILIZA_ENTRADA_SAIDA = 3 — serve tanto para saída quanto para entrada.
 */
export const VM_TIPO_ROMANEIO = "VM";

/**
 * O tipo é só 'VM' — o que muda é a operação (saída ou entrada), como no Linx, onde o
 * mesmo TIPO_ROMANEIO serve para as duas pontas. Não existe "tipo SAÍDA VM".
 */
export const VM_DIRECAO_LABEL: Record<VmDirecao, string> = {
  saida: "saída",
  entrada: "entrada",
};

export function normalizeVmValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

/** Normaliza um pedaço de chave: sem acento, maiúsculo, sem espaço nas pontas. */
export function normalizeVmKeyPart(value: string | null | undefined): string {
  return normalizeVmValue(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

/** Chave única de uma peça em VM: filial + produto + cor. */
export function buildVmKey(
  filial: string | null | undefined,
  produto: string | null | undefined,
  cor: string | null | undefined
): string {
  return `${normalizeVmKeyPart(filial)}||${normalizeVmKeyPart(produto)}||${normalizeVmKeyPart(cor)}`;
}

/** Conjunto de chaves de VM, pronto para lookup O(1) nas telas de análise. */
export function buildVmKeySet(
  items: Array<{ filial: string; produto: string; cor: string }>
): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const key = buildVmKey(item.filial, item.produto, item.cor);
    if (key.replace(/\|/g, "")) set.add(key);
  }
  return set;
}

/** True se esse SKU nessa filial está em VM. */
export function isVm(
  keySet: Set<string>,
  filial: string | null | undefined,
  produto: string | null | undefined,
  cor: string | null | undefined
): boolean {
  return keySet.has(buildVmKey(filial, produto, cor));
}

/**
 * Observação padrão gravada na OBS do romaneio e no log de movimentos. Fica visível no
 * Extrato de Produto, então precisa explicar sozinha o que aconteceu.
 */
export function buildVmObs(input: {
  direcao: VmDirecao;
  filialNome: string;
  usuario?: string | null;
  itens: number;
}): string {
  const acao =
    input.direcao === "saida"
      ? "Saída para VM (Visual Merchandising): peça foi para exposição e deixa de contar como estoque disponível."
      : "Entrada de VM (Visual Merchandising): peça saiu da exposição e volta a contar como estoque disponível.";
  const quem = normalizeVmValue(input.usuario);
  const partes = [acao, `Filial: ${input.filialNome}.`, `Itens: ${input.itens}.`];
  if (quem) partes.push(`Responsável: ${quem}.`);
  return partes.join(" ");
}
