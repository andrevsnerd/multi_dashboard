import type { CompraTransitoStatusReal } from "@/lib/types/compra-transito";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  RECONCILIAÇÃO DE COMPRAS EM TRÂNSITO × ENTRADAS REAIS NA MATRIZ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Casa cada item comprado com as entradas físicas que realmente chegaram na
 * matriz, em vez de presumir a chegada pela data. Regra crítica do dono: um item
 * recebido em uma compra NÃO pode ser "roubado" por um produto idêntico comprado
 * numa compra POSTERIOR. Resolvido com alocação FIFO por data de criação da
 * compra + restrição de elegibilidade (entrada anterior à compra não a preenche).
 *
 * Tudo aqui é puro (sem banco), para ser testável isoladamente.
 */

export interface ReconcileCompraInput {
  id: string;
  /** Âncora estável de ordenação/elegibilidade FIFO (nunca muda após criada). */
  createdAt: string;
  items: Array<{
    itemKey: string;
    produto: string;
    corProduto?: string | null;
    quantidade: number;
    dataRecebimento: string;
  }>;
}

export interface ReconcileEntryInput {
  produto: string;
  corProduto?: string | null;
  /** Data da entrada física (ISO). */
  dataEntrada: string;
  qtde: number;
}

export interface ItemReconciliacao {
  recebidoQtd: number;
  faltou: number;
  excedeu: number;
  recebidoEm?: string;
  firstEntryDate?: string;
  lastEntryDate?: string;
  statusReal: CompraTransitoStatusReal;
  allocatedEntries: Array<{ data: string; qtde: number; excess?: boolean }>;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dayKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Extrai a chave de dia (YYYY-MM-DD) de uma string ISO/data. Comparável lexicalmente. */
function dayKey(value?: string | null): string {
  return String(value ?? "").trim().slice(0, 10);
}

/**
 * Espelha o TRY_CONVERT(INT) do SQL e o normalizeCorKey de products.ts: cor
 * numérica perde zeros à esquerda ('06' → '6'); senão trim/upper. Sem isso, a
 * mesma cor casaria em dois formatos diferentes entre compra e entrada.
 * Ver memória [[cor-produto-formato-duas-fontes]].
 */
function normalizeCorKey(cor: string | null | undefined): string {
  const trimmed = String(cor ?? "").trim();
  if (trimmed === "") return "";
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10));
  return trimmed.toUpperCase();
}

/** Chave de reconciliação produto+cor, tolerante aos dois formatos de cor. */
export function buildReconcileKey(produto?: string | null, cor?: string | null): string {
  return `${String(produto ?? "").trim().toUpperCase()}||${normalizeCorKey(cor)}`;
}

/** Status real de UM item a partir do que foi recebido vs a data esperada. */
export function deriveItemStatusReal(
  recebidoQtd: number,
  dataRecebimento: string,
  today: Date = new Date()
): CompraTransitoStatusReal {
  if (recebidoQtd > 0) return "recebido";
  const dr = dayKey(dataRecebimento);
  if (!dr) return "rascunho";
  return dr < dayKeyFromDate(today) ? "atrasado" : "em_transito";
}

interface Slot {
  compraId: string;
  itemKey: string;
  createdDay: string;
  dataRecebimento: string;
  ordered: number;
  remaining: number;
  rec: ItemReconciliacao;
}

function applyAllocation(rec: ItemReconciliacao, data: string, qtde: number, excess: boolean): void {
  rec.recebidoQtd += qtde;
  rec.allocatedEntries.push(excess ? { data, qtde, excess: true } : { data, qtde });
  if (!rec.firstEntryDate || data < rec.firstEntryDate) rec.firstEntryDate = data;
  if (!rec.lastEntryDate || data > rec.lastEntryDate) rec.lastEntryDate = data;
}

/**
 * Aloca as entradas reais nos itens de TODAS as compras (não-rascunho) da empresa
 * e devolve um mapa compraId -> (itemKey -> reconciliação).
 *
 * Passo 1 (FIFO): cada entrada preenche o item ELEGÍVEL mais antigo até o pedido.
 *   Elegível = dia(entrada) >= dia(criação da compra).
 * Passo 2 (excesso): sobra de entrada elegível vai para o item elegível mais NOVO,
 *   contabilizada como "excedeu". Sobra sem item elegível (anterior a todas as
 *   compras) fica sem alocação — nunca rouba uma compra posterior.
 */
export function reconcileCompras(params: {
  compras: ReconcileCompraInput[];
  entries: ReconcileEntryInput[];
  today?: Date;
}): Map<string, Map<string, ItemReconciliacao>> {
  const today = params.today ?? new Date();
  const result = new Map<string, Map<string, ItemReconciliacao>>();
  const slotsByKey = new Map<string, Slot[]>();

  for (const compra of params.compras) {
    const itemMap = new Map<string, ItemReconciliacao>();
    result.set(compra.id, itemMap);
    const createdDay = dayKey(compra.createdAt);
    for (const item of compra.items) {
      const ordered = Math.max(0, Math.round(item.quantidade ?? 0));
      const rec: ItemReconciliacao = {
        recebidoQtd: 0,
        faltou: ordered,
        excedeu: 0,
        statusReal: "em_transito",
        allocatedEntries: [],
      };
      itemMap.set(item.itemKey, rec);
      const key = buildReconcileKey(item.produto, item.corProduto);
      const slot: Slot = {
        compraId: compra.id,
        itemKey: item.itemKey,
        createdDay,
        dataRecebimento: dayKey(item.dataRecebimento),
        ordered,
        remaining: ordered,
        rec,
      };
      const arr = slotsByKey.get(key);
      if (arr) arr.push(slot);
      else slotsByKey.set(key, [slot]);
    }
  }

  // Agrupa as entradas pela mesma chave de reconciliação (mescla '06'/'6').
  const entriesByKey = new Map<string, Array<{ data: string; qtde: number }>>();
  for (const e of params.entries) {
    const qtde = Math.max(0, Math.round(e.qtde ?? 0));
    if (qtde <= 0) continue;
    const key = buildReconcileKey(e.produto, e.corProduto);
    const arr = entriesByKey.get(key);
    if (arr) arr.push({ data: dayKey(e.dataEntrada), qtde });
    else entriesByKey.set(key, [{ data: dayKey(e.dataEntrada), qtde }]);
  }

  for (const [key, slotsRaw] of slotsByKey) {
    const slots = slotsRaw.slice().sort(
      (a, b) =>
        a.createdDay.localeCompare(b.createdDay) ||
        a.dataRecebimento.localeCompare(b.dataRecebimento) ||
        a.compraId.localeCompare(b.compraId) ||
        a.itemKey.localeCompare(b.itemKey)
    );
    const ents = (entriesByKey.get(key) ?? [])
      .slice()
      .sort((a, b) => a.data.localeCompare(b.data));

    // Passo 1 — FIFO: preenche até o pedido, do item mais antigo ao mais novo.
    for (const e of ents) {
      let remaining = e.qtde;
      for (const slot of slots) {
        if (remaining <= 0) break;
        if (slot.remaining <= 0) continue;
        if (e.data < slot.createdDay) continue; // entrada anterior à compra: inelegível
        const take = Math.min(remaining, slot.remaining);
        slot.remaining -= take;
        remaining -= take;
        applyAllocation(slot.rec, e.data, take, false);
      }
      e.qtde = remaining; // sobra para o passo 2
    }

    // Passo 2 — excesso: sobra elegível vai para o item elegível mais novo.
    for (const e of ents) {
      if (e.qtde <= 0) continue;
      let target: Slot | null = null;
      for (const slot of slots) {
        if (e.data < slot.createdDay) continue;
        if (
          !target ||
          slot.createdDay > target.createdDay ||
          (slot.createdDay === target.createdDay && slot.itemKey > target.itemKey)
        ) {
          target = slot;
        }
      }
      if (!target) continue; // anterior a todas as compras: não alocada
      applyAllocation(target.rec, e.data, e.qtde, true);
      target.rec.excedeu += e.qtde;
      e.qtde = 0;
    }
  }

  // Finaliza faltou / recebidoEm / statusReal.
  for (const compra of params.compras) {
    const itemMap = result.get(compra.id)!;
    for (const item of compra.items) {
      const rec = itemMap.get(item.itemKey)!;
      const ordered = Math.max(0, Math.round(item.quantidade ?? 0));
      rec.faltou = Math.max(0, ordered - rec.recebidoQtd);
      rec.recebidoEm = rec.lastEntryDate;
      rec.statusReal = deriveItemStatusReal(rec.recebidoQtd, item.dataRecebimento, today);
    }
  }

  return result;
}
