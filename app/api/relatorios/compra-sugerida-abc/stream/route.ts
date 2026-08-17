import { runReport } from "@/lib/reports/registry.server";
import { COMPRA_SUGERIDA_ABC_ID } from "@/lib/reports/compra-sugerida-abc";
import type { ReportFilters } from "@/lib/reports/types";

// Pro: até 300s. O cálculo de compra sugerida por loja varre a rede inteira.
export const maxDuration = 300;

/**
 * Stream (NDJSON) da análise "Compra sugerida por Curva ABC": uma linha JSON por mensagem.
 * Emite progresso por loja enquanto calcula (o front mostra "Calculando compra por loja…
 * X/N") e, ao fim, o ReportResult completo. Existe porque essa análise é demorada (métricas
 * por item × loja) — as demais análises usam a rota /dados (request único).
 *
 * Usamos NDJSON lido via fetch+ReadableStream (não SSE/EventSource): o EventSource RECONECTA
 * sozinho ao fim do stream, o que dispararia o cálculo pesado de novo. Com fetch o consumo é
 * único e cancelável.
 *
 * Mensagens (uma por linha): {type:"progress", done, total, phase} ·
 *   {type:"result", result:<ReportResult>} · {type:"failed", error}.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const company = searchParams.get("company") ?? undefined;
  const start = searchParams.get("start") ?? undefined;
  const end = searchParams.get("end") ?? undefined;
  const grupos = searchParams.getAll("grupo").filter(Boolean);
  const linhas = searchParams.getAll("linha").filter(Boolean);
  const subgrupos = searchParams.getAll("subgrupo").filter(Boolean);
  const grades = searchParams.getAll("grade").filter(Boolean);
  const colecoes = searchParams.getAll("colecao").filter(Boolean);
  const cores = searchParams.getAll("cor").filter(Boolean);
  const tipos = searchParams.getAll("tipo").filter(Boolean);
  const produtoId = searchParams.get("produtoId");
  const produtoSearchTerm = searchParams.get("produtoSearchTerm");
  // Grupo de fornecedor (NERD): o front SEMPRE manda `fornecedor` em `buildQuery()`. Esta rota
  // esquecia de lê-lo (a /dados lê), então o filtro escolhido na tela era silenciosamente
  // ignorado e o arquivo saía com itens de OUTRO fornecedor — mesmo com o nome do arquivo
  // dizendo "fornecedor-centro". Ver runReport (lib/reports/registry.server.ts).
  const fornecedor = searchParams.get("fornecedor");
  const considerarTransferencias = searchParams.get("considerarTransferencias") === "1";
  const incluirRupturas = searchParams.get("incluirRupturas") === "1";

  const filters: ReportFilters = {
    company,
    filial: null, // sempre rede inteira
    start,
    end,
    grupos: grupos.length > 0 ? grupos : null,
    linhas: linhas.length > 0 ? linhas : null,
    subgrupos: subgrupos.length > 0 ? subgrupos : null,
    grades: grades.length > 0 ? grades : null,
    colecoes: colecoes.length > 0 ? colecoes : null,
    cores: cores.length > 0 ? cores : null,
    tipos: tipos.length > 0 ? tipos : null,
    produtoId: produtoId || null,
    produtoSearchTerm: produtoSearchTerm || null,
    fornecedor: fornecedor || null,
    considerarTransferencias,
    incluirRupturas,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      try {
        const result = await runReport(COMPRA_SUGERIDA_ABC_ID, filters, [], {
          onProgress: (done, total, phase) => send({ type: "progress", done, total, phase }),
        });
        if (!result) {
          send({ type: "failed", error: "Análise não encontrada" });
        } else {
          send({ type: "result", result });
        }
      } catch (error) {
        console.error("Erro ao gerar compra sugerida (stream)", error);
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
