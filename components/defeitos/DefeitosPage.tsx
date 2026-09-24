"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { useAuth } from "@/components/auth/AuthContext";
import {
  categoriaDoItem,
  planejarItensAgrupados,
} from "@/lib/utils/romaneio-agrupamento";
import styles from "./DefeitosPage.module.css";

// ───────────────────────────────── tipos ─────────────────────────────────

interface DefeitoRomaneio {
  romaneio: string;
  filialOrigem: string;
  emissao: string | null;
  responsavel: string;
  tipoRomaneio: string;
  linhas: number;
  qtdeSaida: number;
  qtdeConfirmada: number;
  linhasConfirmadas: number;
  cancelado: boolean;
}

interface DefeitoItem {
  produto: string;
  corProduto: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  grade: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  qtde: number;
  qtdeConfirmada: number | null;
  romaneioEntrada: string;
  custoUnitario: number;
  estoqueOrigem: number;
}

interface EntradaItem {
  produto: string;
  corProduto: string;
  descProduto: string;
  descCor: string;
  grade: string;
  linha: string;
  grupo: string;
  subgrupo: string;
  romaneio: string;
  romaneioEntrada: string;
  confirmadoEm: string;
  confirmadoPor: string;
  qtde: number;
  custoUnitario: number;
  custoTotal: number;
}

interface EntradaFilial {
  filialOrigem: string;
  qtde: number;
  custoTotal: number;
  itens: EntradaItem[];
}

interface EntradasResult {
  filiais: EntradaFilial[];
  totalQtde: number;
  totalCusto: number;
  ignorados: number;
  ambiguos: number;
  defeitoFilial: string;
}

type StatusFiltro = "todos" | "pendentes" | "parciais" | "confirmados";

// ──────────────────────────────── helpers ────────────────────────────────

const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const inteiro = (v: number) => v.toLocaleString("pt-BR");

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Datas do seletor de período como 'YYYY-MM-DD', nunca `toISOString()`.
 *
 * O servidor ancora o dia em UTC; mandar um instante ISO fazia o período andar
 * um dia (ver o bug de fuso nos filtros de período).
 */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function inicioDoMes(): string {
  const hoje = new Date();
  return ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
}

function hojeYmd(): string {
  return ymd(new Date());
}

function statusDoRomaneio(r: DefeitoRomaneio): {
  chave: Exclude<StatusFiltro, "todos">;
  label: string;
} {
  if (r.linhasConfirmadas === 0) return { chave: "pendentes", label: "Não confirmado" };
  if (r.linhasConfirmadas < r.linhas) return { chave: "parciais", label: "Parcial" };
  return { chave: "confirmados", label: "Confirmado" };
}

const chaveDoItem = (item: { produto: string; corProduto: string }) =>
  `${item.produto}|${item.corProduto}`;

// ───────────────────────────── componente ─────────────────────────────

interface DefeitosPageProps {
  companyKey: string;
  companyName: string;
}

export default function DefeitosPage({ companyKey, companyName }: DefeitosPageProps) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [defeitoFilial, setDefeitoFilial] = useState("");

  // ── lado esquerdo: romaneios
  const [romaneios, setRomaneios] = useState<DefeitoRomaneio[]>([]);
  const [carregandoRomaneios, setCarregandoRomaneios] = useState(true);
  const [erroRomaneios, setErroRomaneios] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [dias, setDias] = useState(180);
  const [status, setStatus] = useState<StatusFiltro>("todos");

  // ── romaneio aberto
  const [selecionado, setSelecionado] = useState<DefeitoRomaneio | null>(null);
  const [itens, setItens] = useState<DefeitoItem[]>([]);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [erroItens, setErroItens] = useState<string | null>(null);
  const [podeCorrigir, setPodeCorrigir] = useState(false);
  const [filtroItem, setFiltroItem] = useState("");

  /** Quantidade que o operador está corrigindo no ROMANEIO, por item. */
  const [correcoes, setCorrecoes] = useState<Map<string, number>>(new Map());
  /** Quantidade a CONFIRMAR na chegada, por item. */
  const [quantidades, setQuantidades] = useState<Map<string, number>>(new Map());
  const [salvandoChave, setSalvandoChave] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<Map<string, string>>(new Map());
  /** Itens em que a origem foi corrigida mas o destino não — aviso de risco. */
  const [falhasDestino, setFalhasDestino] = useState<Set<string>>(new Set());

  // ── confirmação
  const [confirmando, setConfirmando] = useState(false);
  const [erroConfirmacao, setErroConfirmacao] = useState<string | null>(null);
  const [msgConfirmacao, setMsgConfirmacao] = useState<string[]>([]);
  const [desconfirmandoChave, setDesconfirmandoChave] = useState<string | null>(null);

  // ── acrescentar item
  const [codigoBarras, setCodigoBarras] = useState("");
  const [adicionando, setAdicionando] = useState(false);

  // ── lado direito: entradas
  const [start, setStart] = useState(inicioDoMes);
  const [end, setEnd] = useState(hojeYmd);
  const [entradas, setEntradas] = useState<EntradasResult | null>(null);
  const [carregandoEntradas, setCarregandoEntradas] = useState(true);
  const [erroEntradas, setErroEntradas] = useState<string | null>(null);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  // ───────────────────────── carregamentos ─────────────────────────

  const carregarRomaneios = useCallback(async () => {
    if (!username) return;
    setCarregandoRomaneios(true);
    setErroRomaneios(null);
    try {
      const params = new URLSearchParams({ company: companyKey, dias: String(dias) });
      if (busca.trim()) params.set("search", busca.trim());
      const res = await fetch(`/api/defeitos/romaneios?${params.toString()}`, {
        cache: "no-store",
        headers: { "x-auth-username": username },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Erro ao carregar romaneios");
      setRomaneios(json.data ?? []);
      setDefeitoFilial(json.defeitoFilial ?? "");
    } catch (e) {
      setErroRomaneios(e instanceof Error ? e.message : "Erro ao carregar romaneios");
      setRomaneios([]);
    } finally {
      setCarregandoRomaneios(false);
    }
  }, [companyKey, username, dias, busca]);

  const carregarEntradas = useCallback(async () => {
    if (!username) return;
    setCarregandoEntradas(true);
    setErroEntradas(null);
    try {
      const params = new URLSearchParams({ company: companyKey, start, end });
      const res = await fetch(`/api/defeitos/entradas?${params.toString()}`, {
        cache: "no-store",
        headers: { "x-auth-username": username },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Erro ao carregar entradas");
      setEntradas(json as EntradasResult);
    } catch (e) {
      setErroEntradas(e instanceof Error ? e.message : "Erro ao carregar entradas");
      setEntradas(null);
    } finally {
      setCarregandoEntradas(false);
    }
  }, [companyKey, username, start, end]);

  const carregarItens = useCallback(
    async (romaneio: DefeitoRomaneio) => {
      if (!username) return;
      setCarregandoItens(true);
      setErroItens(null);
      setAvisos(new Map());
      try {
        const params = new URLSearchParams({
          company: companyKey,
          romaneio: romaneio.romaneio,
          filialOrigem: romaneio.filialOrigem,
        });
        const res = await fetch(`/api/defeitos/itens?${params.toString()}`, {
          cache: "no-store",
          headers: { "x-auth-username": username },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Erro ao carregar itens");
        const lista: DefeitoItem[] = json.data ?? [];
        setItens(lista);
        setPodeCorrigir(Boolean(json.podeCorrigir));
        setCorrecoes(new Map());
        // A quantidade a confirmar nasce igual à do romaneio: o caso comum é
        // chegar tudo, e quem divergir mexe só na linha que divergiu.
        setQuantidades(new Map(lista.map((i) => [chaveDoItem(i), i.qtde])));
      } catch (e) {
        setErroItens(e instanceof Error ? e.message : "Erro ao carregar itens");
        setItens([]);
      } finally {
        setCarregandoItens(false);
      }
    },
    [companyKey, username]
  );

  // A busca digitada espera o operador parar de digitar antes de ir ao banco.
  useEffect(() => {
    const t = setTimeout(() => {
      void carregarRomaneios();
    }, busca.trim() ? 400 : 0);
    return () => clearTimeout(t);
  }, [carregarRomaneios, busca]);

  useEffect(() => {
    void carregarEntradas();
  }, [carregarEntradas]);

  // ───────────────────────── ações ─────────────────────────

  const abrirRomaneio = useCallback(
    (r: DefeitoRomaneio) => {
      setSelecionado(r);
      setFiltroItem("");
      setErroConfirmacao(null);
      setMsgConfirmacao([]);
      setFalhasDestino(new Set());
      void carregarItens(r);
    },
    [carregarItens]
  );

  const fecharRomaneio = useCallback(() => {
    setSelecionado(null);
    setItens([]);
    setCorrecoes(new Map());
    setQuantidades(new Map());
    setAvisos(new Map());
    setFalhasDestino(new Set());
    setCodigoBarras("");
    setFiltroItem("");
    setErroConfirmacao(null);
    setMsgConfirmacao([]);
  }, []);

  const ajustarCorrecao = useCallback((item: DefeitoItem, delta: number) => {
    const chave = chaveDoItem(item);
    setCorrecoes((prev) => {
      const next = new Map(prev);
      const atual = next.get(chave) ?? item.qtde;
      next.set(chave, Math.max(0, atual + delta));
      return next;
    });
  }, []);

  const definirCorrecao = useCallback((item: DefeitoItem, valor: string) => {
    const chave = chaveDoItem(item);
    const n = parseInt(valor, 10);
    setCorrecoes((prev) => {
      const next = new Map(prev);
      next.set(chave, Number.isFinite(n) && n >= 0 ? n : 0);
      return next;
    });
  }, []);

  const definirQuantidade = useCallback((chave: string, valor: number) => {
    setQuantidades((prev) => new Map(prev).set(chave, Math.max(0, valor)));
  }, []);

  /**
   * `forcar` existe para o retry de falha parcial: quando a origem foi corrigida
   * e o destino não, a quantidade do romaneio JÁ é a nova, então sem isso o botão
   * nunca voltaria a aparecer e o saldo da filial de defeito ficaria errado.
   * Repetir é seguro: a origem não se mexe duas vezes (delta 0).
   */
  const salvarCorrecao = useCallback(
    async (item: DefeitoItem, forcar = false) => {
      if (!selecionado || !username) return;
      const chave = chaveDoItem(item);
      const qtdeNova = correcoes.get(chave) ?? (forcar ? item.qtde : undefined);
      if (qtdeNova === undefined || (qtdeNova === item.qtde && !forcar)) return;

      setSalvandoChave(chave);
      setAvisos((prev) => {
        const next = new Map(prev);
        next.delete(chave);
        return next;
      });

      try {
        const res = await fetch("/api/defeitos/item", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            company: companyKey,
            romaneio: selecionado.romaneio,
            filialOrigem: selecionado.filialOrigem,
            produto: item.produto,
            corProduto: item.corProduto,
            qtdeNova,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Erro ao corrigir o item");

        // A releitura vem ANTES de mostrar o resultado: ela zera os avisos, e na
        // ordem inversa a mensagem da correção apareceria e sumiria na hora.
        await carregarItens(selecionado);
        void carregarRomaneios();
        void carregarEntradas();

        const partes = [json.message as string];
        if (json.destino?.detalhe) partes.push(json.destino.detalhe as string);
        setAvisos((prev) => new Map(prev).set(chave, partes.filter(Boolean).join(" ")));
        // Origem certa e destino não: fica em vermelho e ganha o botão de concluir,
        // porque um aviso comum aqui faria o operador achar que acabou.
        setFalhasDestino((prev) => {
          const next = new Set(prev);
          if (json.destino?.modo === "falhou") next.add(chave);
          else next.delete(chave);
          return next;
        });
      } catch (e) {
        setAvisos((prev) =>
          new Map(prev).set(chave, e instanceof Error ? e.message : "Erro ao corrigir o item")
        );
      } finally {
        setSalvandoChave(null);
      }
    },
    [
      selecionado,
      username,
      correcoes,
      companyKey,
      carregarItens,
      carregarRomaneios,
      carregarEntradas,
    ]
  );

  /**
   * CONFIRMAR — mesma mecânica da tela Romaneios: UM romaneio de entrada na
   * filial de defeito para todos os itens, e depois a marca de confirmação item
   * por item. Quem confirmar MENOS do que o romaneio diz manda também a filial
   * de origem, e o servidor devolve a diferença ao estoque da loja.
   */
  const confirmarTudo = useCallback(async () => {
    if (!selecionado || !username || !defeitoFilial) return;

    const paraConfirmar = itens
      .filter((i) => i.qtdeConfirmada === null)
      .map((item) => {
        const chave = chaveDoItem(item);
        return {
          produto: item.produto,
          corProduto: item.corProduto,
          quantidade: quantidades.get(chave) ?? item.qtde,
          qtdeRomaneio: item.qtde,
          chave,
        };
      })
      .filter((i) => i.quantidade > 0);

    if (paraConfirmar.length === 0) return;

    setConfirmando(true);
    setErroConfirmacao(null);
    setMsgConfirmacao([]);

    try {
      // 1) Entrada de estoque na filial de defeito (um romaneio para o lote).
      const resEntrada = await fetch("/api/saidas-entradas-produtos/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          tipoOperacao: "entrada",
          companyKey,
          filial: defeitoFilial,
          itens: paraConfirmar.map((i) => ({
            produto: i.produto,
            corProduto: i.corProduto,
            quantidade: i.quantidade,
          })),
          tipoRomaneio: "TRANSFERENCIA ENTRE LOJAS",
          observacao: `DEFEITO ROMANEIO ${selecionado.romaneio} - ${selecionado.filialOrigem}`,
        }),
      });
      const jsonEntrada = await resEntrada.json().catch(() => ({}));
      if (!resEntrada.ok) {
        throw new Error(
          jsonEntrada?.error
            ? `Erro ao dar entrada em ${defeitoFilial}: ${jsonEntrada.error}`
            : `Erro ao dar entrada em ${defeitoFilial}.`
        );
      }
      const romaneioEntrada: string = jsonEntrada?.romaneio ?? "";

      // 2) Marca a confirmação de cada item. `filialOrigem` só vai no item
      //    divergente: é ele que dispara a devolução no servidor, e mandar em
      //    todos faria uma consulta extra por item sem precisar.
      const mensagens: string[] = [];
      if (romaneioEntrada) {
        mensagens.push(`Entrada registrada em ${defeitoFilial} — romaneio ${romaneioEntrada}.`);
      }

      for (const item of paraConfirmar) {
        const res = await fetch("/api/romaneio-confirmar-entrada", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            companyKey,
            romaneioId: selecionado.romaneio,
            filialDestino: defeitoFilial,
            produto: item.produto,
            corProduto: item.corProduto,
            qtdeConfirmada: item.quantidade,
            acao: "confirmar",
            filialOrigem:
              item.quantidade < item.qtdeRomaneio ? selecionado.filialOrigem : undefined,
            romaneioEntrada,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          mensagens.push(
            `${item.produto}: entrada feita, mas a confirmação não foi gravada${
              json?.error ? ` (${json.error})` : ""
            }.`
          );
        } else if (json?.origem?.detalhe) {
          mensagens.push(json.origem.detalhe as string);
        }
      }

      setMsgConfirmacao(mensagens);
      await carregarItens(selecionado);
      void carregarRomaneios();
      void carregarEntradas();
    } catch (e) {
      setErroConfirmacao(e instanceof Error ? e.message : "Erro ao confirmar.");
    } finally {
      setConfirmando(false);
    }
  }, [
    selecionado,
    username,
    defeitoFilial,
    itens,
    quantidades,
    companyKey,
    carregarItens,
    carregarRomaneios,
    carregarEntradas,
  ]);

  const desconfirmarItem = useCallback(
    async (item: DefeitoItem) => {
      if (!selecionado || !username || !defeitoFilial) return;
      const chave = chaveDoItem(item);
      setDesconfirmandoChave(chave);
      try {
        const res = await fetch("/api/romaneio-confirmar-entrada", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            companyKey,
            romaneioId: selecionado.romaneio,
            filialDestino: defeitoFilial,
            produto: item.produto,
            corProduto: item.corProduto,
            acao: "desconfirmar",
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error || "Erro ao zerar a confirmação");
        }
        await carregarItens(selecionado);
        void carregarRomaneios();
        void carregarEntradas();
      } catch (e) {
        setErroConfirmacao(e instanceof Error ? e.message : "Erro ao zerar a confirmação");
      } finally {
        setDesconfirmandoChave(null);
      }
    },
    [
      selecionado,
      username,
      defeitoFilial,
      companyKey,
      carregarItens,
      carregarRomaneios,
      carregarEntradas,
    ]
  );

  const acrescentarPorCodigo = useCallback(async () => {
    if (!selecionado || !username) return;
    const codigo = codigoBarras.trim();
    if (!codigo) return;

    setAdicionando(true);
    setErroItens(null);
    try {
      const params = new URLSearchParams({ codigoBarras: codigo, company: companyKey });
      const resBusca = await fetch(
        `/api/transferencia-produtos/produto-por-codigo-barras?${params.toString()}`,
        { cache: "no-store", headers: { "x-auth-username": username } }
      );
      const jsonBusca = await resBusca.json().catch(() => ({}));
      const achado = jsonBusca?.data as
        | { produto: string; corProduto: string | null }
        | undefined;
      if (!resBusca.ok || !achado?.produto) {
        throw new Error(`Código ${codigo} não encontrado no cadastro.`);
      }

      const res = await fetch("/api/defeitos/item", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          romaneio: selecionado.romaneio,
          filialOrigem: selecionado.filialOrigem,
          itens: [
            { produto: achado.produto, corProduto: achado.corProduto ?? "", quantidade: 1 },
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Erro ao acrescentar o item");

      setCodigoBarras("");
      await carregarItens(selecionado);
      void carregarRomaneios();
    } catch (e) {
      setErroItens(e instanceof Error ? e.message : "Erro ao acrescentar o item");
    } finally {
      setAdicionando(false);
    }
  }, [selecionado, username, codigoBarras, companyKey, carregarItens, carregarRomaneios]);

  const alternarFilial = useCallback((filial: string) => {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(filial)) next.delete(filial);
      else next.add(filial);
      return next;
    });
  }, []);

  // ───────────────────────── derivados ─────────────────────────

  const romaneiosFiltrados = useMemo(
    () =>
      status === "todos"
        ? romaneios
        : romaneios.filter((r) => statusDoRomaneio(r).chave === status),
    [romaneios, status]
  );

  const contagens = useMemo(() => {
    let pendentesN = 0;
    let parciais = 0;
    let confirmados = 0;
    for (const r of romaneios) {
      const s = statusDoRomaneio(r).chave;
      if (s === "pendentes") pendentesN += 1;
      else if (s === "parciais") parciais += 1;
      else confirmados += 1;
    }
    return { pendentesN, parciais, confirmados };
  }, [romaneios]);

  const normalizaBusca = (v: string | null | undefined) =>
    (v || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

  const itensFiltrados = useMemo(() => {
    const termo = normalizaBusca(filtroItem);
    if (!termo) return itens;
    return itens.filter(
      (i) =>
        normalizaBusca(i.descProduto).includes(termo) ||
        normalizaBusca(i.produto).includes(termo) ||
        normalizaBusca(i.codigoBarra).includes(termo)
    );
  }, [itens, filtroItem]);

  // Mesma organização da tabela do romaneio: banner por categoria e, dentro
  // dela, os de nome parecido juntos e em ordem de modelo.
  const itensPlanejados = useMemo(
    () => planejarItensAgrupados(itensFiltrados, companyKey),
    [itensFiltrados, companyKey]
  );

  const totalQtdeRomaneio = useMemo(() => itens.reduce((a, i) => a + i.qtde, 0), [itens]);
  const custoRomaneio = useMemo(
    () => itens.reduce((a, i) => a + i.qtde * i.custoUnitario, 0),
    [itens]
  );
  const naoConfirmados = useMemo(
    () => itens.filter((i) => i.qtdeConfirmada === null),
    [itens]
  );
  const podeConfirmarAgora =
    podeCorrigir &&
    !confirmando &&
    naoConfirmados.some((i) => (quantidades.get(chaveDoItem(i)) ?? i.qtde) > 0);

  // ───────────────────────── export XLSX ─────────────────────────

  const exportarXlsx = useCallback(() => {
    if (!entradas || entradas.filiais.length === 0) return;

    const wb = XLSX.utils.book_new();

    const cabecalho = [
      "Filial de origem",
      "Grupo",
      "Produto",
      "Descrição",
      "Cor",
      "Descrição da cor",
      "Subgrupo",
      "Grade",
      "Romaneio saída",
      "Romaneio entrada",
      "Qtd",
      "Custo unitário",
      "Custo total",
      "Confirmado em",
      "Confirmado por",
    ];

    // As linhas saem na MESMA ordem da tela: filial → categoria → nomes
    // parecidos juntos. A categoria vai em coluna (e não em linha de banner)
    // para o autofiltro e os SUMIF continuarem funcionando na planilha.
    const linhas: (string | number)[][] = [];
    for (const filial of entradas.filiais) {
      for (const entry of planejarItensAgrupados(filial.itens, companyKey)) {
        if (entry.kind !== "item") continue;
        const item = entry.item;
        linhas.push([
          filial.filialOrigem,
          categoriaDoItem(item, companyKey),
          item.produto,
          item.descProduto,
          item.corProduto,
          item.descCor,
          item.subgrupo,
          item.grade,
          item.romaneio,
          item.romaneioEntrada || "—",
          item.qtde,
          item.custoUnitario,
          item.custoTotal,
          formatarDataHora(item.confirmadoEm),
          item.confirmadoPor,
        ]);
      }
    }

    const meta = [
      [`Defeitos — ${entradas.defeitoFilial || defeitoFilial}`],
      [`Empresa: ${companyName}`],
      [`Período de confirmação: ${formatarData(start)} a ${formatarData(end)}`],
      [`Peças: ${entradas.totalQtde}    Custo total: ${moeda(entradas.totalCusto)}`],
      [],
    ];

    const ws = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.sheet_add_aoa(ws, [cabecalho, ...linhas], { origin: -1 });

    // Custo total como FÓRMULA (qtd × custo) e o total geral como SUM: a planilha
    // continua certa se alguém filtrar, reordenar ou corrigir uma quantidade.
    const primeiraLinha = meta.length + 2; // 1-based, logo abaixo do cabeçalho
    linhas.forEach((_, i) => {
      const r = primeiraLinha + i;
      ws[`M${r}`] = { t: "n", f: `K${r}*L${r}` };
    });
    const ultimaLinha = primeiraLinha + linhas.length - 1;
    if (linhas.length > 0) {
      const totalRow = ultimaLinha + 1;
      ws[`J${totalRow}`] = { t: "s", v: "TOTAL" };
      ws[`K${totalRow}`] = { t: "n", f: `SUM(K${primeiraLinha}:K${ultimaLinha})` };
      ws[`M${totalRow}`] = { t: "n", f: `SUM(M${primeiraLinha}:M${ultimaLinha})` };
      ws["!ref"] = `A1:O${totalRow}`;
    }

    ws["!cols"] = [
      { wch: 26 }, { wch: 20 }, { wch: 14 }, { wch: 42 }, { wch: 8 }, { wch: 20 },
      { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 15 }, { wch: 7 }, { wch: 14 },
      { wch: 14 }, { wch: 18 }, { wch: 18 },
    ];
    ws["!autofilter"] = { ref: `A${primeiraLinha - 1}:O${ultimaLinha}` };
    XLSX.utils.book_append_sheet(wb, ws, "Itens");

    // Aba 2 — total por filial, somando a aba de itens por SUMIF.
    const resumo: (string | number)[][] = entradas.filiais.map((f) => [
      f.filialOrigem,
      f.qtde,
      f.custoTotal,
      f.custoTotal,
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      [`Defeitos por filial — ${formatarData(start)} a ${formatarData(end)}`],
      [],
      ["Filial de origem", "Peças", "Custo total", "% do custo"],
      ...resumo,
    ]);

    const inicioResumo = 4; // 1-based
    const totalResumo = inicioResumo + resumo.length;
    resumo.forEach((_, i) => {
      const r = inicioResumo + i;
      ws2[`B${r}`] = { t: "n", f: `SUMIF(Itens!$A:$A,$A${r},Itens!$K:$K)` };
      ws2[`C${r}`] = { t: "n", f: `SUMIF(Itens!$A:$A,$A${r},Itens!$M:$M)` };
      ws2[`D${r}`] = {
        t: "n",
        f: `IF($C$${totalResumo}=0,0,C${r}/$C$${totalResumo})`,
        z: "0.0%",
      };
    });
    ws2[`A${totalResumo}`] = { t: "s", v: "TOTAL" };
    ws2[`B${totalResumo}`] = { t: "n", f: `SUM(B${inicioResumo}:B${totalResumo - 1})` };
    ws2[`C${totalResumo}`] = { t: "n", f: `SUM(C${inicioResumo}:C${totalResumo - 1})` };
    ws2["!ref"] = `A1:D${totalResumo}`;
    ws2["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Por filial");

    // Aba 3 — total por grupo, a mesma quebra que a tela mostra nos banners.
    const porGrupo = new Map<string, { qtde: number; custo: number }>();
    for (const filial of entradas.filiais) {
      for (const item of filial.itens) {
        const g = categoriaDoItem(item, companyKey);
        const atual = porGrupo.get(g) ?? { qtde: 0, custo: 0 };
        atual.qtde += item.qtde;
        atual.custo += item.custoTotal;
        porGrupo.set(g, atual);
      }
    }
    const grupos = [...porGrupo.entries()].sort((a, b) => b[1].custo - a[1].custo);
    const ws3 = XLSX.utils.aoa_to_sheet([
      [`Defeitos por grupo — ${formatarData(start)} a ${formatarData(end)}`],
      [],
      ["Grupo", "Peças", "Custo total"],
      ...grupos.map(([g, v]) => [g, v.qtde, v.custo]),
    ]);
    const inicioGrupo = 4;
    const totalGrupo = inicioGrupo + grupos.length;
    grupos.forEach((_, i) => {
      const r = inicioGrupo + i;
      ws3[`B${r}`] = { t: "n", f: `SUMIF(Itens!$B:$B,$A${r},Itens!$K:$K)` };
      ws3[`C${r}`] = { t: "n", f: `SUMIF(Itens!$B:$B,$A${r},Itens!$M:$M)` };
    });
    ws3[`A${totalGrupo}`] = { t: "s", v: "TOTAL" };
    ws3[`B${totalGrupo}`] = { t: "n", f: `SUM(B${inicioGrupo}:B${totalGrupo - 1})` };
    ws3[`C${totalGrupo}`] = { t: "n", f: `SUM(C${inicioGrupo}:C${totalGrupo - 1})` };
    ws3["!ref"] = `A1:C${totalGrupo}`;
    ws3["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Por grupo");

    XLSX.writeFile(wb, `defeitos-${companyKey}-${start}-a-${end}.xlsx`, { compression: true });
  }, [entradas, companyKey, companyName, start, end, defeitoFilial]);

  // ───────────────────────── render ─────────────────────────

  const COLUNAS_TABELA = 10;

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Defeitos</h1>
          <p className={styles.subtitle}>
            {defeitoFilial
              ? `Confirmação dos romaneios que vão para ${defeitoFilial} e o custo do que entrou lá.`
              : "Confirmação dos romaneios de defeito e o custo do que entrou na filial de defeito."}
          </p>
        </div>
      </header>

      {/* Com um romaneio aberto a tela vira coluna única: a tabela do romaneio
          tem dez colunas e não se lê em meia tela. */}
      <div className={`${styles.colunas} ${selecionado ? styles.colunaUnica : ""}`}>
        {/* ══════════════════ ROMANEIOS / ITENS ══════════════════ */}
        <section className={styles.painel}>
          {!selecionado ? (
            <>
              <div className={styles.painelHeader}>
                <h2 className={styles.painelTitulo}>Romaneios</h2>
                <span className={styles.contador}>
                  {inteiro(romaneiosFiltrados.length)} de {inteiro(romaneios.length)}
                </span>
              </div>

              <div className={styles.filtros}>
                <input
                  className={styles.input}
                  type="search"
                  placeholder="Buscar por romaneio, filial ou responsável"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                <select
                  className={styles.select}
                  value={dias}
                  onChange={(e) => setDias(Number(e.target.value))}
                >
                  <option value={90}>Últimos 90 dias</option>
                  <option value={180}>Últimos 180 dias</option>
                  <option value={365}>Último ano</option>
                </select>
              </div>

              <div className={styles.chips}>
                {(
                  [
                    ["todos", `Todos (${romaneios.length})`],
                    ["pendentes", `Não confirmados (${contagens.pendentesN})`],
                    ["parciais", `Parciais (${contagens.parciais})`],
                    ["confirmados", `Confirmados (${contagens.confirmados})`],
                  ] as [StatusFiltro, string][]
                ).map(([chave, label]) => (
                  <button
                    key={chave}
                    type="button"
                    className={`${styles.chip} ${status === chave ? styles.chipAtivo : ""}`}
                    onClick={() => setStatus(chave)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {erroRomaneios && <div className={styles.erro}>{erroRomaneios}</div>}

              {carregandoRomaneios ? (
                <div className={styles.vazio}>Carregando romaneios…</div>
              ) : romaneiosFiltrados.length === 0 ? (
                <div className={styles.vazio}>Nenhum romaneio neste recorte.</div>
              ) : (
                <ul className={styles.lista}>
                  {romaneiosFiltrados.map((r) => {
                    const st = statusDoRomaneio(r);
                    const divergente =
                      r.linhasConfirmadas > 0 && r.qtdeConfirmada !== r.qtdeSaida;
                    return (
                      <li key={`${r.romaneio}|${r.filialOrigem}`}>
                        <button
                          type="button"
                          className={styles.cardRomaneio}
                          onClick={() => abrirRomaneio(r)}
                        >
                          <div className={styles.cardLinha1}>
                            <strong className={styles.romaneioNum}>#{r.romaneio}</strong>
                            <span className={`${styles.badge} ${styles[`badge_${st.chave}`]}`}>
                              {st.label}
                            </span>
                          </div>
                          <div className={styles.cardFilial}>{r.filialOrigem}</div>
                          <div className={styles.cardLinha2}>
                            <span>{formatarData(r.emissao)}</span>
                            <span>{r.responsavel || "—"}</span>
                          </div>
                          <div className={styles.cardLinha3}>
                            <span>
                              {inteiro(r.qtdeSaida)} peça(s) · {inteiro(r.linhas)} item(ns)
                            </span>
                            {r.linhasConfirmadas > 0 && (
                              <span className={divergente ? styles.divergente : undefined}>
                                confirmado: {inteiro(r.qtdeConfirmada)}
                              </span>
                            )}
                          </div>
                          {r.cancelado && (
                            <div className={styles.cancelado}>Saída cancelada no Linx</div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className={styles.detalheTopo}>
                <button type="button" className={styles.voltar} onClick={fecharRomaneio}>
                  ← Romaneios
                </button>
                <div className={styles.detalheIdent}>
                  <strong className={styles.romaneioNum}>#{selecionado.romaneio}</strong>
                  <span className={styles.detalheFilial}>{selecionado.filialOrigem}</span>
                  <span className={styles.detalheMeta}>
                    {formatarData(selecionado.emissao)} · {selecionado.responsavel || "—"}
                  </span>
                </div>
                <div className={styles.detalheAcoes}>
                  <input
                    className={styles.inputFiltroItem}
                    type="search"
                    placeholder="Filtrar item por nome ou código"
                    value={filtroItem}
                    onChange={(e) => setFiltroItem(e.target.value)}
                  />
                  {podeCorrigir && (
                    <button
                      type="button"
                      className={styles.confirmarTudoBtn}
                      onClick={() => void confirmarTudo()}
                      disabled={!podeConfirmarAgora}
                      title={
                        naoConfirmados.length === 0
                          ? "Todos os itens já estão confirmados"
                          : `Dar entrada em ${defeitoFilial} e confirmar`
                      }
                    >
                      {confirmando
                        ? "Confirmando…"
                        : naoConfirmados.length === 0
                        ? "Tudo confirmado"
                        : `Confirmar ${naoConfirmados.length} item(ns)`}
                    </button>
                  )}
                </div>
              </div>

              <div className={styles.resumoRomaneio}>
                <span>
                  {inteiro(itens.length)} produto(s) • {inteiro(totalQtdeRomaneio)} peça(s) no
                  romaneio
                </span>
                <span>custo {moeda(custoRomaneio)}</span>
              </div>

              {podeCorrigir ? (
                <p className={styles.explicacao}>
                  <strong>Confirmar</strong> dá entrada em {defeitoFilial} pela quantidade que
                  chegou — se for menos do que o romaneio diz, a diferença volta para o estoque
                  de {selecionado.filialOrigem}. A coluna <strong>Qtd romaneio</strong> corrige
                  o próprio romaneio, e aí o estoque das duas pontas acompanha.
                </p>
              ) : (
                <p className={styles.explicacao}>
                  Somente leitura: sua função não confirma nem corrige romaneio.
                </p>
              )}

              {erroConfirmacao && <div className={styles.erro}>{erroConfirmacao}</div>}
              {erroItens && <div className={styles.erro}>{erroItens}</div>}
              {msgConfirmacao.length > 0 && (
                <div className={styles.sucesso}>
                  {msgConfirmacao.map((m, i) => (
                    <div key={i}>{m}</div>
                  ))}
                </div>
              )}

              {carregandoItens ? (
                <div className={styles.vazio}>Carregando itens…</div>
              ) : itens.length === 0 ? (
                <div className={styles.vazio}>Este romaneio não tem itens.</div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>PRODUTO</th>
                        <th>CÓD. BARRA</th>
                        <th>SUBGRUPO</th>
                        <th>GRADE</th>
                        <th>DESCRIÇÃO</th>
                        <th>COR</th>
                        <th className={styles.num}>QTD ROMANEIO</th>
                        <th className={styles.num}>CUSTO UN.</th>
                        <th className={styles.num}>ESTOQUE LOJA</th>
                        <th>CONFIRMAR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itensPlanejados.map((entry, idx) => {
                        if (entry.kind === "banner") {
                          return (
                            <tr
                              key={`banner-${entry.label}-${idx}`}
                              className={styles.groupBannerRow}
                            >
                              <td colSpan={COLUNAS_TABELA} className={styles.groupBannerCell}>
                                {entry.label}
                              </td>
                            </tr>
                          );
                        }

                        const item = entry.item;
                        const chave = chaveDoItem(item);
                        const confirmado = item.qtdeConfirmada !== null;
                        const qtdeConf = item.qtdeConfirmada ?? 0;
                        const divergenteConf = confirmado && qtdeConf !== item.qtde;

                        const correcao = correcoes.get(chave) ?? item.qtde;
                        const mudouCorrecao = correcao !== item.qtde;
                        const salvando = salvandoChave === chave;
                        const aviso = avisos.get(chave);

                        const qtdeAConfirmar = quantidades.get(chave) ?? item.qtde;
                        const divergenteInput = qtdeAConfirmar !== item.qtde;

                        return (
                          <tr
                            key={`${chave}-${idx}`}
                            className={`${confirmado ? styles.rowConfirmada : ""} ${
                              item.qtde === 0 ? styles.rowZerada : ""
                            }`}
                          >
                            <td>{item.produto}</td>
                            <td>{item.codigoBarra ?? "—"}</td>
                            <td>{item.subgrupo || "—"}</td>
                            <td>{item.grade || "—"}</td>
                            <td>{item.descProduto || "—"}</td>
                            <td>{item.descCor || item.corProduto || "—"}</td>

                            {/* Qtd do romaneio + correção (mexe nos dois estoques) */}
                            <td className={styles.num}>
                              <div className={styles.correcaoCell}>
                                {podeCorrigir ? (
                                  <div className={styles.stepper}>
                                    <button
                                      type="button"
                                      className={styles.stepBtn}
                                      disabled={salvando || correcao <= 0}
                                      onClick={() => ajustarCorrecao(item, -1)}
                                      aria-label="Diminuir"
                                    >
                                      −
                                    </button>
                                    <input
                                      className={styles.stepInput}
                                      type="number"
                                      min={0}
                                      value={correcao}
                                      disabled={salvando}
                                      onChange={(e) => definirCorrecao(item, e.target.value)}
                                    />
                                    <button
                                      type="button"
                                      className={styles.stepBtn}
                                      disabled={salvando}
                                      onClick={() => ajustarCorrecao(item, 1)}
                                      aria-label="Aumentar"
                                    >
                                      +
                                    </button>
                                  </div>
                                ) : (
                                  <span className={styles.qtdValue}>{item.qtde}</span>
                                )}

                                {mudouCorrecao && (
                                  <button
                                    type="button"
                                    className={styles.salvarCorrecaoBtn}
                                    disabled={salvando}
                                    onClick={() => void salvarCorrecao(item)}
                                  >
                                    {salvando ? "Salvando…" : `Corrigir ${item.qtde} → ${correcao}`}
                                  </button>
                                )}
                                {!mudouCorrecao && falhasDestino.has(chave) && (
                                  <button
                                    type="button"
                                    className={styles.salvarCorrecaoBtn}
                                    disabled={salvando}
                                    onClick={() => void salvarCorrecao(item, true)}
                                  >
                                    {salvando ? "Salvando…" : "Concluir correção"}
                                  </button>
                                )}
                                {aviso && (
                                  <div
                                    className={
                                      falhasDestino.has(chave)
                                        ? styles.avisoItemGrave
                                        : styles.avisoItem
                                    }
                                  >
                                    {aviso}
                                  </div>
                                )}
                              </div>
                            </td>

                            <td className={styles.num}>{moeda(item.custoUnitario)}</td>
                            <td className={styles.num}>
                              <span
                                className={
                                  item.estoqueOrigem === 0 ? styles.estoqueZero : styles.estoqueValor
                                }
                              >
                                {inteiro(item.estoqueOrigem)}
                              </span>
                            </td>

                            {/* Confirmação */}
                            <td className={styles.confirmarCell}>
                              {confirmado ? (
                                <div className={styles.confirmadoWrap}>
                                  <span
                                    className={
                                      divergenteConf
                                        ? styles.confirmadoBadgeDivergente
                                        : styles.confirmadoBadge
                                    }
                                  >
                                    ✓ {inteiro(qtdeConf)} confirmado
                                    {qtdeConf !== 1 ? "s" : ""}
                                  </span>
                                  {divergenteConf && (
                                    <span className={styles.originalBadge}>
                                      {qtdeConf < item.qtde
                                        ? `▼ faltou ${item.qtde - qtdeConf}`
                                        : `▲ excesso ${qtdeConf - item.qtde}`}
                                    </span>
                                  )}
                                  {item.romaneioEntrada && (
                                    <span className={styles.entradaTag}>
                                      entrada {item.romaneioEntrada}
                                    </span>
                                  )}
                                  {user?.role === "admin" && (
                                    <button
                                      type="button"
                                      className={styles.desfazerBtn}
                                      disabled={desconfirmandoChave === chave}
                                      onClick={() => void desconfirmarItem(item)}
                                    >
                                      {desconfirmandoChave === chave ? "..." : "Zerar"}
                                    </button>
                                  )}
                                </div>
                              ) : !podeCorrigir ? (
                                <span className={styles.naoConfirmado}>não confirmado</span>
                              ) : (
                                <div className={styles.qtdeInputWrap}>
                                  <div className={styles.qtdeInputRow}>
                                    <button
                                      type="button"
                                      className={styles.stepBtn}
                                      disabled={confirmando}
                                      onClick={() =>
                                        definirQuantidade(chave, qtdeAConfirmar - 1)
                                      }
                                    >
                                      −
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      className={styles.stepInput}
                                      value={qtdeAConfirmar}
                                      disabled={confirmando}
                                      onChange={(e) =>
                                        definirQuantidade(chave, parseInt(e.target.value, 10) || 0)
                                      }
                                    />
                                    <button
                                      type="button"
                                      className={styles.stepBtn}
                                      disabled={confirmando}
                                      onClick={() =>
                                        definirQuantidade(chave, qtdeAConfirmar + 1)
                                      }
                                    >
                                      +
                                    </button>
                                  </div>
                                  {divergenteInput && qtdeAConfirmar > 0 && (
                                    <div className={styles.divergenciaAviso}>
                                      {qtdeAConfirmar < item.qtde
                                        ? `⚠ Faltam ${item.qtde - qtdeAConfirmar} un. — voltam para a loja`
                                        : `⚠ Excesso de ${qtdeAConfirmar - item.qtde} un. (romaneio: ${item.qtde})`}
                                    </div>
                                  )}
                                  {qtdeAConfirmar === 0 && (
                                    <div className={styles.divergenciaAviso}>
                                      ⚠ Item não será confirmado
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {itens.length > 0 && itensPlanejados.length === 0 && (
                <div className={styles.vazio}>Nenhum item para o filtro informado.</div>
              )}

              {podeCorrigir && (
                <div className={styles.adicionar}>
                  <input
                    className={styles.input}
                    placeholder="Bipe o código de barras para acrescentar uma peça ao romaneio"
                    value={codigoBarras}
                    onChange={(e) => setCodigoBarras(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void acrescentarPorCodigo();
                    }}
                    disabled={adicionando}
                  />
                  <button
                    type="button"
                    className={styles.confirmarTudoBtn}
                    onClick={() => void acrescentarPorCodigo()}
                    disabled={adicionando || !codigoBarras.trim()}
                  >
                    {adicionando ? "Lançando…" : "Acrescentar"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ══════════════════ ENTRADAS / CUSTOS ══════════════════ */}
        <section className={styles.painel}>
          <div className={styles.painelHeader}>
            <h2 className={styles.painelTitulo}>Entrou em {defeitoFilial || "defeitos"}</h2>
            <button
              type="button"
              className={styles.exportar}
              onClick={exportarXlsx}
              disabled={!entradas || entradas.filiais.length === 0}
            >
              Exportar XLSX
            </button>
          </div>

          <div className={styles.filtros}>
            <label className={styles.campoData}>
              De
              <input
                className={styles.inputData}
                type="date"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className={styles.campoData}>
              Até
              <input
                className={styles.inputData}
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>

          <p className={styles.explicacao}>
            Só item confirmado, pela quantidade confirmada, contado pela data da confirmação —
            é quando a peça de fato entrou.
          </p>

          {erroEntradas && <div className={styles.erro}>{erroEntradas}</div>}

          {carregandoEntradas ? (
            <div className={styles.vazio}>Carregando entradas…</div>
          ) : !entradas || entradas.filiais.length === 0 ? (
            <div className={styles.vazio}>Nada confirmado neste período.</div>
          ) : (
            <>
              <div className={styles.kpis}>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Peças</span>
                  <strong className={styles.kpiValor}>{inteiro(entradas.totalQtde)}</strong>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Custo total</span>
                  <strong className={styles.kpiValor}>{moeda(entradas.totalCusto)}</strong>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Filiais</span>
                  <strong className={styles.kpiValor}>{entradas.filiais.length}</strong>
                </div>
              </div>

              {entradas.ignorados > 0 && (
                <div className={styles.nota}>
                  {inteiro(entradas.ignorados)} confirmação(ões) fora do recorte: o romaneio
                  de saída é de outra empresa ou já foi excluído.
                </div>
              )}

              {entradas.ambiguos > 0 && (
                <div className={styles.nota}>
                  {inteiro(entradas.ambiguos)} confirmação(ões) de fora dos totais: o número
                  do romaneio existe em mais de uma filial, então não há como dizer de qual
                  loja a peça veio.
                </div>
              )}

              <div className={styles.filiais}>
                {entradas.filiais.map((f) => {
                  const aberta = expandidas.has(f.filialOrigem);
                  const plano = aberta ? planejarItensAgrupados(f.itens, companyKey) : [];
                  return (
                    <div key={f.filialOrigem} className={styles.filialBloco}>
                      <button
                        type="button"
                        className={styles.filialHeader}
                        onClick={() => alternarFilial(f.filialOrigem)}
                      >
                        <span className={styles.filialSeta}>{aberta ? "▾" : "▸"}</span>
                        <span className={styles.filialNome}>{f.filialOrigem}</span>
                        <span className={styles.filialQtde}>{inteiro(f.qtde)} peça(s)</span>
                        <span className={styles.filialCusto}>{moeda(f.custoTotal)}</span>
                      </button>

                      {aberta && (
                        <div className={styles.tableWrap}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>PRODUTO</th>
                                <th>SUBGRUPO</th>
                                <th>GRADE</th>
                                <th>DESCRIÇÃO</th>
                                <th>COR</th>
                                <th>ROMANEIO</th>
                                <th className={styles.num}>QTD</th>
                                <th className={styles.num}>CUSTO UN.</th>
                                <th className={styles.num}>CUSTO TOTAL</th>
                                <th>CONFIRMADO</th>
                              </tr>
                            </thead>
                            <tbody>
                              {plano.map((entry, idx) => {
                                if (entry.kind === "banner") {
                                  return (
                                    <tr
                                      key={`b-${f.filialOrigem}-${entry.label}-${idx}`}
                                      className={styles.groupBannerRow}
                                    >
                                      <td colSpan={10} className={styles.groupBannerCell}>
                                        {entry.label}
                                      </td>
                                    </tr>
                                  );
                                }
                                const item = entry.item;
                                return (
                                  <tr key={`${item.produto}-${item.corProduto}-${item.romaneio}-${idx}`}>
                                    <td>{item.produto}</td>
                                    <td>{item.subgrupo || "—"}</td>
                                    <td>{item.grade || "—"}</td>
                                    <td>{item.descProduto || "—"}</td>
                                    <td>{item.descCor || item.corProduto || "—"}</td>
                                    <td>
                                      <div>#{item.romaneio}</div>
                                      {item.romaneioEntrada && (
                                        <div className={styles.celMeta}>
                                          ent. {item.romaneioEntrada}
                                        </div>
                                      )}
                                    </td>
                                    <td className={styles.num}>{inteiro(item.qtde)}</td>
                                    <td className={styles.num}>{moeda(item.custoUnitario)}</td>
                                    <td className={styles.num}>{moeda(item.custoTotal)}</td>
                                    <td>
                                      <div>{formatarDataHora(item.confirmadoEm)}</div>
                                      <div className={styles.celMeta}>{item.confirmadoPor}</div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan={6}>Total {f.filialOrigem}</td>
                                <td className={styles.num}>{inteiro(f.qtde)}</td>
                                <td />
                                <td className={styles.num}>{moeda(f.custoTotal)}</td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
