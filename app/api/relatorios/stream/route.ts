import { runReport } from "@/lib/reports/registry.server";
import { parseExtraSources, parseReportFilters } from "@/lib/reports/params";

// Pro: até 300s. Análises com muitas consultas (uma por mês, uma por loja) demoram.
export const maxDuration = 300;

/**
 * Stream (NDJSON) GENÉRICO do Gerador de Relatórios: vale para QUALQUER `reportType`.
 * Emite progresso enquanto calcula e, ao fim, o ReportResult completo — usado pelas
 * análises demoradas (Projeção de vendas: uma consulta de vendas por mês).
 *
 * Lê os filtros pelo parser compartilhado com a rota /dados (`parseReportFilters`), então
 * não existe o risco de a rota de streaming "esquecer" um filtro que a tela mandou —
 * foi exatamente o que aconteceu com `fornecedor` na rota dedicada da compra sugerida.
 *
 * NDJSON via fetch+ReadableStream (não SSE/EventSource): o EventSource RECONECTA sozinho
 * ao fim do stream, o que dispararia o cálculo pesado de novo.
 *
 * Mensagens (uma por linha): {type:"progress", done, total, phase} ·
 *   {type:"result", result:<ReportResult>} · {type:"failed", error}.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const reportType = searchParams.get("reportType") ?? "";
  const filters = parseReportFilters(searchParams);
  const extraSources = parseExtraSources(searchParams);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      try {
        const result = await runReport(reportType, filters, extraSources, {
          onProgress: (done, total, phase) => send({ type: "progress", done, total, phase }),
        });
        if (!result) {
          send({ type: "failed", error: "Análise não encontrada" });
        } else {
          send({ type: "result", result });
        }
      } catch (error) {
        console.error(`Erro ao gerar relatório em stream (${reportType})`, error);
        const details = error instanceof Error ? error.message : "Erro desconhecido";
        send({ type: "failed", error: "Erro ao gerar relatório", details });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
