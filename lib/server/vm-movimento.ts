import "server-only";

import { query } from "@/lib/db/connection";
import { getConnectionPool } from "@/lib/db/connection";
import { shouldUseProxy, ProxyPool } from "@/lib/db/proxy";
import { resolverNomeFilial } from "@/lib/repositories/ajusteEstoque";
import { resolveResponsavelLinx } from "@/lib/server/responsavel-linx";
import { executeSaidaLote, executeEntradaLote } from "@/lib/saida-entrada-executor";
import type { CompanyKey } from "@/lib/config/company";
import {
  addVmItems,
  listVmItems,
  logVmMovimentos,
  removeVmItems,
  type VmItemInput,
} from "@/lib/utils/vm-store";
import {
  buildVmKey,
  buildVmObs,
  normalizeVmValue,
  VM_TIPO_ROMANEIO,
  VM_DIRECAO_LABEL,
  type VmDirecao,
} from "@/lib/utils/vm";

/**
 * Movimento de estoque do VM.
 *
 * Entrar na lista  ⇒ SAÍDA  de 1 unidade do estoque da filial (a peça foi para exposição).
 * Sair da lista    ⇒ ENTRADA de 1 unidade (a peça voltou para venda).
 *
 * Mecanismo: romaneio de saída/entrada avulsa com TIPO_ROMANEIO = 'VM' (cadastrado no
 * Linx em ESTOQUE_ROMANEIO_TIPO), exatamente o que a tela Saídas e Entradas de Produtos
 * faz ao escolher um tipo como TRANSFERENCIA ENTRE LOJAS. Reaproveita o mesmo executor,
 * então o número do romaneio, os cabeçalhos e a atualização de ESTOQUE_PRODUTOS pela
 * trigger seguem idênticos ao fluxo que a operação já usa — e o movimento aparece no
 * Extrato de Produto com o tipo VM, sem nada de especial no caminho.
 *
 * Saída de VM não tem filial destino: a peça não vai para outra loja, sai para exposição.
 */

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

export interface VmSkuRef {
  produto: string;
  cor: string;
}

export interface VmSaldoInfo {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  estoque: number;
}

/** Saldo + descrições de SKUs específicos numa filial (chave: `PRODUTO|COR`). */
export async function fetchVmSaldos(
  filialNome: string,
  skus: VmSkuRef[]
): Promise<Map<string, VmSaldoInfo>> {
  const map = new Map<string, VmSaldoInfo>();
  const alvo = skus
    .map((s) => ({ produto: normalizeVmValue(s.produto), cor: normalizeVmValue(s.cor) }))
    .filter((s) => s.produto);
  if (alvo.length === 0) return map;

  const produtosIn = [...new Set(alvo.map((s) => `'${esc(s.produto)}'`))].join(",");
  const rows = await query<{
    PRODUTO: string;
    COR: string;
    ESTOQUE: number;
    DESC_PRODUTO: string;
    DESC_COR: string;
  }>(`
    SELECT RTRIM(ep.PRODUTO) AS PRODUTO,
           RTRIM(ISNULL(ep.COR_PRODUTO, '')) AS COR,
           ep.ESTOQUE AS ESTOQUE,
           RTRIM(ISNULL(p.DESC_PRODUTO, '')) AS DESC_PRODUTO,
           RTRIM(ISNULL(cb.DESC_COR, '')) AS DESC_COR
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = ep.PRODUTO
    LEFT JOIN (
      SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK)
      GROUP BY PRODUTO, COR_PRODUTO
    ) cb ON RTRIM(LTRIM(cb.PRODUTO)) = RTRIM(LTRIM(ep.PRODUTO))
       AND (RTRIM(LTRIM(CAST(cb.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, cb.COR_PRODUTO) = TRY_CONVERT(INT, ep.COR_PRODUTO))
    WHERE RTRIM(ep.FILIAL) = '${esc(filialNome.trim())}'
      AND RTRIM(LTRIM(CAST(ep.PRODUTO AS VARCHAR(50)))) IN (${produtosIn})
  `);

  for (const r of rows) {
    const produto = r.PRODUTO?.trim() ?? "";
    const cor = r.COR?.trim() ?? "";
    map.set(`${produto}|${cor}`, {
      produto,
      cor,
      descProduto: r.DESC_PRODUTO?.trim() ?? "",
      descCor: r.DESC_COR?.trim() ?? "",
      estoque: Number(r.ESTOQUE) || 0,
    });
  }

  return map;
}

export interface VmCorDisponivel {
  cor: string;
  descCor: string;
  estoque: number;
}

/**
 * Cores de um produto COM estoque na filial. A página só deixa escolher entre essas:
 * cor é obrigatória e não faz sentido mandar para exposição uma peça que não existe ali.
 */
export async function fetchVmCoresDisponiveis(
  filialNome: string,
  produto: string
): Promise<VmCorDisponivel[]> {
  const produtoNorm = normalizeVmValue(produto);
  if (!produtoNorm) return [];

  const rows = await query<{ COR: string; DESC_COR: string; ESTOQUE: number }>(`
    SELECT RTRIM(ISNULL(ep.COR_PRODUTO, '')) AS COR,
           RTRIM(ISNULL(cb.DESC_COR, '')) AS DESC_COR,
           SUM(ep.ESTOQUE) AS ESTOQUE
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    LEFT JOIN (
      SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK)
      GROUP BY PRODUTO, COR_PRODUTO
    ) cb ON RTRIM(LTRIM(cb.PRODUTO)) = RTRIM(LTRIM(ep.PRODUTO))
       AND (RTRIM(LTRIM(CAST(cb.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, cb.COR_PRODUTO) = TRY_CONVERT(INT, ep.COR_PRODUTO))
    WHERE RTRIM(ep.FILIAL) = '${esc(filialNome.trim())}'
      AND RTRIM(LTRIM(CAST(ep.PRODUTO AS VARCHAR(50)))) = '${esc(produtoNorm)}'
    GROUP BY RTRIM(ISNULL(ep.COR_PRODUTO, '')), RTRIM(ISNULL(cb.DESC_COR, ''))
    HAVING SUM(ep.ESTOQUE) > 0
    ORDER BY RTRIM(ISNULL(ep.COR_PRODUTO, ''))
  `);

  return rows.map((r) => ({
    cor: r.COR?.trim() ?? "",
    descCor: r.DESC_COR?.trim() ?? "",
    estoque: Number(r.ESTOQUE) || 0,
  }));
}

/** Uma linha do widget de confirmação. */
export interface VmPreviewLinha {
  direcao: VmDirecao;
  produto: string;
  cor: string;
  descricao: string;
  descCor: string;
  estoqueAtual: number;
  estoqueDepois: number;
  /** Preenchido quando a linha NÃO pode ser executada (e o motivo aparece no widget). */
  bloqueio: string | null;
}

export interface VmPreview {
  company: CompanyKey;
  filial: string;
  filialNome: string;
  linhas: VmPreviewLinha[];
  /** Quantas linhas estão prontas para executar. */
  executaveis: number;
  /** Quantas estão bloqueadas. */
  bloqueadas: number;
}

export interface VmMovimentoPedido {
  company: CompanyKey;
  filialCod: string;
  /** SKUs que ENTRAM na lista de VM (⇒ saída de estoque). */
  entrando: VmSkuRef[];
  /** SKUs que SAEM da lista de VM (⇒ entrada de estoque). */
  saindo: VmSkuRef[];
}

/**
 * Monta o preview do que vai acontecer no estoque. É o que o widget mostra antes da
 * confirmação — e é recalculado no confirmar, então nunca é a base de decisão.
 */
export async function montarPreviewVm(pedido: VmMovimentoPedido): Promise<VmPreview> {
  const filialCod = normalizeVmValue(pedido.filialCod);
  const filialNome = await resolverNomeFilial(filialCod);
  if (!filialNome) {
    throw new Error("Filial não encontrada.");
  }

  const entrando = dedupeSkus(pedido.entrando);
  const saindo = dedupeSkus(pedido.saindo);

  const [saldos, jaEmVm] = await Promise.all([
    fetchVmSaldos(filialNome, [...entrando, ...saindo]),
    listVmItems(pedido.company, [filialCod]),
  ]);

  const vmKeys = new Set(jaEmVm.map((item) => buildVmKey(item.filial, item.produto, item.cor)));
  const vmByKey = new Map(
    jaEmVm.map((item) => [buildVmKey(item.filial, item.produto, item.cor), item])
  );

  const linhas: VmPreviewLinha[] = [];

  for (const sku of entrando) {
    const info = saldos.get(`${sku.produto}|${sku.cor}`);
    const estoqueAtual = info?.estoque ?? 0;
    const key = buildVmKey(filialCod, sku.produto, sku.cor);
    let bloqueio: string | null = null;

    if (vmKeys.has(key)) {
      bloqueio = "Já está em VM nesta filial.";
    } else if (!sku.cor) {
      bloqueio = "Cor é obrigatória.";
    } else if (estoqueAtual < 1) {
      bloqueio = `Sem estoque na filial (saldo ${estoqueAtual}) — não há peça para expor.`;
    }

    linhas.push({
      direcao: "saida",
      produto: sku.produto,
      cor: sku.cor,
      descricao: info?.descProduto || sku.produto,
      descCor: info?.descCor ?? "",
      estoqueAtual,
      estoqueDepois: bloqueio ? estoqueAtual : estoqueAtual - 1,
      bloqueio,
    });
  }

  for (const sku of saindo) {
    const info = saldos.get(`${sku.produto}|${sku.cor}`);
    const estoqueAtual = info?.estoque ?? 0;
    const key = buildVmKey(filialCod, sku.produto, sku.cor);
    const item = vmByKey.get(key);
    const bloqueio = item ? null : "Não está na lista de VM desta filial.";

    linhas.push({
      direcao: "entrada",
      produto: sku.produto,
      cor: sku.cor,
      descricao: info?.descProduto || item?.descricao || sku.produto,
      descCor: info?.descCor || item?.descCor || "",
      estoqueAtual,
      estoqueDepois: bloqueio ? estoqueAtual : estoqueAtual + 1,
      bloqueio,
    });
  }

  return {
    company: pedido.company,
    filial: filialCod,
    filialNome,
    linhas,
    executaveis: linhas.filter((l) => !l.bloqueio).length,
    bloqueadas: linhas.filter((l) => l.bloqueio).length,
  };
}

function dedupeSkus(skus: VmSkuRef[] | null | undefined): VmSkuRef[] {
  const map = new Map<string, VmSkuRef>();
  for (const sku of skus ?? []) {
    const produto = normalizeVmValue(sku.produto);
    if (!produto) continue;
    const cor = normalizeVmValue(sku.cor);
    const key = `${produto.toUpperCase()}|${cor.toUpperCase()}`;
    if (!map.has(key)) map.set(key, { produto, cor });
  }
  return [...map.values()];
}

export interface VmMovimentoResultadoDirecao {
  direcao: VmDirecao;
  /** TIPO_ROMANEIO gravado no Linx — sempre 'VM'. */
  tipo: string;
  /** "saída" ou "entrada": a operação, não um tipo. */
  operacao: string;
  /** ROMANEIO_PRODUTO gerado no Linx. */
  romaneio: string | null;
  itens: number;
  /** Erro da direção — a outra direção segue independente. */
  erro: string | null;
}

export interface VmMovimentoResultado {
  filial: string;
  filialNome: string;
  direcoes: VmMovimentoResultadoDirecao[];
  /** Linhas que não foram executadas, com o motivo (mesma forma do preview). */
  bloqueadas: VmPreviewLinha[];
  itensEmVm: number;
}

/**
 * Executa o movimento: um romaneio por direção (saída VM e/ou entrada VM), e só depois
 * grava/remove a lista. A lista nunca fica afirmando algo que o estoque não confirmou.
 */
export async function executarMovimentoVm(
  pedido: VmMovimentoPedido,
  usuario: string
): Promise<VmMovimentoResultado> {
  const preview = await montarPreviewVm(pedido);
  const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();

  // Responsável do romaneio: o usuário do LINX atrelado ao login, mesma regra de
  // Saídas e Entradas. Quem fez a operação fica no nosso log e na OBS.
  const responsavel = await resolveResponsavelLinx(usuario);

  const direcoes: VmMovimentoResultadoDirecao[] = [];

  for (const direcao of ["saida", "entrada"] as VmDirecao[]) {
    const candidatas = preview.linhas.filter((l) => l.direcao === direcao && !l.bloqueio);
    if (candidatas.length === 0) continue;

    // Revalida o saldo AGORA: o executor de romaneio não valida estoque (a trigger
    // aceitaria deixar negativo), e o preview pode ter envelhecido por uma venda.
    let linhas = candidatas;
    if (direcao === "saida") {
      const saldosAgora = await fetchVmSaldos(
        preview.filialNome,
        candidatas.map((l) => ({ produto: l.produto, cor: l.cor }))
      );
      linhas = [];
      for (const linha of candidatas) {
        const saldo = saldosAgora.get(`${linha.produto}|${linha.cor}`)?.estoque ?? 0;
        if (saldo < 1) {
          linha.bloqueio = `Saldo ficou em ${saldo} antes da confirmação — a peça não saiu.`;
          continue;
        }
        linha.estoqueAtual = saldo;
        linha.estoqueDepois = saldo - 1;
        linhas.push(linha);
      }
      if (linhas.length === 0) {
        direcoes.push({
          direcao,
          tipo: VM_TIPO_ROMANEIO,
          operacao: VM_DIRECAO_LABEL[direcao],
          romaneio: null,
          itens: 0,
          erro: "Nenhuma peça tinha saldo no momento da confirmação.",
        });
        continue;
      }
    }

    const obs = buildVmObs({
      direcao,
      filialNome: preview.filialNome,
      usuario,
      itens: linhas.length,
    });

    // VM é sempre 1 unidade por SKU.
    const itens = linhas.map((l) => ({
      produto: l.produto,
      corProduto: l.cor || null,
      quantidade: 1,
    }));

    try {
      const resultado =
        direcao === "saida"
          ? // Sem `filialDestino`: saída de VM não vai para outra loja, a peça vai para
            // exposição na própria filial. O executor já assume null.
            await executeSaidaLote(pool, {
              itens,
              filial: preview.filial,
              tipoRomaneio: VM_TIPO_ROMANEIO,
              responsavel,
              observacao: obs,
            })
          : // `gravarTipoRomaneio` porque 'VM' EXISTE em ESTOQUE_ROMANEIO_TIPO: sem isso o
            // executor omite a coluna (default seguro para 'ENTRADA AVULSA', que não está
            // cadastrada) e a entrada nasceria com TIPO_ROMANEIO nulo, sem identificar o VM.
            await executeEntradaLote(pool, {
              itens,
              filial: preview.filial,
              tipoRomaneio: VM_TIPO_ROMANEIO,
              gravarTipoRomaneio: true,
              responsavel,
              observacao: obs,
            });

      const romaneio = String(resultado?.romaneio ?? "").trim() || null;

      if (direcao === "saida") {
        const novos: VmItemInput[] = linhas.map((l) => ({
          company: pedido.company,
          filial: preview.filial,
          filialNome: preview.filialNome,
          produto: l.produto,
          cor: l.cor,
          descricao: l.descricao,
          descCor: l.descCor,
          romaneio,
          criadoPor: usuario,
        }));
        await addVmItems(novos);
      } else {
        await removeVmItems(
          linhas.map((l) => ({
            company: pedido.company,
            filial: preview.filial,
            produto: l.produto,
            cor: l.cor,
          }))
        );
      }

      await logVmMovimentos(
        linhas.map((l) => ({
          company: pedido.company,
          filial: preview.filial,
          produto: l.produto,
          cor: l.cor,
          descricao: l.descricao,
          descCor: l.descCor,
          direcao,
          romaneio,
          usuario,
          obs,
        }))
      ).catch((err) => console.error("[vm] falha ao registrar log de movimento", err));

      direcoes.push({
        direcao,
        tipo: VM_TIPO_ROMANEIO,
        operacao: VM_DIRECAO_LABEL[direcao],
        romaneio,
        itens: linhas.length,
        erro: null,
      });
    } catch (error) {
      direcoes.push({
        direcao,
        tipo: VM_TIPO_ROMANEIO,
        operacao: VM_DIRECAO_LABEL[direcao],
        romaneio: null,
        itens: 0,
        erro: error instanceof Error ? error.message : "Erro ao movimentar o estoque.",
      });
    }
  }

  const itensEmVm = (await listVmItems(pedido.company, [preview.filial])).length;

  return {
    filial: preview.filial,
    filialNome: preview.filialNome,
    direcoes,
    bloqueadas: preview.linhas.filter((l) => l.bloqueio),
    itensEmVm,
  };
}
