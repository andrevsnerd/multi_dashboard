import { NextResponse } from "next/server";

import { getReportMeta } from "@/lib/reports/registry";
import type { ReportPresetColumn } from "@/lib/reports/types";
import { createReportPreset, listReportPresets } from "@/lib/utils/report-preset-store";

/** Filtra colunas para apenas as chaves válidas do catálogo da análise. */
function sanitizeColumns(reportType: string, columns: unknown): ReportPresetColumn[] {
  const meta = getReportMeta(reportType);
  const validKeys = new Set((meta?.columns ?? []).map((c) => c.key));
  if (!Array.isArray(columns)) return [];
  return columns
    .map((c) => ({
      key: String((c as ReportPresetColumn)?.key ?? "").trim(),
      label: String((c as ReportPresetColumn)?.label ?? "").trim(),
    }))
    .filter((c) => c.key && validKeys.has(c.key))
    .map((c) => ({ key: c.key, label: c.label || c.key }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const reportType = searchParams.get("reportType") ?? "";
  const companyKey = searchParams.get("company") ?? "";

  if (!reportType || !companyKey) {
    return NextResponse.json(
      { error: "reportType e company são obrigatórios" },
      { status: 400 }
    );
  }

  try {
    const data = await listReportPresets(reportType, companyKey);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar presets", error);
    return NextResponse.json({ error: "Erro ao listar presets" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { reportType, companyKey, name, columns, sortBy, sortDir } = body ?? {};

    if (!reportType || !companyKey) {
      return NextResponse.json(
        { error: "reportType e companyKey são obrigatórios" },
        { status: 400 }
      );
    }
    if (!getReportMeta(reportType)) {
      return NextResponse.json({ error: "Tipo de análise inválido" }, { status: 400 });
    }

    const cleanColumns = sanitizeColumns(reportType, columns);
    if (cleanColumns.length === 0) {
      return NextResponse.json(
        { error: "O preset precisa de ao menos uma coluna válida" },
        { status: 400 }
      );
    }

    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return NextResponse.json({ error: "Informe um nome para o preset" }, { status: 400 });
    }

    const ownerUsername = request.headers.get("x-auth-username");

    const created = await createReportPreset({
      reportType,
      companyKey,
      name: trimmedName,
      columns: cleanColumns,
      sortBy: typeof sortBy === "string" ? sortBy : null,
      sortDir: sortDir === "asc" || sortDir === "desc" ? sortDir : null,
      ownerUsername: ownerUsername || null,
    });

    return NextResponse.json({ data: created });
  } catch (error) {
    console.error("Erro ao criar preset", error);
    return NextResponse.json({ error: "Erro ao criar preset" }, { status: 500 });
  }
}
