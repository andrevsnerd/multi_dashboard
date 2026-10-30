"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";

import base from "./AlterarPrecosPage.module.css";
import styles from "./ProgramarPrecosPage.module.css";

type CompanyKey = "nerd" | "scarfme";

interface CampoAlvo {
  key: string;
  origem: "PRODUTOS" | "PRODUTOS_PRECOS";
  campo: string;
  codigoTabela: string | null;
}

interface TabelaSelecionada {
  codigo: string;
  descricao: string;
  inativa: boolean;
  comRegistro: number;
  /** Tabela derivada: recalculada pelo Linx a partir desta base (só vem no modo cor). */
  base?: string | null;
}

interface ProdutoRow {
  /** Código do produto; no modo cor, `PRODUTO|COR`. */
  produto: string;
  descricao: string;
  inativo: boolean;
  /** Modo cor: o produto já é preço por cor no Linx (falso = aplicar converte). */
  variaPorCor?: boolean;
  v: Array<number | null>;
  sr: number[];
}

interface RespostaProdutos {
  rows: ProdutoRow[];
  campos: CampoAlvo[];
  tabelas: TabelaSelecionada[];
  total: number;
  truncated: boolean;
  naoEncontrados: string[];
  /** Modo cor: códigos de produto colados (não dizem a cor). */
  semCor?: string[];
}

type TarefaModo = "produto" | "cor";

type TarefaStatus = "pendente" | "agendada" | "executando" | "aplicada" | "erro";

interface TarefaAlteracao {
  produto: string;
  campoKey: string;
  valor: number;
  atual: number | null;
  tabela: string;
  tabelaDesc: string;
}

interface Tarefa {
  id: string;
  nome: string;
  modo?: TarefaModo;
  status: TarefaStatus;
  agendadoPara: string | null;
  agendadoPor: string | null;
  produtos: Array<{ produto: string; descricao: string }>;
  alteracoes: TarefaAlteracao[];
  criadoPor: string;
  criadoEm: string;
  executadoPor: string | null;
  executadoEm: string | null;
  lote: string | null;
  erro: string | null;
}

interface Resultado {
  lote: string;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
  erros: string[];
  /** Modo cor: produtos que viraram preço por cor neste lote. */
  convertidos?: string[];
  desconvertidos?: string[];
}

interface HistoricoLote {
  lote: string;
  data: string;
  usuario: string;
  alteracoes: number;
  produtos: number;
  campos: string[];
  obs: string | null;
  reverteLote: string | null;
  revertidoPor: string | null;
  /** Lote de preço por cor (NERD_PRECO_COR_HISTORICO, prefixo PRCC). */
  porCor?: boolean;
  convertidos?: number;
}

interface LoteLinha {
  produto: string;
  cor?: string;
  descricao: string;
  tabela: string;
  tabelaDesc: string;
  slot: number;
  precoAntes: number | null;
  precoDepois: number | null;
  liquidoAntes: number | null;
  liquidoDepois: number | null;
}

/** Valor digitado: absoluto ("119,90") ou percentual com sinal ("-20%", "+10%"). */
type Entrada = { tipo: "abs"; valor: number } | { tipo: "pct"; pct: number };

interface Props {
  companyKey: CompanyKey;
}

// ───────────────────────── helpers ─────────────────────────

const GRUPOS_VISIVEIS = 30;

function fmt(valor: number | null | undefined): string {
  const n = valor ?? 0;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mesmoValor(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.005;
}

function separarCodigos(texto: string): string[] {
  return texto
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseNumero(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const normalizado = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Percentual exige sinal: "20%" sozinho é ambíguo numa tela de desconto (é aumento ou
 * desconto?), então fica inválido em vez de adivinhar. `undefined` = campo vazio.
 */
function parseEntrada(texto: string): Entrada | null | undefined {
  const t = (texto ?? "").trim().replace(/\s+/g, "");
  if (!t) return undefined;
  const pct = /^([+-])(\d+(?:[.,]\d+)?)%$/.exec(t);
  if (pct) {
    const n = parseNumero(pct[2]);
    if (n === null) return null;
    const v = pct[1] === "-" ? -n : n;
    return v <= -100 ? null : { tipo: "pct", pct: v };
  }
  if (t.includes("%")) return null;
  const n = parseNumero(t.replace(/^R\$/i, ""));
  return n === null || n < 0 ? null : { tipo: "abs", valor: n };
}

/**
 * Campo "Desconto %": aceita "60", "60%", "60,5" (o sinal é implícito — é desconto).
 * `undefined` = campo vazio; `null` = inválido (fora de 0–100).
 */
function parseDesconto(texto: string): Entrada | null | undefined {
  const t = (texto ?? "").trim().replace(/[\s%-]/g, "");
  if (!t) return undefined;
  const n = parseNumero(t);
  if (n === null || n <= 0 || n >= 100) return null;
  return { tipo: "pct", pct: -n };
}

/** Chaves de texto dos campos que valem para a tabela inteira (não para um grupo). */
function ehChaveTabela(chave: string): boolean {
  return chave.startsWith("TODOS||") || chave.startsWith("DESC||");
}

function calcular(entrada: Entrada, atual: number | null): number | null {
  if (entrada.tipo === "abs") return Math.round(entrada.valor * 100) / 100;
  if (atual === null) return null;
  return Math.round(atual * (1 + entrada.pct / 100) * 100) / 100;
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Hora do histórico do Linx: DATA_ALTERACAO é GETDATE() (hora de Brasília) e o driver a
 * entrega rotulada como UTC. Formatar em UTC devolve exatamente o relógio gravado.
 */
function dataLinx(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
}

/** Date → valor de `<input type="datetime-local">` no fuso do navegador. */
function paraInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function variacao(atual: number | null, novo: number | null): { texto: string; neg: boolean } | null {
  if (atual === null || novo === null || mesmoValor(atual, novo)) return null;
  const dif = novo - atual;
  const pct = atual !== 0 ? (dif / atual) * 100 : null;
  const sinal = dif > 0 ? "+" : "−";
  const pctTxt =
    pct === null ? "" : ` (${sinal}${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`;
  return { texto: `${sinal}R$ ${fmt(Math.abs(dif))}${pctTxt}`, neg: dif < 0 };
}

const STATUS_LABEL: Record<TarefaStatus, string> = {
  pendente: "Pendente",
  agendada: "Agendada",
  executando: "Aplicando…",
  aplicada: "Aplicada",
  erro: "Erro",
};

const STATUS_CLASSE: Record<TarefaStatus, string> = {
  pendente: styles.statusPendente,
  agendada: styles.statusAgendada,
  executando: styles.statusExecutando,
  aplicada: styles.statusAplicada,
  erro: styles.statusErro,
};

// ───────────────────────── componente ─────────────────────────

export default function ProgramarPrecosPage({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const api = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const res = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-auth-username": username, ...(init.headers ?? {}) },
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json };
    },
    [username]
  );

  // ── editor ──
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [codigosTexto, setCodigosTexto] = useState("");
  /**
   * Preço por cor: cada código de barras altera só a cor dele (PRODUTOS_PRECO_COR). Produto
   * que ainda é "por produto" é convertido na aplicação. Desligado = preço do produto inteiro.
   */
  const [modoCor, setModoCor] = useState(false);
  /** Modo por produto: produtos que já são preço por cor — a alteração não chegaria ao PDV. */
  const [variaCorSet, setVariaCorSet] = useState<Set<string>>(new Set());
  const [dados, setDados] = useState<RespostaProdutos | null>(null);
  const [codigosLidos, setCodigosLidos] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [mostrarZerados, setMostrarZerados] = useState(false);
  /** Tabelas que a tarefa altera (código da tabela). Só elas ganham campo de valor novo. */
  const [tabelasMarcadas, setTabelasMarcadas] = useState<string[]>([]);
  /** Preço novo planejado por `produto||campoKey`. */
  const [novos, setNovos] = useState<Record<string, number>>({});
  /** Texto digitado em cada campo (grupo×tabela ou "todos"×tabela) enquanto edita. */
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [removidos, setRemovidos] = useState<string[]>([]);
  const [gruposAbertos, setGruposAbertos] = useState<string[]>([]);
  const [verTodosGrupos, setVerTodosGrupos] = useState(false);
  const [verAlteracoes, setVerAlteracoes] = useState(false);
  const [quandoModo, setQuandoModo] = useState<"pendente" | "agendar">("pendente");
  const [quandoValor, setQuandoValor] = useState("");
  const [salvando, setSalvando] = useState(false);

  // ── tarefas ──
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [mostrarAplicadas, setMostrarAplicadas] = useState(false);
  const [podeExecutar, setPodeExecutar] = useState(false);
  const [agendamentoIndisponivel, setAgendamentoIndisponivel] = useState<string | null>(null);
  const [tarefaAberta, setTarefaAberta] = useState<string | null>(null);
  const [agendandoId, setAgendandoId] = useState<string | null>(null);
  const [agendaValor, setAgendaValor] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmarTarefa, setConfirmarTarefa] = useState<Tarefa | null>(null);
  const [confirmado, setConfirmado] = useState(false);

  // ── histórico ──
  const [historico, setHistorico] = useState<HistoricoLote[]>([]);
  const [limiteHistorico, setLimiteHistorico] = useState(30);
  const [buscaHistorico, setBuscaHistorico] = useState("");
  const [loteAberto, setLoteAberto] = useState<string | null>(null);
  const [lotesCache, setLotesCache] = useState<Record<string, LoteLinha[]>>({});
  /** Lotes por cor: frase de cada produto convertido/desconvertido, para o detalhe. */
  const [lotesConvertidos, setLotesConvertidos] = useState<Record<string, string[]>>({});

  // ── mensagens ──
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ titulo: string; r: Resultado } | null>(null);

  // ───────── cargas ─────────

  const carregarTarefas = useCallback(async () => {
    if (!username) return;
    const qs = new URLSearchParams({ company: companyKey });
    if (mostrarAplicadas) qs.set("aplicadas", "1");
    const { ok, json } = await api(`/api/precos/tarefas?${qs}`);
    if (!ok) {
      setErro(json?.error ?? "Erro ao carregar tarefas.");
      return;
    }
    setTarefas(Array.isArray(json.tarefas) ? json.tarefas : []);
    setPodeExecutar(Boolean(json.podeExecutar));
    setAgendamentoIndisponivel(json.agendamentoIndisponivel ?? null);
  }, [api, username, companyKey, mostrarAplicadas]);

  /** Lotes por produto (NERD_PRECO_HISTORICO) + por cor (NERD_PRECO_COR_HISTORICO), juntos por data. */
  const carregarHistorico = useCallback(async () => {
    if (!username) return;
    const [porProduto, porCor] = await Promise.all([
      api(`/api/precos/historico?company=${companyKey}&limite=${limiteHistorico}`),
      api(`/api/precos/tarefas/historico-cor?company=${companyKey}&limite=${limiteHistorico}`),
    ]);
    const lotes: HistoricoLote[] = [
      ...(porProduto.ok && Array.isArray(porProduto.json.lotes) ? porProduto.json.lotes : []),
      ...(porCor.ok && Array.isArray(porCor.json.lotes) ? porCor.json.lotes : []),
    ];
    lotes.sort((a, b) => b.data.localeCompare(a.data));
    setHistorico(lotes.slice(0, limiteHistorico));
  }, [api, username, companyKey, limiteHistorico]);

  useEffect(() => {
    void carregarTarefas();
  }, [carregarTarefas]);

  useEffect(() => {
    void carregarHistorico();
  }, [carregarHistorico]);

  // Tarefa agendada vira "aplicada" sozinha no servidor: recarrega quando o horário passa.
  useEffect(() => {
    const proxima = tarefas
      .filter((t) => t.status === "agendada" && t.agendadoPara)
      .map((t) => new Date(t.agendadoPara!).getTime())
      .filter((ms) => ms > Date.now())
      .sort((a, b) => a - b)[0];
    if (!proxima) return;
    const espera = Math.min(proxima - Date.now() + 45_000, 2_147_000_000);
    const timer = window.setTimeout(() => {
      void carregarTarefas();
      void carregarHistorico();
    }, espera);
    return () => window.clearTimeout(timer);
  }, [tarefas, carregarTarefas, carregarHistorico]);

  // ───────── editor: carregar produtos ─────────

  const limparEditor = useCallback(() => {
    setEditandoId(null);
    setNome("");
    setCodigosTexto("");
    setDados(null);
    setTabelasMarcadas([]);
    setNovos({});
    setTextos({});
    setRemovidos([]);
    setGruposAbertos([]);
    setQuandoModo("pendente");
    setQuandoValor("");
  }, []);

  const carregarProdutos = useCallback(
    async (
      codigos: string[],
      preset?: { novos: Record<string, number>; marcadas: string[] },
      /** Força o modo (abrir tarefa/lote salvo); sem isso vale o interruptor da tela. */
      modoForcado?: boolean
    ) => {
      if (codigos.length === 0) {
        setErro("Cole pelo menos um código de barras ou código de produto.");
        return;
      }
      const cor = modoForcado ?? modoCor;
      setCarregando(true);
      setErro(null);
      try {
        // Lista colada vale como está: sem escopo de empresa e com inativos, para nenhum
        // código sumir calado (o que não existe aparece em "não encontrados").
        const { ok, json } = cor
          ? await api("/api/precos/tarefas/produtos-cor", {
              method: "POST",
              body: JSON.stringify({ company: companyKey, codigos }),
            })
          : await api("/api/precos/produtos", {
              method: "POST",
              body: JSON.stringify({ company: companyKey, codigos, incluirInativos: true, todoCadastro: true }),
            });
        if (!ok) {
          setErro(json?.error ?? "Erro ao carregar os produtos.");
          return;
        }
        const resposta = json as RespostaProdutos;
        // Por produto: quem já é preço por cor no Linx não recebe a alteração no PDV.
        let varia = new Set<string>();
        if (!cor && resposta.rows.length > 0) {
          const v = await api("/api/precos/tarefas/varia-cor", {
            method: "POST",
            body: JSON.stringify({ produtos: resposta.rows.map((r) => r.produto) }),
          });
          if (v.ok) varia = new Set<string>(v.json.variaPorCor ?? []);
        }
        setModoCor(cor);
        setVariaCorSet(varia);
        setDados(resposta);
        setCodigosLidos(new Set(codigos).size);
        setRemovidos([]);
        setTextos({});
        setGruposAbertos([]);
        setVerTodosGrupos(false);
        setNovos(preset?.novos ?? {});
        setTabelasMarcadas(preset?.marcadas ?? []);
      } catch {
        setErro("Falha de conexão ao carregar os produtos.");
      } finally {
        setCarregando(false);
      }
    },
    [api, companyKey, modoCor]
  );

  // ───────── índices ─────────

  const rows = useMemo(() => dados?.rows ?? [], [dados]);
  const removidosSet = useMemo(() => new Set(removidos), [removidos]);
  const rowsAtivas = useMemo(() => rows.filter((r) => !removidosSet.has(r.produto)), [rows, removidosSet]);

  const indicePorCampo = useMemo(() => {
    const mapa = new Map<string, number>();
    (dados?.campos ?? []).forEach((c, i) => mapa.set(c.key, i));
    return mapa;
  }, [dados]);

  const temRegistro = useCallback(
    (row: ProdutoRow, campoKey: string) => {
      const i = indicePorCampo.get(campoKey);
      return i !== undefined && !row.sr.includes(i);
    },
    [indicePorCampo]
  );

  const valorDe = useCallback(
    (row: ProdutoRow, campoKey: string): number | null => {
      const i = indicePorCampo.get(campoKey);
      if (i === undefined || row.sr.includes(i)) return null;
      return row.v[i] ?? null;
    },
    [indicePorCampo]
  );

  const descTabela = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const t of dados?.tabelas ?? []) mapa.set(t.codigo, t.descricao);
    return mapa;
  }, [dados]);

  /**
   * Tabelas que aparecem na tela — mesmo critério do Linx e do Alterar Custo / Preço:
   * esconde tabela inativa e tabela zerada em todos os produtos, até pedir para mostrar.
   */
  const tabelasVisiveis = useMemo(() => {
    const out: Array<{ codigo: string; descricao: string; inativa: boolean; itens: number; min: number; max: number }> = [];
    for (const t of dados?.tabelas ?? []) {
      const campoKey = `T::${t.codigo}::PRECO1`;
      if (!indicePorCampo.has(campoKey)) continue;
      let itens = 0;
      let comValor = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const row of rowsAtivas) {
        if (!temRegistro(row, campoKey)) continue;
        itens += 1;
        const v = valorDe(row, campoKey) ?? 0;
        if (v !== 0) comValor += 1;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      if (itens === 0) continue;
      const marcada = tabelasMarcadas.includes(t.codigo);
      if (!mostrarZerados && !marcada && (t.inativa || comValor === 0)) continue;
      out.push({ codigo: t.codigo, descricao: t.descricao, inativa: t.inativa, itens, min, max });
    }
    return out.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [dados, indicePorCampo, rowsAtivas, temRegistro, valorDe, mostrarZerados, tabelasMarcadas]);

  const marcadasSet = useMemo(() => new Set(tabelasMarcadas), [tabelasMarcadas]);

  /**
   * Grupos: produtos com o MESMO preço em cada tabela marcada (ou em todas as visíveis,
   * antes de marcar). É o que permite digitar uma vez por grupo, mesmo com nomes diferentes.
   */
  const grupos = useMemo(() => {
    const base = tabelasMarcadas.length > 0 ? tabelasMarcadas : tabelasVisiveis.map((t) => t.codigo);
    const mapa = new Map<string, ProdutoRow[]>();
    for (const row of rowsAtivas) {
      const sig = base
        .map((cod) => {
          const ck = `T::${cod}::PRECO1`;
          return `${cod}=${temRegistro(row, ck) ? (valorDe(row, ck) ?? 0).toFixed(2) : "-"}`;
        })
        .join("|");
      const lista = mapa.get(sig);
      if (lista) lista.push(row);
      else mapa.set(sig, [row]);
    }
    return [...mapa.entries()]
      .map(([sig, membros]) => ({ sig, membros }))
      .sort((a, b) => b.membros.length - a.membros.length || a.membros[0].produto.localeCompare(b.membros[0].produto));
  }, [rowsAtivas, tabelasMarcadas, tabelasVisiveis, temRegistro, valorDe]);

  // Regrupar invalida o texto digitado por grupo; o valor planejado fica em `novos`.
  // Os campos da tabela inteira ("Novo p/ todos" e "Desconto %") continuam valendo.
  useEffect(() => {
    setTextos((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => ehChaveTabela(k))));
  }, [tabelasMarcadas, removidos]);

  /**
   * Aplica o texto digitado a um conjunto de produtos numa tabela. `entrada` vem pronta
   * quando o campo não fala a mesma língua do texto (o "Desconto %" recebe "60" e
   * significa -60%).
   */
  const aplicarTexto = useCallback(
    (
      chaveTexto: string,
      membros: ProdutoRow[],
      cod: string,
      texto: string,
      entrada: Entrada | null | undefined = parseEntrada(texto)
    ) => {
      setTextos((prev) => {
        const prox = { ...prev, [chaveTexto]: texto };
        // Mexeu num grupo: o valor/desconto "para todos" daquela tabela deixou de ser verdade.
        if (!ehChaveTabela(chaveTexto)) {
          delete prox[`TODOS||${cod}`];
          delete prox[`DESC||${cod}`];
        }
        return prox;
      });
      if (entrada === null) return; // inválido: mantém o planejado até corrigir
      const campoKey = `T::${cod}::PRECO1`;
      setNovos((prev) => {
        const prox = { ...prev };
        for (const row of membros) {
          if (!temRegistro(row, campoKey)) continue;
          const k = `${row.produto}||${campoKey}`;
          const novo = entrada === undefined ? null : calcular(entrada, valorDe(row, campoKey));
          if (novo === null) delete prox[k];
          else prox[k] = novo;
        }
        return prox;
      });
    },
    [temRegistro, valorDe]
  );

  /**
   * Campo da tabela inteira: valor único ("Novo p/ todos") ou desconto sobre o preço atual
   * de cada produto ("Desconto %"). Sobrescreve os grupos e o outro campo da mesma tabela.
   */
  const aplicarTodos = useCallback(
    (cod: string, texto: string, modo: "valor" | "desconto") => {
      setTextos((prev) => {
        const prox: Record<string, string> = {};
        for (const [k, v] of Object.entries(prev)) if (!k.endsWith(`||${cod}`)) prox[k] = v;
        return prox;
      });
      if (modo === "desconto") aplicarTexto(`DESC||${cod}`, rowsAtivas, cod, texto, parseDesconto(texto));
      else aplicarTexto(`TODOS||${cod}`, rowsAtivas, cod, texto);
    },
    [aplicarTexto, rowsAtivas]
  );

  /** Valor exibido num campo: o texto em edição ou, se não houver, o planejado comum. */
  const textoCampo = useCallback(
    (chaveTexto: string, membros: ProdutoRow[], cod: string): { texto: string; misto: boolean } => {
      if (textos[chaveTexto] !== undefined) return { texto: textos[chaveTexto], misto: false };
      const campoKey = `T::${cod}::PRECO1`;
      const valores = new Set<string>();
      let semValor = 0;
      for (const row of membros) {
        if (!temRegistro(row, campoKey)) continue;
        const n = novos[`${row.produto}||${campoKey}`];
        if (n === undefined) semValor += 1;
        else valores.add(n.toFixed(2));
      }
      if (valores.size === 0) return { texto: "", misto: false };
      if (valores.size === 1 && semValor === 0) return { texto: fmt(Number([...valores][0])), misto: false };
      return { texto: "", misto: true };
    },
    [textos, novos, temRegistro]
  );

  /** Alterações que a tarefa vai gravar: só tabelas marcadas e só o que muda de fato. */
  const alteracoes = useMemo(() => {
    const out: TarefaAlteracao[] = [];
    for (const row of rowsAtivas) {
      // Por produto, item que já é preço por cor fica de fora: o PDV não leria a mudança.
      if (!modoCor && variaCorSet.has(row.produto)) continue;
      for (const cod of tabelasMarcadas) {
        const campoKey = `T::${cod}::PRECO1`;
        if (!temRegistro(row, campoKey)) continue;
        const novo = novos[`${row.produto}||${campoKey}`];
        if (novo === undefined) continue;
        const atual = valorDe(row, campoKey);
        if (mesmoValor(atual, novo)) continue;
        out.push({ produto: row.produto, campoKey, valor: novo, atual, tabela: cod, tabelaDesc: descTabela.get(cod) ?? cod });
      }
    }
    return out;
  }, [rowsAtivas, tabelasMarcadas, novos, temRegistro, valorDe, descTabela, modoCor, variaCorSet]);

  /** Modo cor: produtos que esta tarefa vai transformar em preço por cor. */
  const viramPorCor = useMemo(() => {
    if (!modoCor) return [] as string[];
    const comAlteracao = new Set(alteracoes.map((a) => a.produto));
    return [
      ...new Set(
        rowsAtivas.filter((r) => !r.variaPorCor && comAlteracao.has(r.produto)).map((r) => r.produto.split("|")[0])
      ),
    ];
  }, [modoCor, alteracoes, rowsAtivas]);

  /** Tabela derivada marcada junto com a base dela: o Linx recalcula a derivada a partir da base. */
  const derivadasComBase = useMemo(() => {
    const porCodigo = new Map((dados?.tabelas ?? []).map((t) => [t.codigo, t]));
    return tabelasMarcadas.filter((cod) => {
      const base = porCodigo.get(cod)?.base;
      return !!base && tabelasMarcadas.includes(base);
    });
  }, [dados, tabelasMarcadas]);

  const produtosComAlteracao = useMemo(() => new Set(alteracoes.map((a) => a.produto)).size, [alteracoes]);

  // ───────── editor: salvar ─────────

  const salvar = useCallback(async () => {
    if (alteracoes.length === 0) return;
    if (!nome.trim()) {
      setErro("Dê um nome para a tarefa (ex.: Black Friday capas).");
      return;
    }
    let agendadoPara: string | null = null;
    if (quandoModo === "agendar") {
      const d = new Date(quandoValor);
      if (!quandoValor || Number.isNaN(d.getTime())) {
        setErro("Escolha a data e a hora do agendamento.");
        return;
      }
      agendadoPara = d.toISOString();
    }
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const { ok, json } = await api("/api/precos/tarefas", {
        method: "POST",
        body: JSON.stringify({
          id: editandoId,
          company: companyKey,
          nome: nome.trim(),
          modo: modoCor ? "cor" : "produto",
          produtos: rowsAtivas.map((r) => ({ produto: r.produto, descricao: r.descricao })),
          alteracoes,
          agendadoPara,
        }),
      });
      if (!ok) {
        setErro(json?.error ?? "Erro ao salvar a tarefa.");
        // 422 = conteúdo salvo, agendamento falhou: segue editando a mesma tarefa.
        if (json?.tarefa?.id) setEditandoId(json.tarefa.id);
        void carregarTarefas();
        return;
      }
      const t = json.tarefa as Tarefa;
      setAviso(
        t.status === "agendada"
          ? `Tarefa "${t.nome}" agendada para ${dataCurta(t.agendadoPara)}.`
          : `Tarefa "${t.nome}" salva como pendente.`
      );
      limparEditor();
      void carregarTarefas();
    } catch {
      setErro("Falha de conexão ao salvar a tarefa.");
    } finally {
      setSalvando(false);
    }
  }, [alteracoes, nome, quandoModo, quandoValor, api, editandoId, companyKey, rowsAtivas, limparEditor, carregarTarefas, modoCor]);

  // ───────── tarefas: ações ─────────

  const editarTarefa = useCallback(
    (t: Tarefa) => {
      setEditandoId(t.id);
      setNome(t.nome);
      const codigos = t.produtos.length > 0 ? t.produtos.map((p) => p.produto) : [...new Set(t.alteracoes.map((a) => a.produto))];
      setCodigosTexto(codigos.join("\n"));
      if (t.status === "agendada" && t.agendadoPara) {
        setQuandoModo("agendar");
        setQuandoValor(paraInputLocal(new Date(t.agendadoPara)));
      } else {
        setQuandoModo("pendente");
        setQuandoValor("");
      }
      const preset: Record<string, number> = {};
      for (const a of t.alteracoes) preset[`${a.produto}||${a.campoKey}`] = a.valor;
      void carregarProdutos(
        codigos,
        { novos: preset, marcadas: [...new Set(t.alteracoes.map((a) => a.tabela))] },
        t.modo === "cor"
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [carregarProdutos]
  );

  /** Reaproveitar: só os PRODUTOS vão para uma tarefa nova; preços se definem de novo. */
  const novaTarefaCom = useCallback(
    (produtos: string[], nomeBase: string, cor?: boolean) => {
      limparEditor();
      setNome(nomeBase);
      setCodigosTexto(produtos.join("\n"));
      void carregarProdutos(produtos, undefined, cor);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [limparEditor, carregarProdutos]
  );

  const aplicarAgora = useCallback(async () => {
    const t = confirmarTarefa;
    if (!t) return;
    setOcupado(t.id);
    setErro(null);
    try {
      const { ok, json } = await api(`/api/precos/tarefas/${t.id}/executar`, {
        method: "POST",
        body: JSON.stringify({ company: companyKey }),
      });
      if (!ok) {
        setErro(json?.error ?? "Erro ao aplicar a tarefa.");
      } else {
        setResultado({ titulo: `Tarefa "${t.nome}" aplicada`, r: json.resultado as Resultado });
      }
      setConfirmarTarefa(null);
      setConfirmado(false);
      void carregarTarefas();
      void carregarHistorico();
    } catch {
      setErro("Falha de conexão ao aplicar a tarefa.");
    } finally {
      setOcupado(null);
    }
  }, [confirmarTarefa, api, companyKey, carregarTarefas, carregarHistorico]);

  const programar = useCallback(
    async (t: Tarefa, valor: string | null) => {
      let agendadoPara: string | null = null;
      if (valor !== null) {
        const d = new Date(valor);
        if (!valor || Number.isNaN(d.getTime())) {
          setErro("Escolha a data e a hora.");
          return;
        }
        agendadoPara = d.toISOString();
      }
      setOcupado(t.id);
      setErro(null);
      const { ok, json } = await api(`/api/precos/tarefas/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ company: companyKey, agendadoPara }),
      });
      setOcupado(null);
      if (!ok) {
        setErro(json?.error ?? "Erro ao agendar.");
        return;
      }
      setAgendandoId(null);
      void carregarTarefas();
    },
    [api, companyKey, carregarTarefas]
  );

  const excluir = useCallback(
    async (t: Tarefa) => {
      const msg =
        t.status === "agendada"
          ? `Excluir a tarefa "${t.nome}"? O agendamento é cancelado e nenhum preço é alterado.`
          : `Excluir a tarefa "${t.nome}"? Nenhum preço é alterado.`;
      if (!window.confirm(msg)) return;
      setOcupado(t.id);
      const { ok, json } = await api(`/api/precos/tarefas/${t.id}?company=${companyKey}`, { method: "DELETE" });
      setOcupado(null);
      if (!ok) setErro(json?.error ?? "Erro ao excluir.");
      if (editandoId === t.id) limparEditor();
      void carregarTarefas();
    },
    [api, companyKey, editandoId, limparEditor, carregarTarefas]
  );

  // ───────── histórico: ações ─────────

  const carregarLote = useCallback(
    async (lote: string): Promise<LoteLinha[] | null> => {
      if (lotesCache[lote]) return lotesCache[lote];
      const { ok, json } = await api(`/api/precos/tarefas/lote?company=${companyKey}&lote=${encodeURIComponent(lote)}`);
      if (!ok) {
        setErro(json?.error ?? "Erro ao carregar o lote.");
        return null;
      }
      const linhas = (json.linhas ?? []) as LoteLinha[];
      setLotesCache((prev) => ({ ...prev, [lote]: linhas }));
      const convertidos = ((json.convertidos ?? []) as Array<{ produto: string; para: number | null }>)
        .map((c) => `${c.produto} ${c.para === 1 ? "virou preço por cor" : "voltou a preço único"}`);
      setLotesConvertidos((prev) => ({ ...prev, [lote]: convertidos }));
      return linhas;
    },
    [api, companyKey, lotesCache]
  );

  const abrirLote = useCallback(
    (lote: string) => {
      if (loteAberto === lote) {
        setLoteAberto(null);
        return;
      }
      setLoteAberto(lote);
      void carregarLote(lote);
    },
    [loteAberto, carregarLote]
  );

  const reaproveitarLote = useCallback(
    async (h: HistoricoLote) => {
      setOcupado(h.lote);
      const linhas = await carregarLote(h.lote);
      setOcupado(null);
      if (!linhas || linhas.length === 0) return;
      const base = (h.obs ?? "").replace(/^Tarefa:\s*/, "") || h.lote;
      // Lote por cor reabre no modo cor, item a item (`PRODUTO|COR`).
      const itens = h.porCor ? linhas.map((l) => `${l.produto}|${l.cor ?? ""}`) : linhas.map((l) => l.produto);
      novaTarefaCom([...new Set(itens)], `${base} (nova)`, !!h.porCor);
    },
    [carregarLote, novaTarefaCom]
  );

  const reverter = useCallback(
    async (h: HistoricoLote) => {
      const msg =
        h.porCor && (h.convertidos ?? 0) > 0
          ? `Reverter o lote ${h.lote}? Os preços das cores voltam ao valor anterior e o(s) produto(s) que ` +
            `este lote transformou em preço por cor voltam a ter preço único.`
          : `Reverter o lote ${h.lote}? Os preços voltam para o valor anterior a ele.`;
      if (!window.confirm(msg)) return;
      setOcupado(h.lote);
      setErro(null);
      try {
        const { ok, json } = await api(h.porCor ? "/api/precos/tarefas/reverter-cor" : "/api/precos/reverter", {
          method: "POST",
          body: JSON.stringify({ company: companyKey, lote: h.lote }),
        });
        if (!ok) setErro(json?.error ?? "Erro ao reverter.");
        else setResultado({ titulo: `Lote ${h.lote} revertido`, r: json as Resultado });
        void carregarHistorico();
      } finally {
        setOcupado(null);
      }
    },
    [api, companyKey, carregarHistorico]
  );

  /**
   * Nome legível de cada lote. O nome da tarefa viaja no OBS como "Tarefa: <nome>"; o
   * estorno herda o nome do lote que desfez, para o histórico ler "Estorno de: Black Friday".
   */
  const nomesLote = useMemo(() => {
    const proprio = new Map<string, { nome: string; origem: string }>();
    for (const h of historico) {
      const obs = (h.obs ?? "").trim();
      if (obs.startsWith("Tarefa:")) proprio.set(h.lote, { nome: obs.slice(7).trim(), origem: "Tarefa" });
      else if (obs) proprio.set(h.lote, { nome: obs, origem: "Alterar Custo / Preço" });
      else proprio.set(h.lote, { nome: "", origem: "Alterar Custo / Preço" });
    }
    const out = new Map<string, { nome: string; origem: string }>();
    for (const h of historico) {
      if (h.reverteLote) {
        const original = proprio.get(h.reverteLote)?.nome;
        out.set(h.lote, { nome: `Estorno de: ${original || h.reverteLote}`, origem: "Reverter" });
      } else {
        out.set(h.lote, proprio.get(h.lote)!);
      }
    }
    return out;
  }, [historico]);

  const historicoFiltrado = useMemo(() => {
    const termo = buscaHistorico.trim().toUpperCase();
    if (!termo) return historico;
    return historico.filter((h) =>
      [h.lote, h.usuario, nomesLote.get(h.lote)?.nome ?? "", h.campos.join(" ")].some((s) =>
        s.toUpperCase().includes(termo)
      )
    );
  }, [historico, buscaHistorico, nomesLote]);

  // ───────── render ─────────

  const totalColados = separarCodigos(codigosTexto).length;
  const gruposMostrados = verTodosGrupos ? grupos : grupos.slice(0, GRUPOS_VISIVEIS);
  const minAgenda = paraInputLocal(new Date(Date.now() + 2 * 60 * 1000));

  const renderCampo = (chave: string, membros: ProdutoRow[], cod: string, habilitado: boolean) => {
    const { texto, misto } = textoCampo(chave, membros, cod);
    const invalido = textos[chave] !== undefined && parseEntrada(textos[chave]) === null;
    return (
      <input
        className={`${styles.inputNovo} ${invalido ? styles.inputInvalido : ""}`}
        value={texto}
        placeholder={misto ? "vários" : "ex.: 119,90"}
        disabled={!habilitado || !podeExecutar}
        inputMode="decimal"
        title='Valor em R$ (119,90) ou percentual com sinal (-20%, +5%)'
        onChange={(e) => aplicarTexto(chave, membros, cod, e.target.value)}
      />
    );
  };

  return (
    <div className={base.wrapper}>
      <header className={base.header}>
        <h1 className={base.title}>Programar Preços</h1>
        {!podeExecutar && username && (
          <div className={base.avisoTopo}>Seu perfil é somente leitura: dá para conferir, mas não para gravar.</div>
        )}
      </header>

      {erro && <div className={base.erroBox}>{erro}</div>}
      {aviso && <div className={base.avisoBox}>{aviso}</div>}

      {resultado && (
        <section className={`${base.card} ${base.cardResultado}`}>
          <h2 className={base.cardTitle}>{resultado.titulo}</h2>
          <div className={base.resumoLinha}>
            <strong>{resultado.r.aplicados}</strong> alteração(ões) confirmada(s)
            {resultado.r.semMudanca > 0 && <> · {resultado.r.semMudanca} já estavam no valor</>}
            {resultado.r.semRegistro > 0 && <> · {resultado.r.semRegistro} sem registro na tabela</>}
            {resultado.r.naoConfirmados > 0 && (
              <> · <span className={base.textoErro}>{resultado.r.naoConfirmados} não confirmada(s)</span></>
            )}
            {resultado.r.lote && <> · lote <code className={base.lote}>{resultado.r.lote}</code></>}
            {(resultado.r.convertidos?.length ?? 0) > 0 && (
              <> · {resultado.r.convertidos!.length} produto(s) viraram preço por cor</>
            )}
            {(resultado.r.desconvertidos?.length ?? 0) > 0 && (
              <> · {resultado.r.desconvertidos!.length} produto(s) voltaram a preço único</>
            )}
            <button type="button" className={base.btnTexto} onClick={() => setResultado(null)}>
              fechar
            </button>
          </div>
          {resultado.r.erros?.length > 0 && (
            <ul className={base.listaErros}>
              {resultado.r.erros.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ─── NOVA TAREFA / EDIÇÃO ─── */}
      <section className={base.card}>
        <h2 className={base.cardTitle}>{editandoId ? "Editando tarefa" : "Nova tarefa"}</h2>

        <label className={`${base.check} ${styles.modoCor} ${modoCor ? styles.modoCorLigado : ""}`}>
          <input
            type="checkbox"
            checked={modoCor}
            onChange={(e) => {
              // Trocar de modo muda o que cada linha É (produto × produto+cor): recomeça a grade.
              setModoCor(e.target.checked);
              setDados(null);
              setNovos({});
              setTextos({});
              setTabelasMarcadas([]);
              setRemovidos([]);
            }}
          />
          <span>
            <strong>Preço por cor</strong> — cada código de barras altera só a cor dele. Produto que ainda tem preço
            único vira &quot;preço por cor&quot; no Linx ao aplicar (as outras cores ficam com o preço de hoje).
          </span>
        </label>

        <div className={base.codigosBox}>
          <label className={base.campoTexto}>
            <span className={base.campoLabel}>
              {modoCor
                ? "Códigos de barras (cada um define produto + cor) — um por linha"
                : "Códigos de barras ou de produto — um por linha (ou separados por vírgula/espaço)"}
            </span>
            <textarea
              className={base.textarea}
              value={codigosTexto}
              onChange={(e) => setCodigosTexto(e.target.value)}
              rows={5}
              placeholder={modoCor ? "7891234567890\n7891234567891" : "7891234567890\n7891234567891\nN1.3.0018"}
            />
          </label>
        </div>

        <div className={base.acoes}>
          <span className={styles.reconhecidos}>
            {dados
              ? `${codigosLidos} código(s) → ${rows.length} ${modoCor ? "produto × cor" : "produto(s)"} reconhecido(s)` +
                (dados.naoEncontrados.length > 0 ? ` · ${dados.naoEncontrados.length} não encontrado(s)` : "")
              : totalColados > 0
                ? `${totalColados} código(s) colado(s)`
                : "Cole a lista e clique em Carregar."}
          </span>
          <div className={styles.acoesLinha}>
            {(dados || editandoId) && (
              <button type="button" className={base.btnTexto} onClick={limparEditor}>
                {editandoId ? "Cancelar edição" : "Limpar"}
              </button>
            )}
            <button
              type="button"
              className={base.btnPrimario}
              disabled={carregando || totalColados === 0}
              onClick={() => void carregarProdutos(separarCodigos(codigosTexto), dados ? { novos, marcadas: tabelasMarcadas } : undefined)}
            >
              {carregando ? "Carregando…" : dados ? "Recarregar" : "Carregar produtos"}
            </button>
          </div>
        </div>

        {dados && dados.naoEncontrados.length > 0 && (
          <div className={base.avisoBox}>
            Não encontrados ({dados.naoEncontrados.length}): {dados.naoEncontrados.slice(0, 20).join(", ")}
            {dados.naoEncontrados.length > 20 && "…"}
          </div>
        )}
        {dados?.truncated && (
          <div className={base.avisoBox}>
            Lista cortada em {rows.length} de {dados.total} produtos. Divida em mais de uma tarefa.
          </div>
        )}
        {dados && (dados.semCor?.length ?? 0) > 0 && (
          <div className={base.avisoBox}>
            Códigos de produto não dizem a cor e ficaram de fora ({dados.semCor!.length}):{" "}
            {dados.semCor!.slice(0, 20).join(", ")}. Use o código de barras da cor, ou desligue &quot;Preço por cor&quot;.
          </div>
        )}
        {dados && !modoCor && variaCorSet.size > 0 && (
          <div className={base.avisoBox}>
            {variaCorSet.size} produto(s) já têm preço por cor no Linx ({[...variaCorSet].slice(0, 8).join(", ")}
            {variaCorSet.size > 8 ? "…" : ""}). Mudar o preço do produto não chega ao PDV para eles, então ficam fora
            desta tarefa. Use &quot;Preço por cor&quot; com os códigos de barras das cores.
          </div>
        )}
        {derivadasComBase.length > 0 && (
          <div className={base.avisoBox}>
            A(s) tabela(s) {derivadasComBase.join(", ")} são calculadas pelo Linx a partir de outra tabela marcada.
            Ao alterar a base, o Linx recalcula a derivada — o valor digitado nela pode ser sobrescrito.
          </div>
        )}

        {dados && rows.length > 0 && (
          <>
            {/* ── tabelas: quais alterar + valor para todos ── */}
            <div className={base.resumoLinha}>
              <strong>Tabelas de preço</strong> — marque as que esta tarefa altera.
              <label className={base.check}>
                <input type="checkbox" checked={mostrarZerados} onChange={(e) => setMostrarZerados(e.target.checked)} />
                Mostrar tabelas inativas e zeradas
              </label>
            </div>
            <div className={base.tabelaWrap}>
              <table className={base.tabelaFicha}>
                <thead>
                  <tr>
                    <th className={base.thCheck} />
                    <th>Cod.Tabela</th>
                    <th>Descrição da Tabela</th>
                    <th className={base.thNum}>Itens</th>
                    <th className={base.thNum}>Preço (1) atual</th>
                    <th className={base.thNum}>Desconto %</th>
                    <th className={base.thNum}>Novo p/ todos</th>
                  </tr>
                </thead>
                <tbody>
                  {tabelasVisiveis.map((t) => {
                    const marcada = marcadasSet.has(t.codigo);
                    return (
                      <tr key={t.codigo} className={marcada ? base.trAlterada : ""}>
                        <td className={base.thCheck}>
                          <input
                            type="checkbox"
                            checked={marcada}
                            onChange={() =>
                              setTabelasMarcadas((prev) =>
                                prev.includes(t.codigo) ? prev.filter((c) => c !== t.codigo) : [...prev, t.codigo]
                              )
                            }
                            aria-label={`Alterar a tabela ${t.descricao}`}
                          />
                        </td>
                        <td className={base.tdCodigo}>{t.codigo}</td>
                        <td className={base.tdDesc}>
                          {t.descricao}
                          {t.inativa && <span className={base.badgeInativa}>inativa</span>}
                          {(() => {
                            const b = dados?.tabelas.find((x) => x.codigo === t.codigo)?.base;
                            return b ? <span className={base.dica}> · calculada a partir da {b}</span> : null;
                          })()}
                        </td>
                        <td className={base.thNum}>{t.itens}</td>
                        <td className={base.thNum}>
                          {mesmoValor(t.min, t.max) ? `R$ ${fmt(t.min)}` : `R$ ${fmt(t.min)} – ${fmt(t.max)}`}
                        </td>
                        <td className={base.thNum}>
                          {(() => {
                            const chave = `DESC||${t.codigo}`;
                            const entrada = textos[chave] !== undefined ? parseDesconto(textos[chave]) : undefined;
                            const previa =
                              entrada && entrada.tipo === "pct"
                                ? [calcular(entrada, t.min) ?? 0, calcular(entrada, t.max) ?? 0]
                                : null;
                            return (
                              <div className={styles.descontoCelula}>
                                <input
                                  className={`${styles.inputNovo} ${styles.inputPct} ${entrada === null ? styles.inputInvalido : ""}`}
                                  value={textos[chave] ?? ""}
                                  placeholder="ex.: 60"
                                  disabled={!marcada || !podeExecutar}
                                  inputMode="decimal"
                                  title="Desconto sobre o preço atual de cada produto desta tabela (ex.: 60 = 60% off)"
                                  onChange={(e) => aplicarTodos(t.codigo, e.target.value, "desconto")}
                                />
                                <span className={styles.pctSufixo}>%</span>
                                {previa && (
                                  <span className={styles.previa}>
                                    = R$ {mesmoValor(previa[0], previa[1]) ? fmt(previa[0]) : `${fmt(previa[0])} – ${fmt(previa[1])}`}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className={base.thNum}>
                          {(() => {
                            const chave = `TODOS||${t.codigo}`;
                            const invalido = textos[chave] !== undefined && parseEntrada(textos[chave]) === null;
                            return (
                              <input
                                className={`${styles.inputNovo} ${invalido ? styles.inputInvalido : ""}`}
                                value={textos[chave] ?? ""}
                                placeholder="todos"
                                disabled={!marcada || !podeExecutar}
                                inputMode="decimal"
                                title="Mesmo valor (ou percentual, ex.: -20%) para todos os produtos desta tabela"
                                onChange={(e) => aplicarTodos(t.codigo, e.target.value, "valor")}
                              />
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={base.dica}>
              Desconto %: digite só o número (60 = 60% off) e cada produto recebe o desconto sobre o próprio preço
              atual. Novo p/ todos: um valor único em reais. Nos grupos dá para ajustar um a um (119,90, -20% ou +5%).
              O Preço Líquido acompanha o Preço, como no script.
            </p>

            {/* ── grupos ── */}
            <div className={base.resumoLinha}>
              <strong>{grupos.length}</strong> grupo(s) de produtos com os mesmos preços
              {tabelasMarcadas.length > 0 ? " nas tabelas marcadas" : ""} · {rowsAtivas.length} produto(s)
              {removidos.length > 0 && (
                <button type="button" className={base.btnTexto} onClick={() => setRemovidos([])}>
                  devolver {removidos.length} removido(s)
                </button>
              )}
            </div>

            <div className={styles.grupos}>
              {gruposMostrados.map((g, gi) => {
                const aberto = gruposAbertos.includes(g.sig) || g.membros.length <= 4;
                return (
                  <div key={g.sig} className={styles.grupo}>
                    <div className={styles.grupoHead}>
                      <span className={styles.grupoTitulo}>
                        Grupo {gi + 1} · {g.membros.length} produto(s)
                      </span>
                      {g.membros.length > 4 && (
                        <button
                          type="button"
                          className={base.btnTexto}
                          onClick={() =>
                            setGruposAbertos((prev) =>
                              prev.includes(g.sig) ? prev.filter((s) => s !== g.sig) : [...prev, g.sig]
                            )
                          }
                        >
                          {aberto ? "esconder produtos" : "ver produtos"}
                        </button>
                      )}
                    </div>
                    {aberto && (
                      <div className={styles.grupoProdutos}>
                        {g.membros.map((m) => (
                          <span key={m.produto} className={styles.chip}>
                            <span className={styles.chipCodigo}>{modoCor ? m.produto.split("|")[0] : m.produto}</span>
                            {m.descricao}
                            {m.inativo && <span className={base.badgeInativa}>inativo</span>}
                            {modoCor && !m.variaPorCor && (
                              <span className={styles.badgeConverte} title="Ao aplicar, o produto passa a ter preço por cor no Linx">
                                vira preço por cor
                              </span>
                            )}
                            {modoCor && m.variaPorCor && <span className={styles.badgePorCor}>preço por cor</span>}
                            {!modoCor && variaCorSet.has(m.produto) && (
                              <span className={styles.badgeConverte} title="Já tem preço por cor: fica fora no modo por produto">
                                preço por cor — fora
                              </span>
                            )}
                            <button
                              type="button"
                              className={styles.chipRemover}
                              title="Tirar este produto da tarefa"
                              onClick={() => setRemovidos((prev) => [...prev, m.produto])}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <table className={base.tabelaFicha}>
                      <thead>
                        <tr>
                          <th className={base.thFichaNum}>#</th>
                          <th>Cod.Tabela</th>
                          <th>Descrição da Tabela</th>
                          <th className={base.thNum}>Preço (1)</th>
                          <th className={base.thNum}>Preço Líquido (1)</th>
                          <th className={base.thNum}>Novo preço</th>
                          <th className={base.thNum}>Variação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tabelasVisiveis.map((t, ti) => {
                          const ck = `T::${t.codigo}::PRECO1`;
                          const lk = `T::${t.codigo}::PRECO_LIQUIDO1`;
                          const com = g.membros.filter((m) => temRegistro(m, ck));
                          if (com.length === 0) return null;
                          const precos = com.map((m) => valorDe(m, ck) ?? 0);
                          const liquidos = com.map((m) => valorDe(m, lk) ?? 0);
                          const faixa = (vs: number[]) => {
                            const mn = Math.min(...vs);
                            const mx = Math.max(...vs);
                            return mesmoValor(mn, mx) ? fmt(mn) : `${fmt(mn)} – ${fmt(mx)}`;
                          };
                          const marcada = marcadasSet.has(t.codigo);
                          const precoComum = precos.every((p) => mesmoValor(p, precos[0])) ? precos[0] : null;
                          const novosAqui = com.map((m) => novos[`${m.produto}||${ck}`]);
                          const novoComum =
                            novosAqui.every((n) => n !== undefined && mesmoValor(n, novosAqui[0]!)) ? novosAqui[0]! : null;
                          const v = marcada ? variacao(precoComum, novoComum) : null;
                          return (
                            <tr key={t.codigo} className={marcada ? base.trAlterada : styles.trMuted}>
                              <td className={base.thFichaNum}>{ti + 1}</td>
                              <td className={base.tdCodigo}>{t.codigo}</td>
                              <td className={base.tdDesc}>
                                {t.descricao}
                                {com.length < g.membros.length && (
                                  <span className={base.dica}> · {com.length} de {g.membros.length}</span>
                                )}
                              </td>
                              <td className={base.thNum}>{faixa(precos)}</td>
                              <td className={base.thNum}>{faixa(liquidos)}</td>
                              <td className={base.thNum}>
                                {marcada ? renderCampo(`${g.sig}||${t.codigo}`, g.membros, t.codigo, true) : "—"}
                              </td>
                              <td className={`${base.thNum} ${v ? (v.neg ? styles.variacaoNeg : styles.variacaoPos) : ""}`}>
                                {v?.texto ?? ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
            {grupos.length > GRUPOS_VISIVEIS && (
              <button type="button" className={base.btnTexto} onClick={() => setVerTodosGrupos((v) => !v)}>
                {verTodosGrupos ? "mostrar só os primeiros grupos" : `mostrar os outros ${grupos.length - GRUPOS_VISIVEIS} grupos`}
              </button>
            )}

            {/* ── salvar ── */}
            <div className={styles.salvarBox}>
              <div className={base.resumoLinha}>
                <strong>{alteracoes.length}</strong> alteração(ões) em <strong>{produtosComAlteracao}</strong>{" "}
                {modoCor ? "produto × cor" : "produto(s)"}
                {tabelasMarcadas.length > 0 && <> · tabelas {tabelasMarcadas.join(", ")}</>}
                {alteracoes.length > 0 && (
                  <button type="button" className={base.btnTexto} onClick={() => setVerAlteracoes((v) => !v)}>
                    {verAlteracoes ? "esconder lista" : "ver lista"}
                  </button>
                )}
              </div>
              {viramPorCor.length > 0 && (
                <div className={base.avisoBox}>
                  Ao aplicar, {viramPorCor.length} produto(s) passam a ter <strong>preço por cor</strong> no Linx (
                  {viramPorCor.slice(0, 6).join(", ")}
                  {viramPorCor.length > 6 ? "…" : ""}): as cores que não estão na lista continuam com o preço de hoje.
                  Reverter o lote devolve o preço único.
                </div>
              )}

              {verAlteracoes && alteracoes.length > 0 && (
                <div className={base.tabelaWrap}>
                  <TabelaAlteracoes alteracoes={alteracoes} descricoes={rows} />
                </div>
              )}

              <div className={styles.linhaCampos}>
                <label className={base.campoTexto}>
                  <span className={base.campoLabel}>Nome da tarefa (vira o nome do lote no histórico)</span>
                  <input
                    className={base.input}
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="ex.: Black Friday capas"
                    maxLength={120}
                  />
                </label>
              </div>

              <div className={styles.quando}>
                <label className={base.check}>
                  <input type="radio" checked={quandoModo === "pendente"} onChange={() => setQuandoModo("pendente")} />
                  Deixar pendente (aplico quando quiser)
                </label>
                <label className={base.check}>
                  <input
                    type="radio"
                    checked={quandoModo === "agendar"}
                    disabled={!!agendamentoIndisponivel}
                    onChange={() => setQuandoModo("agendar")}
                  />
                  Agendar para
                </label>
                <input
                  type="datetime-local"
                  className={styles.inputData}
                  value={quandoValor}
                  min={minAgenda}
                  disabled={quandoModo !== "agendar"}
                  onChange={(e) => setQuandoValor(e.target.value)}
                />
                {agendamentoIndisponivel && (
                  <span className={base.dica}>Agendamento indisponível: {agendamentoIndisponivel}</span>
                )}
              </div>

              <div>
                <button
                  type="button"
                  className={base.btnPrimario}
                  disabled={salvando || alteracoes.length === 0 || !podeExecutar}
                  onClick={() => void salvar()}
                >
                  {salvando
                    ? "Salvando…"
                    : quandoModo === "agendar"
                      ? "Salvar e agendar"
                      : editandoId
                        ? "Salvar alterações da tarefa"
                        : "Salvar como pendente"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ─── TAREFAS ─── */}
      <section className={base.card}>
        <div className={styles.toolbar}>
          <h2 className={base.cardTitle}>Tarefas pendentes e agendadas</h2>
          <label className={base.check}>
            <input type="checkbox" checked={mostrarAplicadas} onChange={(e) => setMostrarAplicadas(e.target.checked)} />
            Mostrar também as já aplicadas
          </label>
        </div>
        <div className={base.tabelaWrap}>
          <table className={base.tabela}>
            <thead>
              <tr>
                <th>Tarefa</th>
                <th>Status</th>
                <th className={base.thNum}>Produtos</th>
                <th className={base.thNum}>Alterações</th>
                <th>Criada</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tarefas.map((t) => {
                const aberta = tarefaAberta === t.id;
                const ativa = t.status !== "aplicada" && t.status !== "executando";
                const nProdutos = new Set(t.alteracoes.map((a) => a.produto)).size;
                return (
                  <Fragment key={t.id}>
                    <tr>
                      <td>
                        <button type="button" className={styles.linkLinha} onClick={() => setTarefaAberta(aberta ? null : t.id)}>
                          {aberta ? "▾" : "▸"} {t.nome}
                        </button>
                        {t.modo === "cor" && <span className={styles.badgePorCor}>por cor</span>}
                        {editandoId === t.id && <span className={base.dica}> · em edição</span>}
                      </td>
                      <td>
                        <span className={`${styles.status} ${STATUS_CLASSE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                        {t.status === "agendada" && <> {dataCurta(t.agendadoPara)}</>}
                        {t.status === "aplicada" && (
                          <span className={base.tdMetaSub}>
                            {dataCurta(t.executadoEm)} por {t.executadoPor}
                            {t.lote ? ` · ${t.lote}` : " · nada mudou"}
                          </span>
                        )}
                        {t.erro && <span className={styles.erroTarefa}>{t.erro}</span>}
                      </td>
                      <td className={base.thNum}>{nProdutos}</td>
                      <td className={base.thNum}>{t.alteracoes.length}</td>
                      <td className={base.tdMeta}>
                        {dataCurta(t.criadoEm)}
                        <span className={base.tdMetaSub}>{t.criadoPor}</span>
                      </td>
                      <td>
                        <div className={styles.acoesLinha}>
                          {ativa && podeExecutar && (
                            <>
                              <button type="button" className={base.btnTexto} onClick={() => editarTarefa(t)}>
                                Editar
                              </button>
                              <button
                                type="button"
                                className={base.btnTexto}
                                disabled={ocupado === t.id}
                                onClick={() => {
                                  setConfirmado(false);
                                  setConfirmarTarefa(t);
                                }}
                              >
                                Aplicar agora
                              </button>
                              {agendandoId === t.id ? (
                                <span className={styles.agendarInline}>
                                  <input
                                    type="datetime-local"
                                    className={styles.inputData}
                                    value={agendaValor}
                                    min={minAgenda}
                                    onChange={(e) => setAgendaValor(e.target.value)}
                                  />
                                  <button
                                    type="button"
                                    className={base.btnTexto}
                                    disabled={ocupado === t.id}
                                    onClick={() => void programar(t, agendaValor)}
                                  >
                                    OK
                                  </button>
                                  <button type="button" className={base.btnTexto} onClick={() => setAgendandoId(null)}>
                                    ×
                                  </button>
                                </span>
                              ) : (
                                !agendamentoIndisponivel && (
                                  <button
                                    type="button"
                                    className={base.btnTexto}
                                    onClick={() => {
                                      setAgendandoId(t.id);
                                      setAgendaValor(t.agendadoPara ? paraInputLocal(new Date(t.agendadoPara)) : "");
                                    }}
                                  >
                                    {t.status === "agendada" ? "Reagendar" : "Agendar"}
                                  </button>
                                )
                              )}
                              {t.status === "agendada" && (
                                <button
                                  type="button"
                                  className={base.btnTexto}
                                  disabled={ocupado === t.id}
                                  onClick={() => void programar(t, null)}
                                >
                                  Desagendar
                                </button>
                              )}
                              <button
                                type="button"
                                className={base.btnTexto}
                                disabled={ocupado === t.id}
                                onClick={() => void excluir(t)}
                              >
                                Excluir
                              </button>
                            </>
                          )}
                          {t.status === "aplicada" && podeExecutar && (
                            <button
                              type="button"
                              className={base.btnTexto}
                              onClick={() => novaTarefaCom(t.produtos.map((p) => p.produto), `${t.nome} (nova)`, t.modo === "cor")}
                            >
                              Reaproveitar produtos
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {aberta && (
                      <tr>
                        <td colSpan={6} className={styles.detalheCell}>
                          <TabelaAlteracoes alteracoes={t.alteracoes} descricoes={t.produtos} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {tarefas.length === 0 && (
                <tr>
                  <td colSpan={6} className={base.dica}>
                    Nenhuma tarefa {mostrarAplicadas ? "" : "pendente ou agendada"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── HISTÓRICO ─── */}
      <section className={base.card}>
        <div className={styles.toolbar}>
          <h2 className={base.cardTitle}>Histórico de alterações de preço</h2>
          <input
            type="search"
            className={`${base.input} ${styles.busca}`}
            value={buscaHistorico}
            onChange={(e) => setBuscaHistorico(e.target.value)}
            placeholder="Buscar por tarefa, lote, usuário ou tabela…"
          />
        </div>
        <p className={base.dica}>
          Todos os lotes de preço (desta tela e do Alterar Custo / Preço). Clique para ver os itens; Reverter devolve o
          preço anterior; Reaproveitar abre uma tarefa nova com os mesmos produtos.
        </p>
        <div className={base.tabelaWrap}>
          <table className={base.tabela}>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Nome do lote</th>
                <th>Quem</th>
                <th className={base.thNum}>Alterações</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {historicoFiltrado.map((h) => {
                const aberto = loteAberto === h.lote;
                const linhas = lotesCache[h.lote];
                return (
                  <Fragment key={h.lote}>
                    <tr>
                      <td className={base.tdMeta}>
                        <button type="button" className={styles.linkLinha} onClick={() => abrirLote(h.lote)}>
                          {aberto ? "▾" : "▸"} {dataLinx(h.data)}
                        </button>
                        <span className={base.tdMetaSub}>{h.lote}</span>
                      </td>
                      <td className={base.tdMeta}>
                        <strong>{nomesLote.get(h.lote)?.nome || "sem nome"}</strong>
                        <span className={base.tdMetaSub}>
                          {nomesLote.get(h.lote)?.origem}
                          {h.porCor && " · por cor"}
                          {h.porCor && (h.convertidos ?? 0) > 0 && ` · ${h.convertidos} conversão(ões)`}
                        </span>
                      </td>
                      <td>{h.usuario}</td>
                      <td className={base.thNum}>
                        {h.alteracoes} em {h.produtos} prod.
                      </td>
                      <td>
                        {h.revertidoPor ? (
                          <span className={`${styles.status} ${styles.statusPendente}`}>revertido</span>
                        ) : h.reverteLote ? (
                          <span className={`${styles.status} ${styles.statusPendente}`}>estorno</span>
                        ) : (
                          <span className={`${styles.status} ${styles.statusAplicada}`}>em vigor</span>
                        )}
                      </td>
                      <td>
                        {podeExecutar && (
                          <div className={styles.acoesLinha}>
                            <button
                              type="button"
                              className={base.btnTexto}
                              disabled={ocupado === h.lote}
                              onClick={() => void reaproveitarLote(h)}
                            >
                              Reaproveitar produtos
                            </button>
                            {!h.revertidoPor && !h.reverteLote && (
                              <button
                                type="button"
                                className={base.btnTexto}
                                disabled={ocupado === h.lote}
                                onClick={() => void reverter(h)}
                              >
                                {ocupado === h.lote ? "…" : "Reverter"}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {aberto && (
                      <tr>
                        <td colSpan={6} className={styles.detalheCell}>
                          {!linhas ? (
                            <span className={base.dica}>Carregando itens…</span>
                          ) : (
                            <>
                            {(lotesConvertidos[h.lote] ?? []).length > 0 && (
                              <p className={base.dica}>{lotesConvertidos[h.lote].join(" · ")}</p>
                            )}
                            <table className={base.tabelaFicha}>
                              <thead>
                                <tr>
                                  <th className={base.thFichaNum}>#</th>
                                  <th>Produto</th>
                                  <th>Descrição</th>
                                  <th>Tabela</th>
                                  <th className={base.thNum}>Preço antes</th>
                                  <th className={base.thNum}>Preço depois</th>
                                  <th className={base.thNum}>Líquido antes</th>
                                  <th className={base.thNum}>Líquido depois</th>
                                </tr>
                              </thead>
                              <tbody>
                                {linhas.map((l, i) => (
                                  <tr key={`${l.produto}|${l.tabela}|${l.slot}|${i}`}>
                                    <td className={base.thFichaNum}>{i + 1}</td>
                                    <td className={base.tdCodigo}>{l.cor ? `${l.produto} · ${l.cor}` : l.produto}</td>
                                    <td className={base.tdDesc}>{l.descricao}</td>
                                    <td className={base.tdDesc}>
                                      {l.tabela} · {l.tabelaDesc}
                                      {l.slot > 1 ? ` (${l.slot})` : ""}
                                    </td>
                                    <td className={base.thNum}>{l.precoAntes === null && l.precoDepois === null ? "—" : fmt(l.precoAntes)}</td>
                                    <td className={base.thNum}>{l.precoAntes === null && l.precoDepois === null ? "—" : fmt(l.precoDepois)}</td>
                                    <td className={base.thNum}>{l.liquidoAntes === null && l.liquidoDepois === null ? "—" : fmt(l.liquidoAntes)}</td>
                                    <td className={base.thNum}>{l.liquidoAntes === null && l.liquidoDepois === null ? "—" : fmt(l.liquidoDepois)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {historicoFiltrado.length === 0 && (
                <tr>
                  <td colSpan={6} className={base.dica}>
                    Nenhum lote encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {historico.length >= limiteHistorico && limiteHistorico < 200 && (
          <button type="button" className={base.btnTexto} onClick={() => setLimiteHistorico((n) => Math.min(n + 30, 200))}>
            carregar mais
          </button>
        )}
      </section>

      {/* ─── CONFIRMAR "APLICAR AGORA" ─── */}
      {confirmarTarefa && (
        <div className={base.modalOverlay} role="dialog" aria-modal="true">
          <div className={base.modal}>
            <h2 className={base.cardTitle}>Aplicar agora: {confirmarTarefa.nome}</h2>
            <p className={base.modalAviso}>
              {confirmarTarefa.alteracoes.length} preço(s) serão gravados no Linx agora
              {confirmarTarefa.status === "agendada" && " e o agendamento é cancelado"}. A coluna &quot;Atual&quot; é o valor
              de quando a tarefa foi montada — na hora de gravar o sistema relê o banco.
            </p>
            <div className={base.tabelaWrap}>
              <TabelaAlteracoes alteracoes={confirmarTarefa.alteracoes} descricoes={confirmarTarefa.produtos} />
            </div>
            <label className={base.check}>
              <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
              Confirmo que revisei e quero gravar no Linx.
            </label>
            <div className={base.modalAcoes}>
              <button type="button" className={base.btnTexto} onClick={() => setConfirmarTarefa(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={base.btnPerigo}
                disabled={!confirmado || ocupado === confirmarTarefa.id}
                onClick={() => void aplicarAgora()}
              >
                {ocupado === confirmarTarefa.id ? "Aplicando…" : `Aplicar ${confirmarTarefa.alteracoes.length} alteração(ões)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Lista "produto × tabela: atual → novo" (editor, detalhe da tarefa e confirmação). */
function TabelaAlteracoes({
  alteracoes,
  descricoes,
}: {
  alteracoes: TarefaAlteracao[];
  descricoes: Array<{ produto: string; descricao: string }>;
}) {
  const desc = useMemo(() => new Map(descricoes.map((d) => [d.produto, d.descricao])), [descricoes]);
  const LIMITE = 300;
  return (
    <>
      <table className={base.tabelaFicha}>
        <thead>
          <tr>
            <th className={base.thFichaNum}>#</th>
            <th>Produto</th>
            <th>Descrição</th>
            <th>Tabela</th>
            <th className={base.thNum}>Atual</th>
            <th className={base.thNum}>Novo</th>
            <th className={base.thNum}>Variação</th>
          </tr>
        </thead>
        <tbody>
          {alteracoes.slice(0, LIMITE).map((a, i) => {
            const v = variacao(a.atual, a.valor);
            return (
              <tr key={`${a.produto}||${a.campoKey}`}>
                <td className={base.thFichaNum}>{i + 1}</td>
                <td className={base.tdCodigo}>{a.produto}</td>
                <td className={base.tdDesc}>{desc.get(a.produto) ?? ""}</td>
                <td className={base.tdDesc}>
                  {a.tabela} · {a.tabelaDesc}
                </td>
                <td className={base.thNum}>{a.atual === null ? "—" : fmt(a.atual)}</td>
                <td className={base.thNum}>{fmt(a.valor)}</td>
                <td className={`${base.thNum} ${v ? (v.neg ? styles.variacaoNeg : styles.variacaoPos) : ""}`}>
                  {v?.texto ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {alteracoes.length > LIMITE && (
        <p className={base.dica}>Mostrando {LIMITE} de {alteracoes.length}.</p>
      )}
    </>
  );
}
