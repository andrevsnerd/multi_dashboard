import { NextResponse } from "next/server";

import { getReportMeta } from "@/lib/reports/registry";
import { CROSS_COLUMN_KEYS } from "@/lib/reports/column-sources";
import type { ReportPresetColumn } from "@/lib/reports/types";
import { deleteReportPreset, updateReportPreset } from "@/lib/utils/report-preset-store";

function sanitizeColumns(reportType: string, columns: unknown): ReportPresetColumn[] {
  const meta = getReportMeta(reportType);
  const validKeys = new Set([
    ...(meta?.columns ?? []).map((c) => c.key),
    ...CROSS_COLUMN_KEYS,
  ]);
  if (!Array.isArray(columns)) return [];
  return columns
    .map((c) => ({
      key: String((c as ReportPresetColumn)?.key ?? "").trim(),
      label: String((c as ReportPresetColumn)?.label ?? "").trim(),
    }))
    .filter((c) => c.key && validKeys.has(c.key))
    .map((c) => ({ key: c.key, label: c.label || c.key }));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { reportType, name, columns, sortBy, sortDir } = body ?? {};

    const updates: Parameters<typeof updateReportPreset>[1] = {};

    if (typeof name === "string" && name.trim()) {
      updates.name = name.trim();
    }
    if (columns !== undefined) {
      if (!reportType || !getReportMeta(reportType)) {
        return NextResponse.json(
          { error: "reportType é obrigatório ao atualizar colunas" },
          { status: 400 }
        );
      }
      const clean = sanitizeColumns(reportType, columns);
      if (clean.length === 0) {
        return NextResponse.json(
          { error: "O preset precisa de ao menos uma coluna válida" },
          { status: 400 }
        );
      }
      updates.columns = clean;
    }
    if (sortBy !== undefined) updates.sortBy = typeof sortBy === "string" ? sortBy : null;
    if (sortDir !== undefined) {
      updates.sortDir = sortDir === "asc" || sortDir === "desc" ? sortDir : null;
    }

    const updated = await updateReportPreset(id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Preset não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Erro ao atualizar preset", error);
    return NextResponse.json({ error: "Erro ao atualizar preset" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const ok = await deleteReportPreset(id);
    if (!ok) {
      return NextResponse.json({ error: "Preset não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao excluir preset", error);
    return NextResponse.json({ error: "Erro ao excluir preset" }, { status: 500 });
  }
}
