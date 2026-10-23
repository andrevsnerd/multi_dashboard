import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole, canConfirmarEntradaDefeito } from "@/lib/auth/permissions";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { operaNaFilial } from "@/lib/utils/transferencia-permissoes-filiais";
import {
  getConfirmados,
  getConfirmacaoItem,
  confirmarItem,
  confirmarItensLote,
  desconfirmarItem,
} from "@/lib/utils/romaneio-confirmacao-store";
import { encontrarNomeContagemLivre, executarAjusteContagem } from "@/lib/ajuste-estoque-executor";
import { registrarDivergenciasNaOrigem } from "@/lib/server/conferencia-divergencias";
import { agoraBrasil, anotarObsRomaneio } from "@/lib/server/obs-operacao";

/** `{ "2": 1, "3": 2 }` → `{ 2: 1, 3: 2 }`; inválido/vazio → null. */
function normalizarTamanhos(raw: unknown): Record<number, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const t = Number(k);
    const q = Math.floor(Number(v));
    if (Number.isInteger(t) && t >= 1 && t <= 48 && Number.isFinite(q) && q >= 0) out[t] = q;
  }
  return Object.keys(out).length > 0 ? out : null;
}
import { withRequest, getConnectionPool } from "@/lib/db/connection";
import sql from "mssql";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { shouldUseProxy, ProxyPool } from "@/lib/db/proxy";
import { resolveResponsavelLinx } from "@/lib/server/responsavel-linx";
import { inserirAjuste } from "@/lib/repositories/ajuste-historico";
import { executeItemQtdeSet } from "@/lib/saida-entrada-executor";
import { mensagemTravaInventario, verificarTravaInventario } from "@/lib/server/trava-inventario";
import { atualizarConferenciaRomaneio } from "@/lib/server/romaneio-conferencia";

/** Regrava o selo de conferência da listagem; falha aqui nunca derruba a confirmação. */
async function regravarConferencia(p: Parameters<typeof atualizarConferenciaRomaneio>[0]) {
  try {
    await atualizarConferenciaRomaneio(p);
  } catch (e) {
    console.error("Erro ao gravar conferência do romaneio", p.romaneioId, e);
  }
}

/**
 * Tira do destino a quantidade que tinha sido confirmada (desconfirmar).
 *
 *  - Com o romaneio de entrada vinculado à confirmação: reduz o item nesse
 *    romaneio (`executeItemQtdeSet` — QTDE + EN_n juntos, o trigger tira do
 *    ESTOQUE e da grade).
 *  - Confirmação antiga, sem vínculo: ajuste por contagem até o saldo menos o
 *    confirmado, nunca abaixo de zero (regra da casa).
 *
 * Lança erro se o Linx recusar; devolve a descrição do que foi feito.
 */
async function reverterEntradaNoDestino(p: {
  filialDestino: string;
  produto: string;
  cor: string;
  qtdeConfirmada: number;
  romaneioEntrada: string;
  romaneioSaida: string;
  responsavel: string;
}): Promise<string> {
  const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();

  const filialNome = await withRequest(async (req) => {
    req.input("filial", sql.VarChar, p.filialDestino);
    const r = await req.query<{ FILIAL: string }>(`
      SELECT TOP 1 RTRIM(FILIAL) AS FILIAL FROM FILIAIS WITH (NOLOCK)
       WHERE LTRIM(RTRIM(COD_FILIAL)) = LTRIM(RTRIM(@filial)) OR LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filial))
    `);
    return r.recordset[0]?.FILIAL?.trim() || p.filialDestino;
  });

  if (p.romaneioEntrada) {
    const qtdeNaEntrada = await withRequest(async (req) => {
      req.input("romaneio", sql.VarChar, p.romaneioEntrada);
      req.input("filial", sql.VarChar, filialNome);
      req.input("produto", sql.VarChar, p.produto);
      req.input("cor", sql.VarChar, p.cor);
      const r = await req.query<{ qtde: number }>(`
        SELECT TOP 1 ISNULL(i.QTDE, 0) AS qtde
          FROM ESTOQUE_PROD1_ENT i WITH (NOLOCK)
         WHERE LTRIM(RTRIM(i.ROMANEIO_PRODUTO)) = @romaneio
           AND LTRIM(RTRIM(i.FILIAL)) = LTRIM(RTRIM(@filial))
           AND LTRIM(RTRIM(i.PRODUTO)) = @produto
           AND (
             ISNULL(LTRIM(RTRIM(CAST(i.COR_PRODUTO AS VARCHAR(20)))), '') = @cor
             OR TRY_CONVERT(INT, i.COR_PRODUTO) = TRY_CONVERT(INT, @cor)
           )
      `);
      return r.recordset.length > 0 ? Number(r.recordset[0].qtde) || 0 : null;
    });
    if (qtdeNaEntrada === null) {
      throw new Error(
        `${p.produto}${p.cor ? ` cor ${p.cor}` : ""} não está no romaneio de entrada ${p.romaneioEntrada} de ${filialNome}.`
      );
    }

    const res = await executeItemQtdeSet(pool, {
      tipo: "entrada",
      romaneio: p.romaneioEntrada,
      filial: filialNome,
      produto: p.produto,
      corProduto: p.cor,
      qtdeNova: Math.max(0, qtdeNaEntrada - p.qtdeConfirmada),
    });
    if (res.delta !== 0) {
      inserirAjuste({
        filial: res.filial,
        itens: [{ produto: p.produto, cor: p.cor, qtde: res.delta }],
        romaneioRef: p.romaneioEntrada,
        tipoAjuste: "DESCONFIRMACAO_ENTRADA",
        responsavel: p.responsavel,
        obs: `Desconfirmação da saída ${p.romaneioSaida}: entrada ${res.qtdeAnterior} → ${res.qtdeNova}`,
      }).catch((e) => console.error("[ajuste-historico] Falha ao registrar auditoria:", e));
    }
    return `Entrada ${p.romaneioEntrada} em ${res.filial}: ${res.qtdeAnterior} → ${res.qtdeNova}.`;
  }

  const estoqueAtual = await withRequest(async (req) => {
    req.input("filial", sql.VarChar, filialNome);
    req.input("produto", sql.VarChar, p.produto);
    req.input("cor", sql.VarChar, p.cor);
    const r = await req.query<{ estoque: number }>(`
      SELECT TOP 1 ISNULL(ESTOQUE, 0) AS estoque
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
       WHERE LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filial))
         AND LTRIM(RTRIM(PRODUTO)) = @produto
         AND (
           ISNULL(LTRIM(RTRIM(CAST(COR_PRODUTO AS VARCHAR(20)))), '') = @cor
           OR TRY_CONVERT(INT, COR_PRODUTO) = TRY_CONVERT(INT, @cor)
         )
    `);
    return Number(r.recordset[0]?.estoque ?? 0);
  });
  const alvo = Math.max(0, estoqueAtual - p.qtdeConfirmada);
  if (alvo === estoqueAtual) {
    return `${filialNome} não tem saldo de ${p.produto} para devolver (saldo ${estoqueAtual}): só a confirmação foi desfeita.`;
  }

  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
  const [ano, mes, dia] = hoje.split("-");
  const poolLike = pool as unknown as { request: () => unknown };
  const nomeContagem = await encontrarNomeContagemLivre(poolLike, `DESCONF${dia}${mes}`);
  await executarAjusteContagem(poolLike, {
    filialNome,
    nomeContagem,
    emissao: `${ano}-${mes}-${dia} 00:00:00`,
    responsavel: p.responsavel,
    obs: `DESCONFIRMACAO ROMANEIO ${p.romaneioSaida}`,
    itens: [{ produto: p.produto, cor: p.cor, contagem: alvo }],
  });
  return (
    `${filialNome}: ajuste de −${estoqueAtual - alvo} (contagem ${nomeContagem}) — confirmação antiga, ` +
    "sem romaneio de entrada vinculado."
  );
}

/**
 * GET /api/romaneio-confirmar-entrada?company=X&romaneio=Y&filialDestino=Z
 * Retorna objeto { "produto|cor": qtdeConfirmada } para o romaneio+filial.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get("company") || "";
    const romaneio = searchParams.get("romaneio") || "";
    const filialDestino = searchParams.get("filialDestino") || "";
    const companyConfig = await resolveCompanyDynamic(company);

    if (!company || !romaneio || !filialDestino) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios: company, romaneio, filialDestino" },
        { status: 400 }
      );
    }

    const filialDestinoAtiva = getActiveFilial(companyConfig, filialDestino);
    const map = await getConfirmados(company, romaneio, filialDestinoAtiva);
    if (filialDestinoAtiva !== filialDestino.trim()) {
      const legacyMap = await getConfirmados(company, romaneio, filialDestino);
      for (const [chave, qtde] of legacyMap.entries()) {
        if (!map.has(chave)) map.set(chave, qtde);
      }
    }
    // Serializa Map para objeto plain
    const data: Record<string, number> = {};
    for (const [chave, qtde] of map.entries()) {
      data[chave] = qtde;
    }
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error("GET romaneio-confirmar-entrada:", err);
    return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 });
  }
}

/**
 * POST /api/romaneio-confirmar-entrada
 * Body: { companyKey, romaneioId, filialDestino, produto, corProduto, qtdeConfirmada, acao: "confirmar"|"desconfirmar" }
 */
export async function POST(request: Request) {
  try {
    const username = request.headers.get("x-auth-username")?.trim();
    if (!username) {
      return NextResponse.json(
        { error: "Usuário não identificado. Faça login novamente." },
        { status: 401 }
      );
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 403 });
    }
    if (isReadOnlyRole(user.role)) {
      return NextResponse.json(
        { error: "Acesso somente leitura: esta função não pode confirmar entradas." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      companyKey: string;
      romaneioId: string;
      filialDestino: string;
      produto: string;
      corProduto: string;
      qtdeConfirmada?: number;
      acao: "confirmar" | "desconfirmar" | "confirmar-lote";
      /** `confirmar-lote`: todos os itens do romaneio numa chamada só. */
      itens?: Array<{
        produto: string;
        corProduto?: string | null;
        qtdeConfirmada: number;
        tamanhosConfirmados?: Record<string, number> | null;
        /** Conferiu diferente do romaneio (menos ou outro tamanho) → acerta a saída. */
        divergente?: boolean;
      }>;
      /**
       * Filial de ORIGEM do romaneio de saída. Quando vem, confirmar menos do
       * que saiu devolve a diferença ao estoque dela (ver o bloco de correção).
       */
      filialOrigem?: string;
      /**
       * Romaneio de ENTRADA gerado no destino nesta conferência. Guardado junto
       * com a confirmação porque o Linx não liga a entrada avulsa à saída, e sem
       * esse vínculo não há como corrigir o destino depois.
       */
      romaneioEntrada?: string;
      /** Data de emissão do romaneio (a que a tela mostra) — usada pela trava de inventário. */
      dataRomaneio?: string;
      /** Peça P/M/G: o que chegou em cada tamanho {posição: qtd}. */
      tamanhosConfirmados?: Record<string, number> | null;
    };

    const { companyKey, romaneioId, filialDestino, produto, corProduto, qtdeConfirmada = 0, acao } = body;
    const companyConfig = await resolveCompanyDynamic(companyKey);
    const filialDestinoAtiva = getActiveFilial(companyConfig, filialDestino);

    if (!companyKey || !romaneioId || !filialDestino || (!produto && acao !== "confirmar-lote")) {
      return NextResponse.json(
        { error: "Campos obrigatórios: companyKey, romaneioId, filialDestino, produto" },
        { status: 400 }
      );
    }

    if (acao === "confirmar" && qtdeConfirmada <= 0) {
      return NextResponse.json(
        { error: "A quantidade confirmada deve ser maior que zero." },
        { status: 400 }
      );
    }

    // Verifica permissão da filialDestino.
    // Exceção: a filial de DEFEITO (NERD DEFEITOS / BAZAR SCARF ME) é aprovada pela
    // MATRIZ, então a logística confirma entrada nela mesmo estando atribuída a outra
    // filial — e mesmo sem registro em transferencia_permissoes.
    const fd = (filialDestinoAtiva || "").trim();
    const ehDefeitoAprovadoPelaMatriz = canConfirmarEntradaDefeito(user, companyKey, fd);

    if (user.role !== "admin" && !ehDefeitoAprovadoPelaMatriz) {
      const permissao = await getPermissaoByUsername(username);
      if (!permissao) {
        return NextResponse.json({ error: "Sem permissão configurada." }, { status: 403 });
      }
      const filialOk =
        !permissao.filialAtribuida ||
        permissao.filialAtribuida === "TODAS" ||
        permissao.filialAtribuida === fd ||
        // Filiais adicionais de operação (ex.: logística que também recebe em NERD DEFEITOS).
        operaNaFilial(permissao, companyConfig, fd) ||
        permissao.filiaisDestino.length === 0 ||
        permissao.filiaisDestino.some((f) => getActiveFilial(companyConfig, f || "").trim() === fd);
      if (!filialOk) {
        return NextResponse.json({ error: "Sem permissão para esta filial." }, { status: 403 });
      }
    }

    // TRAVA DE INVENTÁRIO — romaneio anterior ao último inventário da filial de
    // destino fica só para consulta: nem confirma, nem desconfirma (as duas mexem
    // no estoque que o inventário já contou). Ver lib/server/trava-inventario.ts.
    const trava = await verificarTravaInventario({
      companyKey,
      filialDestino,
      dataRomaneio: body.dataRomaneio,
    }).catch((e) => {
      console.error("Erro ao verificar trava de inventário", e);
      return null;
    });
    if (trava) {
      return NextResponse.json(
        { error: mensagemTravaInventario(trava), travaInventario: trava },
        { status: 409 }
      );
    }

    if (acao === "confirmar-lote") {
      // CONFIRMAR TUDO numa chamada só. Antes a tela mandava UMA requisição por
      // item, em sequência, e não olhava a resposta: a que falhava (instância
      // fria, DDL do ensureTable travando a tabela, rede) deixava o item sem
      // confirmação enquanto a tela pintava tudo de verde — romaneio 033462, com
      // a entrada inteira lançada e itens "sem confirmar" no meio.
      //
      // Agora: acertos de saída (só dos divergentes) primeiro, e depois TODAS as
      // confirmações num único INSERT — entram todas ou nenhuma. Repetir é
      // seguro: o acerto é por quantidade absoluta e a entrada já feita é
      // reaproveitada pela trava de duplicata.
      const itens = (body.itens ?? [])
        .map((it) => ({
          produto: (it.produto || "").trim(),
          corProduto: (it.corProduto ?? "").toString().trim(),
          qtdeConfirmada: Math.floor(Number(it.qtdeConfirmada) || 0),
          tamanhosConfirmados: it.tamanhosConfirmados ?? null,
          divergente: Boolean(it.divergente),
        }))
        .filter((it) => it.produto && it.qtdeConfirmada > 0);
      if (itens.length === 0) {
        return NextResponse.json({ error: "Nenhum item com quantidade para confirmar." }, { status: 400 });
      }

      // Divergência (faltou / tamanho trocado) vira romaneio NOVO na origem — a
      // saída original fica intacta. Antes das confirmações: se o Linx recusar,
      // nada é confirmado e o operador repete (idempotente por item).
      const filialOrigem = (body.filialOrigem ?? "").trim();
      let origens: string[] = [];
      let divergencia: Awaited<ReturnType<typeof registrarDivergenciasNaOrigem>> | null = null;
      const divergentes = itens.filter((it) => it.divergente);
      if (filialOrigem && divergentes.length > 0) {
        try {
          divergencia = await registrarDivergenciasNaOrigem({
            romaneioSaida: romaneioId,
            filialOrigem,
            filialDestino: fd,
            itens: divergentes.map((it) => ({
              produto: it.produto,
              corProduto: it.corProduto,
              qtdeConfirmada: it.qtdeConfirmada,
              tamanhosConfirmados: normalizarTamanhos(it.tamanhosConfirmados),
            })),
            username,
          });
          origens = divergencia.mensagens;
        } catch (e) {
          return NextResponse.json(
            {
              error: `Nada foi confirmado: não deu para registrar na origem as peças que não chegaram (${
                e instanceof Error ? e.message : "erro no Linx"
              }). Tente de novo.`,
            },
            { status: 409 }
          );
        }
      }

      await confirmarItensLote(
        companyKey,
        romaneioId,
        filialDestinoAtiva,
        itens.map((it) => ({ produto: it.produto, corProduto: it.corProduto, qtdeConfirmada: it.qtdeConfirmada })),
        username,
        (body.romaneioEntrada ?? "").trim()
      );

      // Documenta a conferência no romaneio conferido (a saída na origem; numa
      // confirmação de trânsito sem origem, o próprio romaneio no destino).
      const pecas = itens.reduce((s, it) => s + it.qtdeConfirmada, 0);
      const romEnt = (body.romaneioEntrada ?? "").trim();
      const partesDiv = [
        divergencia?.romaneioDevolucao ? `nao recebidos voltaram no romaneio ${divergencia.romaneioDevolucao}` : "",
        divergencia?.romaneioTroca ? `tamanho trocado no romaneio ${divergencia.romaneioTroca}` : "",
      ].filter(Boolean);
      await anotarObsRomaneio({
        tipo: filialOrigem ? "saida" : "entrada",
        romaneio: romaneioId,
        filial: filialOrigem || fd,
        linha:
          `CONFERIDO EM ${fd} | ${itens.length} produto(s), ${pecas} peca(s)` +
          `${romEnt ? ` | entrada ${romEnt}` : ""}` +
          `${divergentes.length > 0 ? ` | ${divergentes.length} com divergencia${partesDiv.length ? `: ${partesDiv.join("; ")}` : ""}` : ""}` +
          ` | POR: ${username} | ${agoraBrasil()}`,
      });

      await regravarConferencia({ companyKey, romaneioId, filialDestino: filialDestinoAtiva, filialOrigem });

      return NextResponse.json({ success: true, acao, confirmados: itens.length, origens });
    }

    if (acao === "desconfirmar") {
      // DESCONFIRMAR = a peça não entrou no destino. Reverte o estoque do destino
      // ANTES de apagar a confirmação: se o Linx recusar (trava de ajuste, saldo
      // que não pode ficar negativo), nada muda e o operador vê o motivo — apagar
      // a confirmação sem reverter faria uma nova confirmação dar entrada em dobro.
      //
      // Nunca `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = …` (era o que esta rota fazia
      // até 14/10/2026): mexe só no total, a grade ES1..ES48 fica para trás e a
      // entrada continua no Linx. Mesmo padrão da correção de destino da tela
      // Defeitos (app/api/defeitos/item).
      const confirmacao = await getConfirmacaoItem(
        companyKey,
        romaneioId,
        filialDestinoAtiva,
        produto,
        corProduto ?? ""
      );
      const qtdeConfirmada = confirmacao?.qtdeConfirmada ?? 0;
      let destino: string | null = null;

      if (qtdeConfirmada > 0) {
        try {
          destino = await reverterEntradaNoDestino({
            filialDestino: (filialDestinoAtiva || "").trim(),
            produto: (produto || "").trim(),
            cor: (corProduto ?? "").trim(),
            qtdeConfirmada,
            romaneioEntrada: confirmacao?.romaneioEntrada ?? "",
            romaneioSaida: romaneioId,
            responsavel: await resolveResponsavelLinx(username),
          });
        } catch (e) {
          return NextResponse.json(
            {
              error: `A confirmação não foi desfeita: ${e instanceof Error ? e.message : "o estoque do destino não pôde ser revertido."}`,
            },
            { status: 409 }
          );
        }
      }

      await desconfirmarItem(companyKey, romaneioId, filialDestinoAtiva, produto, corProduto ?? "");
      await regravarConferencia({
        companyKey,
        romaneioId,
        filialDestino: filialDestinoAtiva,
        filialOrigem: (body.filialOrigem ?? "").trim(),
      });

      // Documenta no romaneio de entrada (quando há vínculo) que a confirmação caiu.
      if (qtdeConfirmada > 0 && confirmacao?.romaneioEntrada) {
        await anotarObsRomaneio({
          tipo: "entrada",
          romaneio: confirmacao.romaneioEntrada,
          filial: fd,
          linha:
            `CONFIRMACAO DESFEITA (saida ${romaneioId}) | ${produto}${corProduto ? ` cor ${corProduto}` : ""}: ` +
            `${qtdeConfirmada} peca(s) retiradas do estoque | POR: ${username} | ${agoraBrasil()}`,
        });
      }
      return NextResponse.json({ success: true, acao, destino });
    } else {
      // CONFERIU MENOS DO QUE SAIU → a peça que não chegou volta para a loja.
      //
      // Antes, confirmar 2 de uma saída de 3 dava entrada de 2 no destino e
      // deixava a loja de origem 1 peça a menos para sempre: a divergência
      // desaparecia sem que ninguém devolvesse nada. Aqui a saída passa a valer
      // a quantidade conferida e o trigger do Linx devolve a diferença.
      //
      // Só vale para saída AVULSA: o executor recusa romaneio pareado com
      // entrada/nota de transferência, porque lá o outro lado é amarrado pelo
      // ERP e a diferença é assunto de conferência, não de correção. Por isso a
      // falha aqui NÃO derruba a confirmação — ela só volta descrita na resposta.
      // Mesma regra do lote: divergência vira romaneio novo na origem.
      const filialOrigem = (body.filialOrigem ?? "").trim();
      let origem: { corrigido: boolean; detalhe: string } | null = null;
      if (filialOrigem && qtdeConfirmada > 0) {
        try {
          const r = await registrarDivergenciasNaOrigem({
            romaneioSaida: romaneioId,
            filialOrigem,
            filialDestino: fd,
            itens: [
              {
                produto,
                corProduto: corProduto ?? "",
                qtdeConfirmada,
                tamanhosConfirmados: normalizarTamanhos(body.tamanhosConfirmados),
              },
            ],
            username,
          });
          if (r.mensagens.length > 0) origem = { corrigido: true, detalhe: r.mensagens.join(" ") };
        } catch (e) {
          return NextResponse.json(
            {
              error: `Nada foi confirmado: não deu para registrar na origem a peça que não chegou (${
                e instanceof Error ? e.message : "erro no Linx"
              }). Tente de novo.`,
            },
            { status: 409 }
          );
        }
      }

      await confirmarItem(
        companyKey,
        romaneioId,
        filialDestinoAtiva,
        produto,
        corProduto ?? "",
        qtdeConfirmada,
        username,
        (body.romaneioEntrada ?? "").trim()
      );
      await regravarConferencia({ companyKey, romaneioId, filialDestino: filialDestinoAtiva, filialOrigem });

      return NextResponse.json({ success: true, acao, origem });
    }

    return NextResponse.json({ success: true, acao });
  } catch (err: any) {
    console.error("POST romaneio-confirmar-entrada:", err);
    return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 });
  }
}
