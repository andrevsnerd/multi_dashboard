import "server-only";

/**
 * Um lote do histórico de preço pode ter duas partes com o MESMO id: preço por produto
 * (NERD_PRECO_HISTORICO) e Preço Líquido (1) por cor (NERD_PRECO_COR_HISTORICO) — é o que
 * grava uma tarefa por cor do Programar Preços. Aqui o histórico, o detalhe e o reverter
 * enxergam as duas partes como um lote só.
 */

import {
  fetchHistoricoLinhas,
  fetchHistoricoLotes,
  reverterLotePrecos,
  type ExecutarPrecosResult,
  type HistoricoLote,
  type PrecoCompany,
} from "@/lib/repositories/precos";
import {
  fetchHistoricoLotesCor,
  fetchLoteDetalheCor,
  loteTemCor,
  reverterLotePrecosCor,
} from "@/lib/repositories/precosCor";
import { fetchLoteDetalhe, type LoteDetalheLinha } from "@/lib/repositories/precosTarefas";

/** Lotes por produto + por cor, juntos por id e na ordem de data. */
export async function fetchHistoricoLotesMisto(company: PrecoCompany, limite = 30): Promise<HistoricoLote[]> {
  const [produto, cor] = await Promise.all([
    fetchHistoricoLotes(company, limite),
    fetchHistoricoLotesCor(company, limite),
  ]);
  const porLote = new Map(produto.map((l) => [l.lote, { ...l }]));
  for (const c of cor) {
    const atual = porLote.get(c.lote);
    if (atual) {
      atual.alteracoes += c.alteracoes;
      atual.produtos += c.produtos;
      atual.produtosRevertidos += c.produtosRevertidos;
      atual.campos = [...new Set([...atual.campos, ...c.campos])];
      // Só está "desfeito" se as duas partes estão.
      atual.revertidoPor = atual.revertidoPor && c.revertidoPor ? atual.revertidoPor : null;
    } else {
      porLote.set(c.lote, { ...c, empresa: company });
    }
  }
  return [...porLote.values()]
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, Math.min(Math.max(limite, 1), 200));
}

export async function fetchLoteDetalheMisto(lote: string, company: PrecoCompany): Promise<LoteDetalheLinha[]> {
  const [produto, cor] = await Promise.all([fetchLoteDetalhe(lote, company), fetchLoteDetalheCor(lote, company)]);
  return [...produto, ...cor];
}

/**
 * Reverte as duas partes do lote (ou só um produto). A parte por cor devolve o líquido e
 * desliga o modo cor que o lote ligou.
 */
export async function reverterLoteMisto(
  lote: string,
  company: PrecoCompany,
  usuario: string,
  produto?: string | null
): Promise<ExecutarPrecosResult> {
  const alvo = (produto ?? "").trim();
  const linhasProduto = (await fetchHistoricoLinhas(lote)).filter(
    (l) => !l.reverteLote && !l.revertidoPor && (!alvo || l.produto === alvo)
  );
  const temCor = await loteTemCor(lote);

  if (linhasProduto.length === 0 && !temCor) {
    // Deixa a mensagem de sempre ("não encontrado", "já desfeito"…) vir do reverter original.
    return reverterLotePrecos(lote, company, usuario, produto);
  }

  const resultado: ExecutarPrecosResult = {
    lote: "",
    aplicados: 0,
    semMudanca: 0,
    semRegistro: 0,
    naoConfirmados: 0,
    porCampo: [],
    erros: [],
  };

  if (linhasProduto.length > 0) {
    const r = await reverterLotePrecos(lote, company, usuario, produto);
    Object.assign(resultado, { ...r, erros: [...r.erros] });
  }

  if (temCor) {
    const c = await reverterLotePrecosCor(lote, company, usuario, produto);
    resultado.aplicados += c.aplicados;
    resultado.semMudanca += c.semMudanca;
    resultado.naoConfirmados += c.naoConfirmados;
    resultado.erros.push(...c.erros);
    // c.desligados fica no histórico (VARIA_PRECO_COR 1→0 no lote do estorno).
    if (!resultado.lote) resultado.lote = c.lote;
  }

  return resultado;
}
