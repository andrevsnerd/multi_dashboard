import "server-only";

import sql from "mssql";
import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import type { Pedido, PedidoItem } from "@/lib/repositories/corporativoStore";

/**
 * Efetiva um pedido do e-commerce corporativo como um PEDIDO DE VENDA ATACADO
 * real no Linx (form 080201SPK), gravando cabeçalho `VENDAS` + itens
 * `VENDAS_PRODUTO` numa única transação. Espelha o padrão transacional de
 * `criarClienteCorporativo` (SEQUENCIAIS + XACT_ABORT + BEGIN TRAN).
 *
 * Regras (ver docs/CORPORATIVO_PEDIDO_LINX.md — validado em 25.314 pedidos):
 *  - Número: SEQUENCIAIS 'VENDAS.PEDIDO' (stream manual/Digitação Rápida).
 *  - Pedido ABERTO: INSERT não move estoque nem gera NF (cascata só em UPDATE).
 *  - Constantes: TIPO=VENDA ATACADO, MOEDA=R$, COLECAO=62, TABELA_FILHA=VENDAS_PRODUTO,
 *    REPRESENTANTE/GERENTE=SEM REPRESENTANTE, INDICADOR_VENDA=V, FATOR_VENDA_LIQUIDA=1, TIPO_RATEIO=0.
 *  - Do cadastro do cliente (CLIENTES_ATACADO por CLIFOR): CONDICAO_PGTO, CODIGO_TAB_PRECO,
 *    e CLIENTE_ATACADO = CADASTRO_CLI_FOR.NOME_CLIFOR (verbatim).
 *  - FILIAL fixa 'SCARF ME - MATRIZ'; TRANSPORTADORA 'CORREIOS - SEDEX' (decisões do dono).
 *  - Itens: EAN → PRODUTOS_BARRA → (PRODUTO, COR_PRODUTO, TAMANHO=ordinal 1-based) ⇒ VO[ordinal]=qtd.
 *    Agrupa por (PRODUTO, COR_PRODUTO); ITEM_PEDIDO='0000'; ENTREGA=EMISSAO; VE=VO na criação.
 */

const SEQ_KEY = "VENDAS.PEDIDO";
const FILIAL_PEDIDO = "SCARF ME - MATRIZ";
const TRANSPORTADORA_PEDIDO = "CORREIOS - SEDEX";
const COLECAO_PEDIDO = "62";
const APROVADO_POR = "CORP WEB"; // tag interna — nunca exibida ao cliente (max 25)
const MAX_VO = 48;

const trim = (s: string | null | undefined) => String(s ?? "").trim();
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface PedidoVendaLinxResult {
  pedido: string; // número gerado no Linx (ex.: "88085")
}

interface CadastroResolvido {
  nomeClifor: string;
  condicaoPgto: string;
  codigoTabPreco: string;
}

interface LinhaVenda {
  produto: string;
  cor: string;
  qtde: number;
  precoUnitario: number;
  valor: number;
  /** posições da grade (1..48) → quantidade */
  vo: Map<number, number>;
}

/** Resolve NOME_CLIFOR + condição/tabela do cadastro do cliente (por CLIFOR). */
async function resolveCadastro(
  request: sql.Request | RequestLike,
  clifor: string
): Promise<CadastroResolvido | null> {
  const cod = clifor.replace(/\D/g, "").padStart(6, "0").slice(-6);
  const req = request as sql.Request;
  req.input("clifor", cod);
  const r = await req.query(`
    SELECT TOP 1
      cf.NOME_CLIFOR AS nomeClifor,
      LTRIM(RTRIM(ca.CONDICAO_PGTO)) AS condicaoPgto,
      LTRIM(RTRIM(ca.CODIGO_TAB_PRECO)) AS codigoTabPreco
    FROM CLIENTES_ATACADO ca WITH (NOLOCK)
    JOIN CADASTRO_CLI_FOR cf WITH (NOLOCK) ON cf.NOME_CLIFOR = ca.CLIENTE_ATACADO
    WHERE LTRIM(RTRIM(ca.CLIFOR)) = @clifor`);
  const row = (r.recordset as { nomeClifor: string; condicaoPgto: string; codigoTabPreco: string }[])[0];
  if (!row) return null;
  return {
    // NOME_CLIFOR verbatim (pode ter espaço à esquerda) — é a chave em VENDAS.CLIENTE_ATACADO.
    nomeClifor: String(row.nomeClifor ?? "").replace(/\s+$/, ""),
    condicaoPgto: trim(row.condicaoPgto) || "01",
    codigoTabPreco: trim(row.codigoTabPreco) || "01",
  };
}

/** Mapa EAN → (PRODUTO, COR_PRODUTO, TAMANHO ordinal) via PRODUTOS_BARRA. */
async function resolveBarras(
  request: sql.Request | RequestLike,
  eans: string[]
): Promise<Map<string, { produto: string; cor: string; ordinal: number }>> {
  const map = new Map<string, { produto: string; cor: string; ordinal: number }>();
  const limpos = [...new Set(eans.map(trim).filter(Boolean))];
  if (limpos.length === 0) return map;
  const req = request as sql.Request;
  const names: string[] = [];
  limpos.forEach((e, i) => {
    const n = `ean${i}`;
    req.input(n, e);
    names.push("@" + n);
  });
  const r = await req.query(`
    SELECT LTRIM(RTRIM(CODIGO_BARRA)) AS ean, LTRIM(RTRIM(PRODUTO)) AS produto,
           LTRIM(RTRIM(COR_PRODUTO)) AS cor, ISNULL(TAMANHO,1) AS tamanho
    FROM PRODUTOS_BARRA WITH (NOLOCK)
    WHERE LTRIM(RTRIM(CODIGO_BARRA)) IN (${names.join(",")})`);
  for (const row of r.recordset as { ean: string; produto: string; cor: string; tamanho: number }[]) {
    const ean = trim(row.ean);
    if (!map.has(ean)) {
      const ord = Number(row.tamanho) || 1;
      map.set(ean, { produto: trim(row.produto), cor: trim(row.cor), ordinal: ord >= 1 && ord <= MAX_VO ? ord : 1 });
    }
  }
  return map;
}

/** Agrupa itens do carrinho em linhas de VENDAS_PRODUTO (por PRODUTO+COR). */
function montarLinhas(
  itens: PedidoItem[],
  barras: Map<string, { produto: string; cor: string; ordinal: number }>
): LinhaVenda[] {
  const grupos = new Map<string, LinhaVenda>();
  for (const it of itens) {
    if (!it || it.quantidade <= 0) continue;
    const b = barras.get(trim(it.ean));
    // Fallback: sem EAN em PRODUTOS_BARRA → usa produto/cor do carrinho e VO1.
    const produto = b?.produto || trim(it.produto);
    const cor = b?.cor || trim(it.cor);
    const ordinal = b?.ordinal || 1;
    if (!produto) continue;
    const key = `${produto}||${cor}`;
    let g = grupos.get(key);
    if (!g) {
      g = { produto, cor, qtde: 0, precoUnitario: round2(it.precoUnitario), valor: 0, vo: new Map() };
      grupos.set(key, g);
    }
    const q = Math.round(Number(it.quantidade) || 0);
    g.qtde += q;
    g.vo.set(ordinal, (g.vo.get(ordinal) ?? 0) + q);
  }
  // valor = PRECO1 × QTDE (consistente com o Linx; sem desconto)
  for (const g of grupos.values()) g.valor = round2(g.precoUnitario * g.qtde);
  return [...grupos.values()];
}

/**
 * Cria o pedido no Linx a partir de um pedido corporativo (Neon). Somente leitura
 * do cadastro/barras + uma transação de INSERT. Não altera estoque/faturamento.
 */
export async function criarPedidoVendaLinx(pedido: Pedido): Promise<PedidoVendaLinxResult> {
  const clifor = trim(pedido.clienteCodigo);
  if (!clifor) throw new Error("Pedido sem código de cliente (CLIFOR) — não é possível efetivar no Linx.");
  const itens = (pedido.itens ?? []).filter((i) => i && i.produto && i.quantidade > 0);
  if (itens.length === 0) throw new Error("O pedido não tem itens.");

  return withRequest(async (request: sql.Request | RequestLike) => {
    // 1) Resolve cadastro e barras (read-only) reusando a mesma conexão.
    const cadastro = await resolveCadastro(request, clifor);
    if (!cadastro) throw new Error(`Cliente ${clifor} não encontrado no cadastro atacado (CLIENTES_ATACADO).`);
    const barras = await resolveBarras(request, itens.map((i) => i.ean));
    const linhas = montarLinhas(itens, barras);
    if (linhas.length === 0) throw new Error("Nenhum item pôde ser resolvido para o Linx.");

    const totQtde = linhas.reduce((s, l) => s + l.qtde, 0);
    const totValor = round2(linhas.reduce((s, l) => s + l.valor, 0));

    // Observação: preserva a do cliente + frete (o pedido atacado não tem campo de frete).
    const frete = Number(pedido.frete) || 0;
    const obsPartes = [trim(pedido.observacao)];
    if (frete > 0) obsPartes.push(`FRETE: R$ ${frete.toFixed(2).replace(".", ",")}`);
    const obs = obsPartes.filter(Boolean).join(" | ").slice(0, 4000);

    const req = request as sql.Request;
    const bind = (name: string, value: string | number) => req.input(name, value);

    // Cabeçalho
    bind("colecao", COLECAO_PEDIDO);
    bind("tab", cadastro.codigoTabPreco.slice(0, 2));
    bind("cond", cadastro.condicaoPgto.slice(0, 3));
    bind("filial", FILIAL_PEDIDO);
    bind("cliente", cadastro.nomeClifor.slice(0, 25));
    bind("transp", TRANSPORTADORA_PEDIDO);
    bind("aprovadoPor", APROVADO_POR);
    bind("obs", obs);
    bind("totQtde", totQtde);
    bind("totValor", totValor);

    // Itens
    const itemInserts: string[] = [];
    linhas.forEach((l, idx) => {
      bind(`p${idx}_prod`, l.produto.slice(0, 12));
      bind(`p${idx}_cor`, l.cor.slice(0, 10));
      bind(`p${idx}_qtde`, l.qtde);
      bind(`p${idx}_preco`, l.precoUnitario);
      bind(`p${idx}_valor`, l.valor);
      // Colunas VO/VE dinâmicas por posição da grade (nomes vêm de inteiros 1..48 — seguro).
      const voCols: string[] = [];
      const voVals: string[] = [];
      for (const [ordinal, qtd] of l.vo.entries()) {
        bind(`p${idx}_vo${ordinal}`, qtd);
        voCols.push(`VO${ordinal}`, `VE${ordinal}`);
        voVals.push(`@p${idx}_vo${ordinal}`, `@p${idx}_vo${ordinal}`);
      }
      // QTDE_LIQUIDA e VALOR_LIQUIDO são COLUNAS COMPUTADAS no Linx — não inserir.
      itemInserts.push(`
  INSERT INTO VENDAS_PRODUTO (
    PEDIDO, PRODUTO, COR_PRODUTO, ENTREGA, ITEM_PEDIDO,
    QTDE_ORIGINAL, QTDE_ENTREGAR,
    PRECO1, VALOR_ORIGINAL, VALOR_ENTREGAR,
    DATA_PARA_TRANSFERENCIA${voCols.length ? ", " + voCols.join(", ") : ""}
  ) VALUES (
    @PEDIDO, @p${idx}_prod, @p${idx}_cor, @agora, '0000',
    @p${idx}_qtde, @p${idx}_qtde,
    @p${idx}_preco, @p${idx}_valor, @p${idx}_valor,
    @agora${voVals.length ? ", " + voVals.join(", ") : ""}
  );`);
    });

    const batch = `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
  DECLARE @agora DATETIME = GETDATE();
  DECLARE @novo INT;
  UPDATE SEQUENCIAIS WITH (UPDLOCK, HOLDLOCK)
     SET @novo = CAST(SEQUENCIA AS INT) + 1,
         SEQUENCIA = CAST(CAST(SEQUENCIA AS INT) + 1 AS VARCHAR(12))
   WHERE TABELA_COLUNA = '${SEQ_KEY}';
  IF @novo IS NULL
  BEGIN
    ;THROW 51000, 'Sequencial de pedido (VENDAS.PEDIDO) não encontrado em SEQUENCIAIS.', 1;
  END
  DECLARE @PEDIDO CHAR(12) = CAST(@novo AS VARCHAR(12));

  INSERT INTO VENDAS (
    PEDIDO, COLECAO, CODIGO_TAB_PRECO, TIPO, CONDICAO_PGTO, FILIAL,
    CLIENTE_ATACADO, NOME_CLIFOR_ENTREGA, TRANSPORTADORA, TRANSP_REDESPACHO, MOEDA,
    REPRESENTANTE, GERENTE, EMISSAO, CADASTRAMENTO, DATA_PARA_TRANSFERENCIA,
    TABELA_FILHA, INDICADOR_VENDA, APROVADO_POR, TIPO_RATEIO,
    TOT_QTDE_ORIGINAL, TOT_QTDE_ENTREGAR, TOT_VALOR_ORIGINAL, TOT_VALOR_ENTREGAR, VALOR_SUB_ITENS,
    OBS
  ) VALUES (
    @PEDIDO, @colecao, @tab, 'VENDA ATACADO', @cond, @filial,
    @cliente, @cliente, @transp, @transp, 'R$',
    'SEM REPRESENTANTE', 'SEM REPRESENTANTE', @agora, @agora, @agora,
    'VENDAS_PRODUTO', 'V', @aprovadoPor, 0,
    @totQtde, @totQtde, @totValor, @totValor, @totValor,
    NULLIF(@obs, '')
  );
${itemInserts.join("\n")}

  COMMIT;
  SELECT LTRIM(RTRIM(@PEDIDO)) AS pedido;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  ;THROW;
END CATCH`;

    let result;
    try {
      result = await req.query(batch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Falha ao gravar o pedido no Linx: ${msg}`);
    }
    const row = (result.recordset as { pedido: string }[])[0];
    if (!row?.pedido) throw new Error("A gravação não retornou o número do pedido.");
    return { pedido: String(row.pedido).trim() };
  });
}
