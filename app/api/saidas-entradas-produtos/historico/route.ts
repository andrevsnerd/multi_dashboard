import { NextResponse } from "next/server";

import { fetchLogEntradas } from "@/lib/repositories/logEntradas";
import { fetchLogSaidas } from "@/lib/repositories/logSaidas";
import { getAllDestinosByCompany } from "@/lib/utils/destino-romaneio-store";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";

type TipoOperacao = "saida" | "entrada";

function normalizeFilialValue(v: string | null | undefined): string {
  return (v || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeDigits(v: string): string {
  const digits = v.replace(/\D/g, "");
  return digits.replace(/^0+/, "") || "0";
}

function matchFilial(logValue: string | null | undefined, filial: string): boolean {
  const lv = normalizeFilialValue(logValue);
  const target = normalizeFilialValue(filial);
  if (!lv || !target) return false;

  const parts = lv
    .split(/\s*[-–—|]\s*/g)
    .map((p) => p.trim())
    .filter(Boolean);

  if (lv === target || parts.includes(target)) return true;

  const targetDigits = normalizeDigits(target);
  const lvDigits = normalizeDigits(lv);
  if (targetDigits !== "0" && lvDigits !== "0" && targetDigits === lvDigits) return true;

  return parts.some((p) => normalizeDigits(p) === targetDigits && targetDigits !== "0");
}

function cleanDestino(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;
  return trimmed;
}

function getDestinoSalvo(
  destinosMap: Map<string, string>,
  romaneio: string,
  filialOrigem: string,
  filialOrigemCodigo?: string
): string | null {
  const origem = cleanDestino(filialOrigem);
  const origemCodigo = cleanDestino(filialOrigemCodigo);
  const keys = [
    origem ? `${romaneio}|${origem}` : null,
    origemCodigo ? `${romaneio}|${origemCodigo}` : null,
  ].filter(Boolean) as string[];

  for (const key of keys) {
    if (destinosMap.has(key)) {
      return cleanDestino(destinosMap.get(key)) ?? "";
    }
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = (searchParams.get("company") || "").trim();
  const tipoRaw = (searchParams.get("tipo") || "saida").trim().toLowerCase();
  const tipo: TipoOperacao = tipoRaw === "entrada" ? "entrada" : "saida";
  const filial = (searchParams.get("filial") || "").trim();
  const romaneio = (searchParams.get("romaneio") || "").trim();
  const page = Math.max(Number(searchParams.get("page") || 1) || 1, 1);
  const perPage = Math.min(Math.max(Number(searchParams.get("perPage") || 30) || 30, 1), 100);

  try {
    if (!companyKey) {
      return NextResponse.json({ error: "Parâmetro company é obrigatório" }, { status: 400 });
    }

    const companyConfig = await resolveCompanyDynamic(companyKey);
    const filiaisInventory = companyConfig?.filialFilters.inventory ?? [];

    // Filtra no SQL pelas filiais da empresa (antes do TOP) — nunca mistura NERD + SCARFME.
    const [dataset, destinosMap] = await Promise.all([
      tipo === "saida"
        ? fetchLogSaidas(1000, 365, romaneio, filiaisInventory)
        : fetchLogEntradas(1000, 365, romaneio, filiaisInventory),
      tipo === "saida" ? getAllDestinosByCompany(companyKey) : Promise.resolve(new Map<string, string>()),
    ]);

    const filtrados = dataset.filter((log) => {
      if (!filial) return true;
      if (tipo === "saida") return matchFilial(log.filialOrigem, filial);
      return matchFilial(log.filialDestino, filial);
    });

    const start = (page - 1) * perPage;
    const data = filtrados.slice(start, start + perPage).map((log) => {
      if (tipo !== "saida") return log;
      const saidaLog = log as Awaited<ReturnType<typeof fetchLogSaidas>>[number];
      const destinoSalvo = getDestinoSalvo(destinosMap, saidaLog.romaneio, saidaLog.filialOrigem, saidaLog.filialOrigemCodigo);
      const destinoOriginal =
        destinoSalvo !== null
          ? destinoSalvo
          : cleanDestino(saidaLog.filialDestino) || cleanDestino(saidaLog.filialDestinoCodigo);
      const destinoCodigo = destinoOriginal ? getActiveFilial(companyConfig, destinoOriginal) : null;
      return {
        ...log,
        filialDestino: destinoSalvo !== null ? destinoOriginal : log.filialDestino,
        destinoCodigo,
      };
    });
    const total = filtrados.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    return NextResponse.json({
      data,
      pagination: {
        page,
        perPage,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar histórico de saídas/entradas", error);
    return NextResponse.json({ error: "Erro ao buscar histórico" }, { status: 500 });
  }
}
