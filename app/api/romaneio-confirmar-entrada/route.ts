import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole, canConfirmarEntradaDefeito } from "@/lib/auth/permissions";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { operaNaFilial } from "@/lib/utils/transferencia-permissoes-filiais";
import {
  getConfirmados,
  getConfirmacaoItem,
  confirmarItem,
  desconfirmarItem,
} from "@/lib/utils/romaneio-confirmacao-store";
import { encontrarNomeContagemLivre, executarAjusteContagem } from "@/lib/ajuste-estoque-executor";
import { carregarGradeDaSaida, carregarGrades, chaveSku } from "@/lib/server/grade-produto";

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
      acao: "confirmar" | "desconfirmar";
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

    if (!companyKey || !romaneioId || !filialDestino || !produto) {
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
      let origem: { corrigido: boolean; detalhe: string } | null = null;
      const filialOrigem = (body.filialOrigem ?? "").trim();

      if (filialOrigem && qtdeConfirmada > 0) {
        try {
          const qtdeSaida = await withRequest(async (req) => {
            req.input("romaneio", sql.VarChar, romaneioId.trim());
            req.input("filial", sql.VarChar, filialOrigem);
            req.input("produto", sql.VarChar, produto.trim());
            req.input("cor", sql.VarChar, (corProduto ?? "").trim());
            const r = await req.query<{ qtde: number | null }>(`
              SELECT TOP 1 ISNULL(i.QTDE, 0) AS qtde
                FROM ESTOQUE_PROD1_SAI i WITH (NOLOCK)
               WHERE LTRIM(RTRIM(i.ROMANEIO_PRODUTO)) = @romaneio
                 AND LTRIM(RTRIM(i.FILIAL)) = LTRIM(RTRIM(@filial))
                 AND LTRIM(RTRIM(i.PRODUTO)) = @produto
                 AND (
                   ISNULL(LTRIM(RTRIM(CAST(i.COR_PRODUTO AS VARCHAR(20)))), '') = @cor
                   OR TRY_CONVERT(INT, i.COR_PRODUTO) = TRY_CONVERT(INT, @cor)
                 )
            `);
            return Number(r.recordset[0]?.qtde ?? 0);
          });

          // Peça P/M/G conferida tamanho a tamanho: a saída passa a valer o que
          // chegou em CADA tamanho (inclusive saída antiga que foi toda no P e
          // chegou em M). Só quando não chegou mais do que saiu.
          const tamanhosConf = normalizarTamanhos(body.tamanhosConfirmados);
          const gradeSaida = tamanhosConf
            ? (await carregarGradeDaSaida(romaneioId, filialOrigem, [produto])).get(chaveSku(produto, corProduto))
            : undefined;
          const tamanhoDifere =
            !!tamanhosConf && !!gradeSaida && gradeSaida.some((q, i) => q !== (tamanhosConf[i + 1] ?? 0));

          if (tamanhosConf && tamanhoDifere && qtdeConfirmada <= qtdeSaida) {
            const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
            const res = await executeItemQtdeSet(pool, {
              tipo: "saida",
              romaneio: romaneioId,
              filial: filialOrigem,
              produto,
              corProduto: corProduto ?? "",
              tamanhos: tamanhosConf,
            });
            const rotulos = (await carregarGrades([produto])).get(produto.trim())?.tamanhos ?? [];
            const descrever = (porTam: (i: number) => number) =>
              rotulos.map((t) => `${t.label}:${porTam(t.ordinal)}`).filter((s) => !s.endsWith(":0")).join(" ") || "0";
            origem = {
              corrigido: true,
              detalhe:
                `Saída ${romaneioId} acertada por tamanho em ${res.filial}: ` +
                `${descrever((o) => gradeSaida![o - 1] ?? 0)} → ${descrever((o) => tamanhosConf[o] ?? 0)}.`,
            };
            inserirAjuste({
              filial: res.filial,
              itens: [{ produto, cor: (corProduto ?? "").trim(), qtde: -res.delta }],
              romaneioRef: romaneioId,
              tipoAjuste: "CORRECAO_CONFERENCIA_SAIDA",
              responsavel: await resolveResponsavelLinx(username),
              obs: `Conferência de ${fd} por tamanho: ${res.qtdeAnterior} → ${res.qtdeNova}`,
            }).catch((e) =>
              console.error("[ajuste-historico] Falha ao registrar auditoria:", e)
            );
          } else if (!tamanhosConf && qtdeSaida > qtdeConfirmada) {
            const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
            const res = await executeItemQtdeSet(pool, {
              tipo: "saida",
              romaneio: romaneioId,
              filial: filialOrigem,
              produto,
              corProduto: corProduto ?? "",
              qtdeNova: qtdeConfirmada,
            });
            const devolvido = -res.delta;
            origem = {
              corrigido: true,
              detalhe: `${devolvido} peça(s) devolvida(s) ao estoque de ${res.filial}: a saída ${romaneioId} passou de ${res.qtdeAnterior} para ${qtdeConfirmada}.`,
            };
            inserirAjuste({
              filial: res.filial,
              itens: [{ produto, cor: (corProduto ?? "").trim(), qtde: devolvido }],
              romaneioRef: romaneioId,
              tipoAjuste: "CORRECAO_CONFERENCIA_SAIDA",
              responsavel: await resolveResponsavelLinx(username),
              obs: `Conferência de ${fd}: ${res.qtdeAnterior} → ${qtdeConfirmada}`,
            }).catch((e) =>
              console.error("[ajuste-historico] Falha ao registrar auditoria:", e)
            );
          }
        } catch (e) {
          origem = {
            corrigido: false,
            detalhe:
              e instanceof Error
                ? `O item foi confirmado, mas a saída não pôde ser corrigida: ${e.message}`
                : "O item foi confirmado, mas a saída não pôde ser corrigida.",
          };
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

      return NextResponse.json({ success: true, acao, origem });
    }

    return NextResponse.json({ success: true, acao });
  } catch (err: any) {
    console.error("POST romaneio-confirmar-entrada:", err);
    return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 });
  }
}
