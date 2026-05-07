import type { CompraTransitoItemRow, CompraTransitoStatus } from "@/lib/types/compra-transito";

function normalizeDate(value?: string | null): string {
  return (value ?? "").trim().slice(0, 10);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isCompraTransitoDateActive(
  dataRecebimento?: string | null,
  today = new Date()
): boolean {
  const value = normalizeDate(dataRecebimento);
  if (!value) return false;
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() >= startOfLocalDay(today).getTime();
}

export function getCompraTransitoItemStatus(
  dataRecebimento?: string | null,
  today = new Date()
): CompraTransitoStatus {
  return isCompraTransitoDateActive(dataRecebimento, today) ? "em_transito" : "recebido";
}

export function getCompraTransitoStatusFromItems(
  items: Array<Pick<CompraTransitoItemRow, "dataRecebimento">>,
  today = new Date()
): CompraTransitoStatus {
  return items.some((item) => isCompraTransitoDateActive(item.dataRecebimento, today))
    ? "em_transito"
    : "recebido";
}
