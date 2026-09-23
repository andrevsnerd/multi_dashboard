"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { useAuth } from "@/components/auth/AuthContext";
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
  if (r.linhasConfirmadas === 0) return { chave: "pendentes", label: "Não conferido" };
  if (r.linhasConfirmadas < r.linhas) return { chave: "parciais", label: "Parcial" };
  return { chave: "confirmados", label: "Conferido" };
}

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
  /** Quantidade que o operador está digitando, por item. */
  const [pendentes, setPendentes] = useState<Map<string, number>>(new Map());
  const [salvandoChave, setSalvandoChave] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<Map<string, string>>(new Map());
  /** Itens em que a origem foi corrigida mas o destino não — aviso de risco. */
  const [falhasDestino, setFalhasDestino] = useState<Set<string>>(new Set());

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
        setItens(json.data ?? []);
        setPodeCorrigir(Boolean(json.podeCorrigir));
        setPendentes(new Map());
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

  const chaveDoItem = (item: DefeitoItem) => `${item.produto}|${item.corProduto}`;

  const abrirRomaneio = useCallback(
    (r: DefeitoRomaneio) => {
      setSelecionado(r);
      void carregarItens(r);
    },
    [carregarItens]
  );

  const fecharRomaneio = useCallback(() => {
    setSelecionado(null);
    setItens([]);
    setPendentes(new Map());
    setAvisos(new Map());
    setFalhasDestino(new Set());
    setCodigoBarras("");
  }, []);

  const ajustarPendente = useCallback(
    (item: DefeitoItem, delta: number) => {
      const chave = chaveDoItem(item);
      setPendentes((prev) => {
        const next = new Map(prev);
        const atual = next.get(chave) ?? item.qtde;
        next.set(chave, Math.max(0, atual + delta));
        return next;
      });
    },
    []
  );

  const definirPendente = useCallback((item: DefeitoItem, valor: string) => {
    const chave = chaveDoItem(item);
    const n = Number(valor);
    setPendentes((prev) => {
      const next = new Map(prev);
      next.set(chave, Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
      return next;
    });
  }, []);

  /**
   * `forcar` existe para o retry de falha parcial: quando a origem foi corrigida
   * e o destino não, a quantidade do romaneio JÁ é a nova, então sem isso o botão
   * nunca voltaria a aparecer e o saldo da filial de defeito ficaria errado.
   * Repetir é seguro: a origem não se mexe duas vezes (delta 0).
   */
  const salvarItem = useCallback(
    async (item: DefeitoItem, forcar = false) => {
      if (!selecionado || !username) return;
      const chave = chaveDoItem(item);
      const qtdeNova = pendentes.get(chave) ?? (forcar ? item.qtde : undefined);
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
      pendentes,
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

  // ───────────────────────── export XLSX ─────────────────────────

  const exportarXlsx = useCallback(() => {
    if (!entradas || entradas.filiais.length === 0) return;

    const wb = XLSX.utils.book_new();

    // Aba 1 — todos os itens, com a filial em coluna para filtrar/agrupar.
    const cabecalho = [
      "Filial de origem",
      "Romaneio saída",
      "Romaneio entrada",
      "Produto",
      "Descrição",
      "Cor",
      "Descrição da cor",
      "Grade",
      "Linha",
      "Grupo",
      "Subgrupo",
      "Qtd",
      "Custo unitário",
      "Custo total",
      "Conferido em",
      "Conferido por",
    ];

    const linhas: (string | number)[][] = [];
    for (const filial of entradas.filiais) {
      for (const item of filial.itens) {
        linhas.push([
          filial.filialOrigem,
          item.romaneio,
          item.romaneioEntrada || "—",
          item.produto,
          item.descProduto,
          item.corProduto,
          item.descCor,
          item.grade,
          item.linha,
          item.grupo,
          item.subgrupo,
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
      [`Período de conferência: ${formatarData(start)} a ${formatarData(end)}`],
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
      ws[`N${r}`] = { t: "n", f: `L${r}*M${r}` };
    });
    const ultimaLinha = primeiraLinha + linhas.length - 1;
    if (linhas.length > 0) {
      const totalRow = ultimaLinha + 1;
      ws[`K${totalRow}`] = { t: "s", v: "TOTAL" };
      ws[`L${totalRow}`] = { t: "n", f: `SUM(L${primeiraLinha}:L${ultimaLinha})` };
      ws[`N${totalRow}`] = { t: "n", f: `SUM(N${primeiraLinha}:N${ultimaLinha})` };
      ws["!ref"] = `A1:P${totalRow}`;
    }

    ws["!cols"] = [
      { wch: 26 }, { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 42 }, { wch: 8 },
      { wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 7 },
      { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
    ];
    ws["!autofilter"] = { ref: `A${primeiraLinha - 1}:P${ultimaLinha}` };
    XLSX.utils.book_append_sheet(wb, ws, "Itens");

    // Aba 2 — total por filial, somando a aba de itens por SUMIF.
    const resumoCab = ["Filial de origem", "Peças", "Custo total", "% do custo"];
    const resumo: (string | number)[][] = entradas.filiais.map((f) => [
      f.filialOrigem,
      f.qtde,
      f.custoTotal,
      f.custoTotal,
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      [`Defeitos por filial — ${formatarData(start)} a ${formatarData(end)}`],
      [],
      resumoCab,
      ...resumo,
    ]);

    const inicioResumo = 4; // 1-based
    resumo.forEach((_, i) => {
      const r = inicioResumo + i;
      ws2[`B${r}`] = { t: "n", f: `SUMIF(Itens!$A:$A,$A${r},Itens!$L:$L)` };
      ws2[`C${r}`] = { t: "n", f: `SUMIF(Itens!$A:$A,$A${r},Itens!$N:$N)` };
      ws2[`D${r}`] = {
        t: "n",
        f: `IF($C$${inicioResumo + resumo.length}=0,0,C${r}/$C$${inicioResumo + resumo.length})`,
        z: "0.0%",
      };
    });
    const totalResumo = inicioResumo + resumo.length;
    ws2[`A${totalResumo}`] = { t: "s", v: "TOTAL" };
    ws2[`B${totalResumo}`] = {
      t: "n",
      f: `SUM(B${inicioResumo}:B${totalResumo - 1})`,
    };
    ws2[`C${totalResumo}`] = {
      t: "n",
      f: `SUM(C${inicioResumo}:C${totalResumo - 1})`,
    };
    ws2["!ref"] = `A1:D${totalResumo}`;
    ws2["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Por filial");

    const nome = `defeitos-${companyKey}-${start}-a-${end}.xlsx`;
    XLSX.writeFile(wb, nome, { compression: true });
  }, [entradas, companyKey, companyName, start, end, defeitoFilial]);

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

  const totalItensRomaneio = useMemo(
    () => itens.reduce((acc, i) => acc + i.qtde, 0),
    [itens]
  );
  const custoRomaneio = useMemo(
    () => itens.reduce((acc, i) => acc + i.qtde * i.custoUnitario, 0),
    [itens]
  );

  // ───────────────────────── render ─────────────────────────

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Defeitos</h1>
          <p className={styles.subtitle}>
            {defeitoFilial
              ? `Conferência dos romaneios que vão para ${defeitoFilial} e o custo do que entrou lá.`
              : "Conferência dos romaneios de defeito e o custo do que entrou na filial de defeito."}
          </p>
        </div>
      </header>

      <div className={styles.colunas}>
        {/* ══════════════════ ESQUERDA ══════════════════ */}
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
                    ["pendentes", `Não conferidos (${contagens.pendentesN})`],
                    ["parciais", `Parciais (${contagens.parciais})`],
                    ["confirmados", `Conferidos (${contagens.confirmados})`],
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
                                conferido: {inteiro(r.qtdeConfirmada)}
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
              <div className={styles.painelHeader}>
                <button type="button" className={styles.voltar} onClick={fecharRomaneio}>
                  ← Romaneios
                </button>
                <span className={styles.contador}>
                  {inteiro(totalItensRomaneio)} peça(s) · {moeda(custoRomaneio)}
                </span>
              </div>

              <div className={styles.detalheCabecalho}>
                <strong className={styles.romaneioNum}>#{selecionado.romaneio}</strong>
                <span>{selecionado.filialOrigem}</span>
                <span>{formatarData(selecionado.emissao)}</span>
                <span>{selecionado.responsavel || "—"}</span>
              </div>

              {podeCorrigir ? (
                <p className={styles.explicacao}>
                  Corrigir a quantidade mexe no estoque de verdade: reduzir devolve a peça
                  a <strong>{selecionado.filialOrigem}</strong>, e se o item já foi conferido
                  o saldo de <strong>{defeitoFilial}</strong> acompanha.
                </p>
              ) : (
                <p className={styles.explicacao}>
                  Somente leitura: sua função não corrige quantidade de romaneio.
                </p>
              )}

              {erroItens && <div className={styles.erro}>{erroItens}</div>}

              {carregandoItens ? (
                <div className={styles.vazio}>Carregando itens…</div>
              ) : itens.length === 0 ? (
                <div className={styles.vazio}>Este romaneio não tem itens.</div>
              ) : (
                <div className={styles.itens}>
                  {itens.map((item) => {
                    const chave = chaveDoItem(item);
                    const valor = pendentes.get(chave) ?? item.qtde;
                    const mudou = valor !== item.qtde;
                    const salvando = salvandoChave === chave;
                    const aviso = avisos.get(chave);
                    return (
                      <div
                        key={chave}
                        className={`${styles.item} ${item.qtde === 0 ? styles.itemZerado : ""}`}
                      >
                        <div className={styles.itemInfo}>
                          <div className={styles.itemNome}>
                            {item.descProduto || item.produto}
                          </div>
                          <div className={styles.itemMeta}>
                            <span>{item.produto}</span>
                            {item.descCor && <span>{item.descCor}</span>}
                            {item.corProduto && <span>cor {item.corProduto}</span>}
                            {item.grade && <span>({item.grade})</span>}
                          </div>
                          <div className={styles.itemMeta}>
                            <span>custo {moeda(item.custoUnitario)}</span>
                            <span>estoque na loja: {inteiro(item.estoqueOrigem)}</span>
                            {item.qtdeConfirmada === null ? (
                              <span className={styles.naoConferido}>não conferido</span>
                            ) : (
                              <span className={styles.conferido}>
                                conferido: {inteiro(item.qtdeConfirmada)}
                                {item.romaneioEntrada
                                  ? ` (entrada ${item.romaneioEntrada})`
                                  : ""}
                              </span>
                            )}
                          </div>
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

                        <div className={styles.stepper}>
                          <button
                            type="button"
                            className={styles.stepBtn}
                            disabled={!podeCorrigir || salvando || valor <= 0}
                            onClick={() => ajustarPendente(item, -1)}
                            aria-label="Diminuir"
                          >
                            −
                          </button>
                          <input
                            className={styles.stepInput}
                            type="number"
                            min={0}
                            value={valor}
                            disabled={!podeCorrigir || salvando}
                            onChange={(e) => definirPendente(item, e.target.value)}
                          />
                          <button
                            type="button"
                            className={styles.stepBtn}
                            disabled={!podeCorrigir || salvando}
                            onClick={() => ajustarPendente(item, 1)}
                            aria-label="Aumentar"
                          >
                            +
                          </button>
                        </div>

                        <div className={styles.itemAcao}>
                          {mudou ? (
                            <button
                              type="button"
                              className={styles.salvar}
                              disabled={salvando}
                              onClick={() => void salvarItem(item)}
                            >
                              {salvando ? "Salvando…" : `Salvar ${item.qtde} → ${valor}`}
                            </button>
                          ) : falhasDestino.has(chave) ? (
                            <button
                              type="button"
                              className={styles.salvar}
                              disabled={salvando}
                              onClick={() => void salvarItem(item, true)}
                            >
                              {salvando ? "Salvando…" : "Concluir correção"}
                            </button>
                          ) : (
                            <span className={styles.semMudanca}>
                              {inteiro(item.qtde)} no romaneio
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {podeCorrigir && (
                <div className={styles.adicionar}>
                  <input
                    className={styles.input}
                    placeholder="Bipe o código de barras para acrescentar uma peça"
                    value={codigoBarras}
                    onChange={(e) => setCodigoBarras(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void acrescentarPorCodigo();
                    }}
                    disabled={adicionando}
                  />
                  <button
                    type="button"
                    className={styles.salvar}
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

        {/* ══════════════════ DIREITA ══════════════════ */}
        <section className={styles.painel}>
          <div className={styles.painelHeader}>
            <h2 className={styles.painelTitulo}>
              Entrou em {defeitoFilial || "defeitos"}
            </h2>
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
            Só item conferido, pela quantidade conferida, contado pela data da conferência
            — é quando a peça de fato entrou.
          </p>

          {erroEntradas && <div className={styles.erro}>{erroEntradas}</div>}

          {carregandoEntradas ? (
            <div className={styles.vazio}>Carregando entradas…</div>
          ) : !entradas || entradas.filiais.length === 0 ? (
            <div className={styles.vazio}>Nada conferido neste período.</div>
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
                        <div className={styles.tabelaScroll}>
                          <table className={styles.tabela}>
                            <thead>
                              <tr>
                                <th>Produto</th>
                                <th>Cor</th>
                                <th>Romaneio</th>
                                <th className={styles.num}>Qtd</th>
                                <th className={styles.num}>Custo un.</th>
                                <th className={styles.num}>Custo total</th>
                                <th>Conferido</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.itens.map((item, i) => (
                                <tr key={`${item.produto}|${item.corProduto}|${item.romaneio}|${i}`}>
                                  <td>
                                    <div className={styles.celNome}>
                                      {item.descProduto || item.produto}
                                    </div>
                                    <div className={styles.celMeta}>{item.produto}</div>
                                  </td>
                                  <td>
                                    <div className={styles.celNome}>{item.descCor || "—"}</div>
                                    <div className={styles.celMeta}>{item.corProduto}</div>
                                  </td>
                                  <td>
                                    <div className={styles.celNome}>#{item.romaneio}</div>
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
                                    <div className={styles.celNome}>
                                      {formatarDataHora(item.confirmadoEm)}
                                    </div>
                                    <div className={styles.celMeta}>{item.confirmadoPor}</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan={3}>Total {f.filialOrigem}</td>
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
