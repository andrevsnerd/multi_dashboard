import { NextResponse } from 'next/server';

import { fetchFilialProdutoSales } from '@/lib/repositories/performance';
import { fetchEstoqueRedePorProduto } from '@/lib/repositories/controleEstoque';
import { getControleEstoqueMetricasItensBatched } from '@/lib/server/controle-estoque-metricas';
import { buildControleEstoqueItemKey } from '@/lib/utils/controle-estoque-metricas';
import { ensureCompraCicloRuntime } from '@/lib/config/compra-ciclo-store';
import { calcCompraIdealFromResumo } from '@/lib/utils/compra-ideal';
import { fetchSalesTotals } from '@/lib/services/salesTotals';
import { VAREJO_VALUE, getFilialGroupMembers, type CompanyKey } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { normalizeRangeForQuery } from '@/lib/utils/date';

export const maxDuration = 300;

// Janelas de ritmo (em dias) — mesma ideia da imagem: 30/60/90/120 dias + 12 meses.
// A janela cobre os N dias ANTERIORES à data base (a data base em si fica de fora, pois
// costuma ser o "hoje" parcial).
const WINDOWS = [30, 60, 90, 120, 365] as const;

const MATRIZ_FILIAIS: Record<string, string[]> = {
  scarfme: ['SCARF ME - MATRIZ'],
  nerd: ['NERD'],
};

/** Soma/subtrai dias de uma data 'yyyy-MM-dd' no calendário (UTC-noon evita saltos de fuso/DST). */
function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Último dia do mês (1-12) como 'yyyy-MM-dd'. */
function lastDayOfMonth(ano: number, mes: number): string {
  const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${pad2(mes)}-${pad2(dia)}`;
}

/** Roda `fn` sobre a lista com no máximo `limite` chamadas simultâneas. */
async function mapLimit<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Lista vazia = dimensão não filtrada (os builders de filtro esperam null, não `[]`). */
function orNull(values: string[]): string[] | null {
  return values.length > 0 ? values : null;
}

function isValidYmd(value: string | null): value is string {
  if (!value) return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return !Number.isNaN(dt.getTime());
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company') as CompanyKey;
  const baseParam = searchParams.get('base');
  // Aceita repetido (?produto=a&produto=b) ou CSV (?produtos=a,b). Escopo por PRODUTO: todas
  // as cores do produto entram, e quem recorta cor é o filtro `cor` (dimensão).
  const produtoIds = Array.from(
    new Set(
      [...searchParams.getAll('produto'), ...(searchParams.get('produtos') ?? '').split(',')]
        .map((p) => p.trim())
        .filter(Boolean)
    )
  );

  // Busca livre por nome, igual ao Gerador de Relatórios: digitar "bandana" sem escolher
  // ninguém na lista recorta a projeção em TODOS os itens com esse nome (DESC_PRODUTO LIKE).
  const buscaProduto = (searchParams.get('busca') ?? '').trim();
  const temBusca = buscaProduto.length >= 2;

  // Recortes por dimensão do cadastro (um select por dimensão na tela, cada um repetível).
  const readDim = (name: string) =>
    Array.from(
      new Set(
        searchParams
          .getAll(name)
          .flatMap((v) => v.split(','))
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean)
      )
    );
  const dimensoes = {
    grupos: readDim('grupo'),
    linhas: readDim('linha'),
    subgrupos: readDim('subgrupo'),
    grades: readDim('grade'),
    colecoes: readDim('colecao'),
    cores: readDim('cor'),
    tipos: readDim('tipo'),
  };
  const temDimensao = Object.values(dimensoes).some((values) => values.length > 0);
  // Filial escolhida (nome canônico do grupo, VAREJO ou vazio = rede inteira). NÃO entra em
  // `dimensoes`: aquilo filtra PRODUTOS, isto restringe o universo de filiais consultado.
  const filialParam = searchParams.get('filial')?.trim() || null;
  // `produtos` (padrão) mede unidades vendidas; `tickets` mede a contagem de vendas.
  const metrica = searchParams.get('metrica') === 'tickets' ? 'tickets' : 'produtos';
  // Série MENSAL por item (produto × cor), e não só o total do escopo. É o que a visão
  // "item a item" e a importação de Compra Salva precisam. Fica atrás de um parâmetro
  // porque obriga as 24 consultas do ano a quebrarem por cor: num escopo largo (um GRUPO
  // inteiro) isso é caro, e a tela normal não usa o detalhe.
  const porItem = searchParams.get('porItem') === '1';

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" obrigatório' }, { status: 400 });
  }
  if (!isValidYmd(baseParam)) {
    return NextResponse.json({ error: 'Parâmetro "base" (yyyy-MM-dd) inválido' }, { status: 400 });
  }
  // Sem recorte algum a consulta é o TOTAL DA REDE — cenário válido (é o número que a
  // Projeção Compra compara com o recorte). Na métrica `produtos` isso muda a forma de
  // medir: ver `detalharItens` abaixo.
  const temEscopo = produtoIds.length > 0 || temDimensao || temBusca;
  // Cada produto/valor de filtro vira um PARÂMETRO na consulta, e o SQL Server aceita no
  // máximo ~2100 por request. Com "Selecionar tudo" ficou fácil passar disso, então o erro
  // é explícito (a tela mostra a mensagem) em vez de estourar no driver.
  const totalRecortes =
    produtoIds.length + Object.values(dimensoes).reduce((soma, values) => soma + values.length, 0);
  if (totalRecortes > 1500) {
    return NextResponse.json(
      {
        error: `Escopo muito amplo: ${totalRecortes} itens selecionados (limite 1500). Use um filtro mais largo — selecionar tudo de uma dimensão equivale a não filtrar por ela.`,
      },
      { status: 400 }
    );
  }

  const company = await resolveCompanyDynamic(companyKey);
  if (!company) {
    return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
  }

  // Escopo de vendas = REDE inteira (loja + e-commerce), como diz a legenda da planilha.
  // A Matriz não vende (fica de fora do ritmo). Nomes VIVOS via resolveCompanyDynamic.
  const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
  const matrizSet = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const todasFiliais = (company.filialFilters.sales ?? []).filter((f) => !matrizSet.has(f));

  // Recorte por filial. Uma loja escolhida traz o GRUPO INTEIRO em vendas: a Paulista trocou
  // de CNPJ 3x e o e-commerce reveza MSC/AKS — o histórico das pernas antigas é da mesma loja
  // e descartá-lo mataria a base do ano anterior, que é justamente o que o índice compara.
  // (No estoque a régua é outra, só a perna ativa, e quem cuida disso é a consulta de estoque.)
  let filiais = todasFiliais;
  if (filialParam === VAREJO_VALUE) {
    filiais = todasFiliais.filter((f) => !ecommerceFilials.has(f));
  } else if (filialParam) {
    const membros = new Set(getFilialGroupMembers(company, filialParam));
    filiais = todasFiliais.filter((f) => membros.has(f));
  }
  if (filialParam && filialParam !== VAREJO_VALUE && filiais.length === 0) {
    return NextResponse.json(
      { error: `Filial "${filialParam}" não pertence ao escopo de vendas da empresa` },
      { status: 400 }
    );
  }

  const posMembers = filiais.filter((f) => !ecommerceFilials.has(f));
  const ecomMembers = filiais.filter((f) => ecommerceFilials.has(f));

  // Escopo comum a todas as consultas: mesma lógica VALIDADA de vendas, só recortada.
  const escopo = {
    produtoIds: produtoIds.length > 0 ? produtoIds : null,
    produtoSearchTerm: temBusca ? buscaProduto : null,
    dimensoes,
    includePrevious: false as const,
    limit: 0,
  };
  // Mesmos recortes, na fonte canônica de totais/tickets. `linhasCadastro` (e não `linhas`)
  // porque o `linhas` de lá é o escopo legado da NERD e seria ignorado na Scarf Me.
  //
  // A contagem de ticket de `fetchSalesTotals` usa a identidade REAL (filial + número):
  // o número é sequencial por loja e, contado solto, fundia tickets de lojas diferentes.
  // Nesta tela a contagem É a métrica, e a distorção crescia com a janela (−9,9% em 30d a
  // −38,5% em 365d na NERD/ELETRONICOS), chegando a inverter o sinal do crescimento YoY
  // (mostrava −3,1% quando o real era +14,3%).
  //
  // A filial vai como LISTA quando o recorte é de loja física: `filial` sozinho gera
  // `f.FILIAL = @stFilial`, um CNPJ só, e a PAULISTA (que trocou de CNPJ em maio/2026)
  // apareceria "nascendo em maio" — jan-abr ficaram no CNPJ antigo. Grupo de e-commerce
  // continua indo por `filial`: ali `fetchSalesTotals` delega para o resumo de e-commerce,
  // que já soma o rodízio MSC↔AKS inteiro.
  const soEcommerce = posMembers.length === 0 && ecomMembers.length > 0;
  const escopoTickets = {
    company: companyKey,
    filial: soEcommerce ? filialParam : null,
    filiais: soEcommerce || !filialParam ? null : posMembers,
    grupos: dimensoes.grupos,
    linhasCadastro: dimensoes.linhas,
    subgrupos: dimensoes.subgrupos,
    grades: dimensoes.grades,
    colecoes: dimensoes.colecoes,
    cores: dimensoes.cores,
    tipos: dimensoes.tipos,
    produtoIds: produtoIds.length > 0 ? produtoIds : null,
    produtoSearchTerm: temBusca ? buscaProduto : null,
  };

  const anoBase = Number(baseParam.slice(0, 4));
  const mesBase = Number(baseParam.slice(5, 7));

  try {
    if (metrica === 'tickets') {
      // Uma consulta por janela + DUAS por mês (o realizado e a base do ano anterior).
      //
      // Por que não `comparisonMode: 'year'`, que traria as duas na mesma chamada: naquele
      // caminho o `ticketsPrevious` do E-COMMERCE está errado. `fetchSalesTotals` delega o
      // e-commerce a `fetchEcommerceSummary` sem repassar o `comparisonMode`, então o
      // "anterior" volta como o MÊS ANTERIOR e não o mesmo mês do ano passado — e isso
      // contamina tanto a filial de e-commerce quanto o total da rede da Scarf Me (que soma
      // varejo + e-commerce). Medido em 10/09/2026: a série "ano anterior" do e-commerce vinha
      // deslocada em um mês (jan/26 comparava com dez/25). Pedir o mês do ano anterior
      // explicitamente custa uma consulta a mais e vale para os três caminhos.
      const [janelas, meses] = await Promise.all([
        Promise.all(
          WINDOWS.map(async (dias) => {
            const range = normalizeRangeForQuery({
              start: addDaysYmd(baseParam, -dias),
              end: addDaysYmd(baseParam, -1),
            });
            const totais = await fetchSalesTotals({ ...escopoTickets, range });
            return [dias, Math.max(0, Math.round(totais.tickets))] as const;
          })
        ),
        mapLimit(
          Array.from({ length: 12 }, (_, i) => i + 1),
          4,
          async (mes) => {
            const chave = `${anoBase}-${pad2(mes)}`;
            const futuro = mes > mesBase;
            const parcial = mes === mesBase;
            const piso = (n: number) => Math.max(0, Math.round(n));
            // A base do crescimento é sempre o mês CHEIO do ano anterior.
            const rangeAnterior = normalizeRangeForQuery({
              start: `${anoBase - 1}-${pad2(mes)}-01`,
              end: lastDayOfMonth(anoBase - 1, mes),
            });

            const primeiro = `${anoBase}-${pad2(mes)}-01`;
            const ultimo = parcial ? addDaysYmd(baseParam, -1) : lastDayOfMonth(anoBase, mes);
            // Mês futuro (ou mês em curso com a data base no dia 1) não tem nada realizado:
            // basta a base do ano anterior.
            if (futuro || ultimo < primeiro) {
              const anterior = await fetchSalesTotals({ ...escopoTickets, range: rangeAnterior });
              return {
                mes: chave,
                qtde: 0,
                qtdeAnoAnterior: piso(anterior.tickets),
                parcial,
                futuro,
              };
            }

            const rangeAtual = normalizeRangeForQuery({ start: primeiro, end: ultimo });
            // Mês fechado ou em curso: o realizado é a janela do ano base e a base de
            // comparação é sempre o mês CHEIO do ano anterior (no mês em curso, senão
            // compararia 3 dias com 3 dias).
            const [atual, anterior] = await Promise.all([
              fetchSalesTotals({ ...escopoTickets, range: rangeAtual }),
              fetchSalesTotals({ ...escopoTickets, range: rangeAnterior }),
            ]);
            return {
              mes: chave,
              qtde: piso(atual.tickets),
              qtdeAnoAnterior: piso(anterior.tickets),
              parcial,
              futuro: false,
            };
          }
        ),
      ]);

      return NextResponse.json(
        {
          dataBase: baseParam,
          windows: WINDOWS,
          metrica,
          itens: [],
          totaisJanela: Object.fromEntries(janelas),
          mensal: meses,
          // Tickets é visão de fluxo: as contas de estoque não se aplicam.
          estoqueTotal: 0,
          estoqueItens: 0,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Uma consulta por janela (a maior é 365d), escopada aos produtos selecionados → leve.
    // Reusa a lógica VALIDADA de vendas (fetchFilialProdutoSales: POS com trocas + e-commerce).
    //
    // No total da rede (sem recorte) a lista item a item seria a rede inteira produto × cor —
    // dezenas de milhares de linhas numa resposta que a tela só usa para somar. Então ali o
    // total sai da soma direta das linhas e a quebra por cor sai da query.
    const detalharItens = temEscopo;
    // Recortada, cada janela é leve e as 5 vão juntas. Sem recorte cada uma varre a rede
    // inteira, então elas andam de duas em duas para não afogar o banco.
    //
    // O ESTOQUE do mesmo recorte vem junto, da fonte canônica da Estoque Consulta
    // (`fetchEstoqueRedePorProduto`: só saldos positivos, exclusões e escopo da empresa
    // aplicados) — a tela precisa dele para cobertura e compra sugerida, e medi-lo aqui
    // evita ter de baixar o catálogo inteiro no cliente só para somar estoque.
    const [perWindow, estoqueRows] = await Promise.all([
      mapLimit(Array.from(WINDOWS), temEscopo ? WINDOWS.length : 2, async (dias) => {
        const range = normalizeRangeForQuery({
          start: addDaysYmd(baseParam, -dias),
          end: addDaysYmd(baseParam, -1),
        });
        const rows = await fetchFilialProdutoSales(companyKey, posMembers, ecomMembers, range, 'month', {
          groupByCor: detalharItens,
          ...escopo,
        });
        return { dias, rows };
      }),
      fetchEstoqueRedePorProduto({
        company: companyKey,
        // Mesmo recorte das vendas. Sem filial é a rede inteira. A régua de filial do
        // ESTOQUE é a da perna ativa e quem aplica é o próprio repositório —
        // ver [[estoque-perna-ativa-vendas-grupo-inteiro]].
        filial: filialParam,
        grupos: orNull(dimensoes.grupos),
        linhas: orNull(dimensoes.linhas),
        subgrupos: orNull(dimensoes.subgrupos),
        grades: orNull(dimensoes.grades),
        colecoes: orNull(dimensoes.colecoes),
        cores: orNull(dimensoes.cores),
        tipos: orNull(dimensoes.tipos),
        produtoIds: produtoIds.length > 0 ? produtoIds : null,
        produtoSearchTerm: temBusca ? buscaProduto : null,
      }),
    ]);

    // Soma por item (produto × cor) somando as filiais; negativo nunca conta.
    const estoquePorItem = new Map<string, number>();
    estoqueRows.forEach((r) => {
      const key = `${r.produto}||${(r.corCodigo ?? '').trim()}`;
      estoquePorItem.set(
        key,
        (estoquePorItem.get(key) ?? 0) + Math.max(0, Number(r.positiveStock) || 0)
      );
    });
    let estoqueTotal = 0;
    let estoqueItens = 0;
    estoquePorItem.forEach((qtde) => {
      if (qtde <= 0) return;
      estoqueTotal += qtde;
      estoqueItens += 1;
    });
    estoqueTotal = Math.round(estoqueTotal);

    // Monta produto||cor → { metadata, d30, d60, ... }
    type ItemAcc = {
      produto: string;
      cor: string;
      corDescricao: string;
      descricao: string;
      codigoBarra: string;
      grade: string;
      subgrupo: string;
      /** Necessária para o ciclo de compra da regra "Ritmo Compra Ideal" (linha + subgrupo). */
      linha: string;
      colecao: string;
      qtde: Record<number, number>;
    };
    const acc = new Map<string, ItemAcc>();
    /** Soma EXATA da janela (o arredondamento fica no fim, nunca por linha). */
    const somaJanela = new Map<number, number>();

    perWindow.forEach(({ dias, rows }) => {
      somaJanela.set(
        dias,
        rows.reduce((soma, r) => soma + (Number(r.qtde ?? 0) || 0), 0)
      );
      if (!detalharItens) return;
      rows.forEach((r) => {
        const cor = (r.cor ?? '').trim();
        const key = `${r.produto}||${cor}`;
        let item = acc.get(key);
        if (!item) {
          item = {
            produto: r.produto,
            cor,
            corDescricao: r.corDescricao ?? '',
            descricao: r.descricao ?? '',
            codigoBarra: r.codigoBarra ?? '',
            grade: r.grade ?? '',
            subgrupo: r.subgrupo ?? '',
            linha: r.linha ?? '',
            colecao: r.colecao ?? '',
            qtde: {},
          };
          acc.set(key, item);
        }
        // Metadados chegam iguais em todas as janelas; preenche o que ainda faltar.
        if (!item.corDescricao && r.corDescricao) item.corDescricao = r.corDescricao;
        if (!item.descricao && r.descricao) item.descricao = r.descricao;
        if (!item.codigoBarra && r.codigoBarra) item.codigoBarra = r.codigoBarra;
        // Quantidade LÍQUIDA da janela, como veio da regra global (pode ser negativa quando
        // houve mais troca que venda). Não se aplica piso por item: descartar linha negativa
        // antes de somar infla o total — ver [[vendas-nunca-filtrar-linhas-da-regra-global]].
        // O piso 0 é aplicado no total do escopo, na tela.
        item.qtde[dias] = Math.round(Number(r.qtde ?? 0));
      });
    });

    // ── Série MENSAL: ano da data base + o mesmo mês do ano anterior, para a regra
    //    comparativa de crescimento (jan/26 x jan/25, fev x fev …). Meses ainda no futuro
    //    não são consultados (venda futura é sempre 0); do ano anterior vêm todos os 12.
    //    O mês da data base fecha em base−1, igual às janelas, então é PARCIAL.
    const mesesConsulta: Array<{ ano: number; mes: number }> = [];
    for (let mes = 1; mes <= 12; mes += 1) mesesConsulta.push({ ano: anoBase - 1, mes });
    for (let mes = 1; mes <= mesBase; mes += 1) mesesConsulta.push({ ano: anoBase, mes });

    // Sem filtro de cor não precisa quebrar por cor — o total do mês é o mesmo e a consulta
    // fica bem mais leve (some o join de PRODUTO_CORES). A visão item a item precisa da
    // quebra, então ali ela volta.
    const mensalPorCor = dimensoes.cores.length > 0 || porItem;
    /** produto||cor → 'yyyy-MM' → quantidade. Só preenchido no modo item a item. */
    const mensalPorItem = new Map<string, Map<string, number>>();

    const totaisMes = await mapLimit(mesesConsulta, 4, async ({ ano, mes }) => {
      const primeiro = `${ano}-${pad2(mes)}-01`;
      // No mês da data base a janela para no dia anterior à base (mês em curso, parcial).
      const ultimo =
        ano === anoBase && mes === mesBase ? addDaysYmd(baseParam, -1) : lastDayOfMonth(ano, mes);
      if (ultimo < primeiro) return { chave: `${ano}-${pad2(mes)}`, qtde: 0 };
      const range = normalizeRangeForQuery({ start: primeiro, end: ultimo });
      const rows = await fetchFilialProdutoSales(companyKey, posMembers, ecomMembers, range, 'month', {
        groupByCor: mensalPorCor,
        ...escopo,
      });
      const chave = `${ano}-${pad2(mes)}`;
      if (porItem) {
        rows.forEach((r) => {
          const key = `${r.produto}||${(r.cor ?? '').trim()}`;
          let porMes = mensalPorItem.get(key);
          if (!porMes) {
            porMes = new Map<string, number>();
            mensalPorItem.set(key, porMes);
          }
          porMes.set(chave, (porMes.get(chave) ?? 0) + Number(r.qtde ?? 0));
        });
      }
      const qtde = rows.reduce((soma, r) => soma + Number(r.qtde ?? 0), 0);
      return { chave, qtde: Math.round(qtde) };
    });

    const qtdePorMes = new Map(totaisMes.map(({ chave, qtde }) => [chave, qtde]));
    const mensal = Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      return {
        mes: `${anoBase}-${pad2(mes)}`,
        qtde: qtdePorMes.get(`${anoBase}-${pad2(mes)}`) ?? 0,
        qtdeAnoAnterior: qtdePorMes.get(`${anoBase - 1}-${pad2(mes)}`) ?? 0,
        /** Mês em curso: fechado só até a data base, não serve de base de crescimento. */
        parcial: mes === mesBase,
        futuro: mes > mesBase,
      };
    });

    // Piso 0 no TOTAL, não por item: linha negativa (mais troca que venda) entra na soma —
    // ver [[vendas-nunca-filtrar-linhas-da-regra-global]].
    const totaisJanela = Object.fromEntries(
      WINDOWS.map((dias) => [dias, Math.max(0, Math.round(somaJanela.get(dias) ?? 0))])
    );

    // A série mensal por item é o que a tela usa para projetar linha a linha. Num escopo
    // largo seriam milhares de linhas × 12 meses numa resposta que ninguém consegue ler,
    // então acima do teto ela não vai — e a tela DIZ que não foi, em vez de mostrar uma
    // tabela pela metade.
    const MAX_ITENS_MENSAL = 400;
    const porItemOmitido = porItem && acc.size > MAX_ITENS_MENSAL;
    const detalharMensalItem = porItem && !porItemOmitido;

    // ── Ritmo pela régua da COMPRA IDEAL (a mesma da Curva ABC) ─────────────────────
    // A regra "Ritmo Compra Ideal" da tela não mede venda por mês: mede o consumo/dia do
    // MAIOR trecho contínuo com estoque positivo, com os resgates de janela antiga e de
    // venda recente. Essa conta é a de `calcCompraIdeal`, e as métricas que ela consome
    // vêm do lote de `metricas-itens` — DUAS consultas agregadas para a lista inteira, não
    // uma por item (ver [[compra-sugerida-abc-conexao-perdida-n1-proxy]]).
    //
    // Só roda no modo item a item: o ritmo é POR ITEM e não existe versão agregada dele.
    const consumoIdealPorItem = new Map<string, number>();
    if (detalharMensalItem && acc.size > 0) {
      try {
        // Prazos de ciclo editáveis na tela "Ciclo de Compra" — carrega antes do loop.
        await ensureCompraCicloRuntime();
        const metricas = await getControleEstoqueMetricasItensBatched({
          company: companyKey,
          // Mesmo recorte de filial da tela. `null` = rede inteira.
          filial: filialParam,
          itens: Array.from(acc.values()).map((item) => ({
            produto: item.produto,
            corProduto: item.cor || null,
          })),
        });
        Array.from(acc.values()).forEach((item) => {
          const metricaKey = buildControleEstoqueItemKey(item.produto, item.cor || null);
          const resumo = metricas[metricaKey]?.resumo;
          if (!resumo) return;
          // `transitEntries` vazio de propósito: aqui se quer o RITMO DE VENDA, não a
          // sugestão de compra da Curva ABC. O trânsito abate a compra, não o consumo.
          const ideal = calcCompraIdealFromResumo(resumo, [], {
            linha: item.linha,
            subgrupo: item.subgrupo,
            company: companyKey,
          });
          consumoIdealPorItem.set(
            `${item.produto}||${item.cor}`,
            Math.max(0, Number(ideal.consumoDiario) || 0)
          );
        });
      } catch (erro) {
        // Falhar aqui não pode derrubar a projeção inteira: as outras regras seguem
        // funcionando e a tela avisa que esta ficou sem base.
        console.error('Projeção Compra: falha ao medir o ritmo da Compra Ideal', erro);
      }
    }

    const itens = Array.from(acc.values()).map((item) => {
      const key = `${item.produto}||${item.cor}`;
      const serie = mensalPorItem.get(key);
      return {
        produto: item.produto,
        cor: item.cor,
        corDescricao: item.corDescricao,
        descricao: item.descricao,
        codigoBarra: item.codigoBarra,
        grade: item.grade,
        subgrupo: item.subgrupo,
        colecao: item.colecao,
        janelas: Object.fromEntries(WINDOWS.map((d) => [d, item.qtde[d] ?? 0])),
        /** Estoque atual do item (só saldos positivos), da mesma fonte do total. */
        estoque: Math.round(estoquePorItem.get(key) ?? 0),
        /**
         * Consumo/dia pela régua da Compra Ideal (Curva ABC). `undefined` = não medido
         * (fora do modo item a item, ou o item não tem métrica de disponibilidade).
         */
        consumoIdeal: consumoIdealPorItem.has(key) ? consumoIdealPorItem.get(key) : undefined,
        mensal: detalharMensalItem
          ? Array.from({ length: 12 }, (_, i) => {
              const mes = i + 1;
              return {
                mes: `${anoBase}-${pad2(mes)}`,
                qtde: Math.round(serie?.get(`${anoBase}-${pad2(mes)}`) ?? 0),
                qtdeAnoAnterior: Math.round(serie?.get(`${anoBase - 1}-${pad2(mes)}`) ?? 0),
                parcial: mes === mesBase,
                futuro: mes > mesBase,
              };
            })
          : undefined,
      };
    });

    return NextResponse.json(
      {
        dataBase: baseParam,
        windows: WINDOWS,
        metrica,
        itens,
        totaisJanela,
        mensal,
        estoqueTotal,
        estoqueItens,
        porItem: detalharMensalItem,
        porItemOmitido,
        maxItensMensal: MAX_ITENS_MENSAL,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Erro em /api/projecao-compra:', error);
    return NextResponse.json({ error: 'Erro ao calcular projeção' }, { status: 500 });
  }
}
