"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./BlackFridayPage.module.css";

/* ═══════════════════════════════ tipos da API ═══════════════════════════════ */

interface Rebaixa {
  data: string;
  lote: string;
  de: number | null;
  para: number | null;
  usuario: string;
  painel: boolean;
}

interface VendaLoja {
  v: number;
  q: number;
  vh: number;
  qh: number;
  vb: number;
  qb: number;
}

interface CorApi {
  cor: string;
  corDesc: string;
  vendas: number;
  qtde: number;
  vendasHoje: number;
  qtdeHoje: number;
  vendasBase: number;
  qtdeBase: number;
  dia: Array<[number, number]>;
  porLoja: Record<string, VendaLoja>;
  estoque: number;
  estoqueLojas: Record<string, number>;
}

interface ItemApi {
  produto: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  colecao: string;
  grade?: string;
  tipo?: string;
  /** Quebra por cor (mesma venda canônica, só agrupada por cor). */
  cores?: CorApi[];
  tabelas: string[];
  precoOriginal: number | null;
  precoAtual: number | null;
  custo: number;
  entrada: string;
  rebaixas: Rebaixa[];
  vendas: number;
  qtde: number;
  vendasHoje: number;
  qtdeHoje: number;
  vendasBase: number;
  qtdeBase: number;
  dia: Array<[number, number]>;
  porLoja: Record<string, VendaLoja>;
  estoque: number;
  estoqueLojas: Record<string, number>;
}

interface LojaApi {
  key: string;
  label: string;
  ecommerce: boolean;
  matriz: boolean;
}

interface PainelApi {
  inicio: string | null;
  hoje: string;
  diasDecorridos: number;
  dias: string[];
  base: { inicio: string; fim: string; dias: number } | null;
  lojas: LojaApi[];
  itens: ItemApi[];
  podeExecutar: boolean;
  geradoEm: string;
}

interface TotaisLojasApi {
  lojas: Array<{ label: string; ecommerce: boolean; vendas: number; qtde: number; tickets: number }>;
  total: { vendas: number; qtde: number; tickets: number };
}

/* ═══════════════════════════════ status ═══════════════════════════════ */

type Status = "destaque" | "vendendo" | "fraco" | "parado" | "esgotado" | "sem-estoque";

const STATUS_ORDEM: Status[] = ["destaque", "vendendo", "fraco", "parado", "esgotado", "sem-estoque"];

const STATUS_META: Record<Status, { label: string; icone: string; dica: string; classe: string }> = {
  destaque: {
    label: "Promissor",
    icone: "▲",
    dica: "Vendendo 2× ou mais o ritmo de antes da Black (mín. 3 pç), ou já girou 35% do que tinha.",
    classe: "stDestaque",
  },
  vendendo: {
    label: "Vendendo",
    icone: "●",
    dica: "Vende acima do ritmo de antes, mas ainda sem explodir.",
    classe: "stVendendo",
  },
  fraco: {
    label: "Fraco",
    icone: "▼",
    dica: "Vendeu, mas o desconto não acelerou: ritmo abaixo de 1,2× o de antes da Black.",
    classe: "stFraco",
  },
  parado: {
    label: "Parado",
    icone: "■",
    dica: "Tem estoque e não vendeu nenhuma peça desde que entrou na Black.",
    classe: "stParado",
  },
  esgotado: {
    label: "Esgotou",
    icone: "✓",
    dica: "Vendeu e o estoque acabou (lojas, e-commerce e matriz).",
    classe: "stEsgotado",
  },
  "sem-estoque": {
    label: "Sem estoque",
    icone: "–",
    dica: "Sem estoque e sem venda: não há o que fazer com preço.",
    classe: "stSemEstoque",
  },
};

/* ═══════════════════════════════ formatação ═══════════════════════════════ */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const fmtR = (n: number | null | undefined) => (n === null || n === undefined ? "—" : brl.format(n));
const fmtR0 = (n: number) => (Math.abs(n) >= 10000 ? brl0.format(n) : brl.format(n));
const fmtQ = (n: number) => int.format(Math.round(n));
const fmtPct = (n: number | null | undefined, casas = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(casas).replace(".", ",")}%`;
const fmtX = (n: number | null) =>
  n === null ? "novo" : !Number.isFinite(n) ? "—" : n > 20 ? "20×+" : `${dec1.format(n)}×`;
const fmtDia = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaSemana = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

/* ═══════════════════════════════ métricas ═══════════════════════════════ */

interface Item extends ItemApi {
  /** Chave da linha: produto, ou produto||cor na visão por cor. */
  chave: string;
  /** Código e descrição da cor quando a linha é uma cor ('' na visão por produto). */
  cor: string;
  corDesc: string;
  /** Cores do produto já com métricas (só na linha de produto). */
  coresCalc: Item[];
  categoria: string;
  ritmo: number;
  ritmoBase: number;
  /** ritmo Black ÷ ritmo antes; null = não vendia antes (item "novo" na venda). */
  lift: number | null;
  desconto: number | null;
  margem: number | null;
  espaco: number;
  noPiso: boolean;
  giro: number;
  sobra: number;
  sobraCusto: number;
  status: Status;
}

function calcularItem(
  it: ItemApi,
  company: CompanyKey,
  diasDecorridos: number,
  baseDias: number,
  diasRestantes: number
): Item {
  const ritmo = it.qtde / Math.max(diasDecorridos, 1 / 24);
  const ritmoBase = baseDias > 0 ? it.qtdeBase / baseDias : 0;
  const lift = ritmoBase > 0 ? ritmo / ritmoBase : null;
  const atual = it.precoAtual;
  const desconto = atual !== null && it.precoOriginal ? 1 - atual / it.precoOriginal : null;
  const margem = atual && atual > 0 ? (atual - it.custo) / atual : null;
  const espaco = atual !== null ? atual - it.custo : 0;
  const noPiso = atual === null || !(it.custo > 0) || atual <= it.custo + 0.005;
  const estoque = Math.max(0, it.estoque);
  const giro = it.qtde + estoque > 0 ? Math.max(0, it.qtde) / (Math.max(0, it.qtde) + estoque) : 0;
  const sobra = Math.max(0, estoque - Math.max(0, ritmo) * diasRestantes);

  let status: Status;
  if (estoque <= 0) status = it.qtde > 0 ? "esgotado" : "sem-estoque";
  else if (it.qtde <= 0) status = "parado";
  else if (((lift === null || lift >= 2) && it.qtde >= 3) || giro >= 0.35) status = "destaque";
  else if (lift !== null && lift < 1.2) status = "fraco";
  else status = "vendendo";

  return {
    ...it,
    chave: it.produto,
    cor: "",
    corDesc: "",
    coresCalc: [],
    categoria: (company === "nerd" ? it.grupo : it.linha) || it.grupo || "—",
    ritmo,
    ritmoBase,
    lift,
    desconto,
    margem,
    espaco,
    noPiso,
    giro,
    sobra,
    sobraCusto: sobra * it.custo,
    status,
  };
}

/** Maior valor terminado em ,90 que não passa de `x`. */
function terminarEm90(x: number): number {
  const base = Math.floor(x) + 0.9;
  return Math.round((base > x + 1e-9 ? base - 1 : base) * 100) / 100;
}

const arred2 = (n: number) => Math.round(n * 100) / 100;
const custoPiso = (custo: number) => Math.ceil(custo * 100 - 1e-6) / 100;

interface PropostaLinha {
  item: Item;
  novo: number | null;
  limitado: boolean;
  motivo: string | null;
}

function proporRebaixa(item: Item, alvo: number, usar90: boolean): PropostaLinha {
  if (item.noPiso) {
    return { item, novo: null, limitado: false, motivo: item.custo > 0 ? "já está no custo" : "sem custo cadastrado" };
  }
  let novo = arred2(alvo);
  if (usar90) novo = terminarEm90(novo);
  let limitado = false;
  const piso = custoPiso(item.custo);
  if (novo < piso) {
    novo = piso;
    limitado = true;
  }
  if (item.precoAtual === null || novo >= item.precoAtual - 0.005) {
    return { item, novo: null, limitado, motivo: "não fica abaixo do preço atual" };
  }
  return { item, novo, limitado, motivo: null };
}

/* ═══════════════════════════════ componente ═══════════════════════════════ */

interface Props {
  companyKey: CompanyKey;
  companyName: string;
}

type Aba = "produtos" | "lojas" | "categorias";
type Ordem =
  | "vendas"
  | "qtde"
  | "hoje"
  | "lift"
  | "estoque"
  | "sobra"
  | "margem"
  | "desconto"
  | "produto";

const PAGINA = 80;

/** Chave da observação: produto + cor ('' = produto inteiro). */
const chaveObs = (produto: string, cor: string) => `${produto}||${cor}`;

export default function BlackFridayPage({ companyKey, companyName }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [painel, setPainel] = useState<PainelApi | null>(null);
  const [totaisLojas, setTotaisLojas] = useState<TotaisLojasApi | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const fimKey = `bf-fim-${companyKey}`;
  const [fim, setFim] = useState("2026-11-30");
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(fimKey);
      if (salvo && /^\d{4}-\d{2}-\d{2}$/.test(salvo)) setFim(salvo);
    } catch {
      /* sem storage: fica o padrão */
    }
  }, [fimKey]);
  const mudarFim = (v: string) => {
    setFim(v);
    try {
      localStorage.setItem(fimKey, v);
    } catch {
      /* ignora */
    }
  };

  // Carga: sem guard por ref (StrictMode roda o efeito 2×) — o `ativo` descarta a resposta velha.
  useEffect(() => {
    if (!username) return;
    let ativo = true;
    setCarregando(true);
    setErro(null);
    (async () => {
      try {
        const res = await fetch(`/api/black-friday/painel?company=${companyKey}`, {
          cache: "no-store",
          headers: { "x-auth-username": username },
        });
        const json = await res.json().catch(() => ({}));
        if (!ativo) return;
        if (!res.ok) throw new Error(json.error || `Erro ${res.status}`);
        setPainel(json as PainelApi);
        setCarregando(false);
        if ((json as PainelApi).inicio) {
          const r2 = await fetch(
            `/api/black-friday/lojas?company=${companyKey}&inicio=${(json as PainelApi).inicio}`,
            { cache: "no-store", headers: { "x-auth-username": username } }
          );
          const j2 = await r2.json().catch(() => null);
          if (ativo && r2.ok && j2) setTotaisLojas(j2 as TotaisLojasApi);
        }
      } catch (e) {
        if (!ativo) return;
        setErro(e instanceof Error ? e.message : "Erro ao carregar o painel.");
        setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [companyKey, username, recarga]);

  /* ── observações por item (mesmo funcionamento da Curva ABC) ── */

  /** chave `produto||cor` (cor '' = observação do produto, visão "Por produto"). */
  const [observacoes, setObservacoes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!username) return;
    let ativo = true;
    fetch(`/api/black-friday/observacoes?company=${companyKey}`, {
      cache: "no-store",
      headers: { "x-auth-username": username },
    })
      .then((r) => r.json())
      .then((json: { data?: Array<{ produto: string; cor: string; observacao: string }> }) => {
        if (!ativo) return;
        const mapa: Record<string, string> = {};
        for (const row of json.data ?? []) mapa[chaveObs(row.produto, row.cor)] = row.observacao ?? "";
        setObservacoes(mapa);
      })
      .catch(() => {
        if (ativo) setObservacoes({});
      });
    return () => {
      ativo = false;
    };
  }, [companyKey, username]);

  const salvarObservacao = useCallback(
    async (produto: string, cor: string, valor: string): Promise<{ ok: boolean; error?: string }> => {
      const chave = chaveObs(produto, cor);
      const texto = valor.trim();
      if (texto === (observacoes[chave] ?? "").trim()) return { ok: true };
      try {
        const res = await fetch("/api/black-friday/observacoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ company: companyKey, produto, cor, observacao: texto }),
        });
        const json = (await res.json().catch(() => ({}))) as { data?: { observacao: string } | null; error?: string };
        if (!res.ok || json.error) throw new Error(json.error || "Erro ao salvar observação.");
        const novo = json.data?.observacao ?? "";
        setObservacoes((prev) => {
          const n = { ...prev };
          if (novo) n[chave] = novo;
          else delete n[chave];
          return n;
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Erro ao salvar observação." };
      }
    },
    [observacoes, companyKey, username]
  );

  /* ── derivados ── */

  const diasRestantes = useMemo(() => {
    if (!painel) return 0;
    const [y, m, d] = fim.split("-").map(Number);
    const fimMs = Date.UTC(y, m - 1, d + 1); // fim do dia
    const agora = Date.now() - 3 * 3600 * 1000; // relógio de Brasília como pseudo-UTC
    return Math.max(0, (fimMs - agora) / 86_400_000);
  }, [fim, painel]);

  // Visão por cor (padrão, igual à Curva ABC) ou por produto. Preço é sempre do produto.
  const [porCor, setPorCor] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("bf-por-cor") === "0") setPorCor(false);
    } catch {
      /* sem storage */
    }
  }, []);
  const mudarPorCor = (v: boolean) => {
    setPorCor(v);
    setAberto(null);
    try {
      localStorage.setItem("bf-por-cor", v ? "1" : "0");
    } catch {
      /* ignora */
    }
  };

  const itensProduto = useMemo<Item[]>(() => {
    if (!painel) return [];
    const baseDias = painel.base?.dias ?? 0;
    const calc = (it: ItemApi) => calcularItem(it, companyKey, painel.diasDecorridos, baseDias, diasRestantes);
    return painel.itens.map((it) => {
      const item = calc(it);
      item.coresCalc = (it.cores ?? []).map((c) => ({
        ...calc({ ...it, ...c, cores: [] }),
        chave: `${it.produto}||${c.cor}`,
        cor: c.cor,
        corDesc: c.corDesc || c.cor,
      }));
      return item;
    });
  }, [painel, companyKey, diasRestantes]);

  /** Linhas da tela: cada cor vira uma linha; produto sem cor com movimento fica como está. */
  const itens = useMemo<Item[]>(
    () => (porCor ? itensProduto.flatMap((p) => (p.coresCalc.length > 0 ? p.coresCalc : [p])) : itensProduto),
    [porCor, itensProduto]
  );

  const resumo = useMemo(() => {
    const r = {
      vendas: 0,
      qtde: 0,
      vendasHoje: 0,
      qtdeHoje: 0,
      vendasBase: 0,
      qtdeBase: 0,
      estoque: 0,
      estoqueCusto: 0,
      estoquePreco: 0,
      comVenda: 0,
      sobraCusto: 0,
      porStatus: Object.fromEntries(STATUS_ORDEM.map((s) => [s, 0])) as Record<Status, number>,
    };
    for (const it of itens) {
      // Soma TODAS as linhas (inclusive negativas): fecha com o Dashboard.
      r.vendas += it.vendas;
      r.qtde += it.qtde;
      r.vendasHoje += it.vendasHoje;
      r.qtdeHoje += it.qtdeHoje;
      r.vendasBase += it.vendasBase;
      r.qtdeBase += it.qtdeBase;
      const est = Math.max(0, it.estoque);
      r.estoque += est;
      r.estoqueCusto += est * it.custo;
      r.estoquePreco += est * (it.precoAtual ?? 0);
      if (it.qtde > 0) r.comVenda += 1;
      r.sobraCusto += it.sobraCusto;
      r.porStatus[it.status] += 1;
    }
    return r;
  }, [itens]);

  const serie = useMemo(() => {
    if (!painel) return [];
    return painel.dias.map((dia, i) => {
      let v = 0;
      let q = 0;
      for (const it of painel.itens) {
        const p = it.dia[i];
        if (p) {
          v += p[0];
          q += p[1];
        }
      }
      return { dia, v, q };
    });
  }, [painel]);

  /* ── filtros da lista de produtos ── */

  const [aba, setAba] = useState<Aba>("produtos");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<Set<Status>>(new Set());
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [soComEspaco, setSoComEspaco] = useState(false);
  const [ordem, setOrdem] = useState<Ordem>("vendas");
  const [desc, setDesc] = useState(true);
  const [limite, setLimite] = useState(PAGINA);
  const [aberto, setAberto] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const categorias = useMemo(
    () => [...new Set(itens.map((i) => i.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [itens]
  );

  const passaStatus = useCallback(
    (it: Item) => filtroStatus.size === 0 || filtroStatus.has(it.status),
    [filtroStatus]
  );

  /** Produtos com busca/categoria/espaço aplicados, MAS sem o filtro de situação (base das contagens). */
  const itensSemStatus = useMemo(() => {
    const termo = busca.trim().toUpperCase();
    const palavras = termo.split(/\s+/).filter(Boolean);
    return itens.filter((it) => {
      if (filtroCategoria && it.categoria !== filtroCategoria) return false;
      if (soComEspaco && it.noPiso) return false;
      if (palavras.length > 0) {
        const alvo = `${it.produto} ${it.descricao} ${it.categoria} ${it.subgrupo} ${it.colecao} ${it.corDesc} ${it.grade ?? ""}`.toUpperCase();
        if (!palavras.every((p) => alvo.includes(p))) return false;
      }
      return true;
    });
  }, [itens, busca, filtroCategoria, soComEspaco]);

  /** Lojas e Categorias recebem só os itens da(s) situação(ões) escolhida(s). */
  const itensPorStatus = useMemo(() => itens.filter(passaStatus), [itens, passaStatus]);

  /** Contagem por situação respeitando os OUTROS filtros da aba (nunca o próprio). */
  const contagemStatus = useMemo(() => {
    const base = aba === "produtos" ? itensSemStatus : itens;
    const c = Object.fromEntries(STATUS_ORDEM.map((st) => [st, 0])) as Record<Status, number>;
    for (const it of base) c[it.status] += 1;
    return { porStatus: c, total: base.length };
  }, [aba, itensSemStatus, itens]);

  const filtrados = useMemo(() => {
    const lista = itensSemStatus.filter(passaStatus);
    const valor = (it: Item): number | string => {
      switch (ordem) {
        case "vendas":
          return it.vendas;
        case "qtde":
          return it.qtde;
        case "hoje":
          return it.qtdeHoje;
        case "lift":
          return it.lift === null ? (it.qtde > 0 ? 999 : -1) : it.lift;
        case "estoque":
          return it.estoque;
        case "sobra":
          return it.sobraCusto;
        case "margem":
          return it.margem ?? -9;
        case "desconto":
          return it.desconto ?? -9;
        case "produto":
          return it.descricao;
      }
    };
    lista.sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const cmp = typeof va === "string" ? va.localeCompare(String(vb), "pt-BR") : va - (vb as number);
      return desc ? -cmp : cmp;
    });
    return lista;
  }, [itensSemStatus, passaStatus, ordem, desc]);

  useEffect(() => setLimite(PAGINA), [busca, filtroStatus, filtroCategoria, soComEspaco, ordem, desc]);

  const ordenarPor = (o: Ordem) => {
    if (o === ordem) setDesc((d) => !d);
    else {
      setOrdem(o);
      setDesc(o !== "produto");
    }
  };

  const alternarStatus = (s: Status) => {
    setFiltroStatus((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  };

  const verCategoria = (c: string) => {
    setFiltroCategoria(c);
    setAba("produtos");
  };

  /* ── seleção / rebaixa ── */

  const podeExecutar = painel?.podeExecutar ?? false;
  const alternarSel = (p: string) =>
    setSelecionados((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const selecionaveis = filtrados.filter((i) => !i.noPiso);
  const todosSel = selecionaveis.length > 0 && selecionaveis.every((i) => selecionados.has(i.produto));
  const alternarTodos = () =>
    setSelecionados((prev) => {
      const n = new Set(prev);
      if (todosSel) selecionaveis.forEach((i) => n.delete(i.produto));
      else selecionaveis.forEach((i) => n.add(i.produto));
      return n;
    });

  const [modal, setModal] = useState<{ produtos: string[] } | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const aplicarLocal = (aplicados: Array<{ produto: string; de: number | null; para: number }>) => {
    const agoraIso = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 19);
    setPainel((prev) => {
      if (!prev) return prev;
      const mapa = new Map(aplicados.map((a) => [a.produto, a]));
      return {
        ...prev,
        itens: prev.itens.map((it) => {
          const a = mapa.get(it.produto);
          if (!a) return it;
          return {
            ...it,
            precoAtual: a.para,
            rebaixas: [
              ...it.rebaixas,
              { data: agoraIso, lote: "", de: a.de, para: a.para, usuario: username, painel: true },
            ],
          };
        }),
      };
    });
  };

  /* ── render ── */

  const temBlack = painel && painel.inicio && painel.itens.length > 0;
  const atualizadoAs = painel
    ? new Date(painel.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;
  const diaNumero = painel?.inicio ? painel.dias.length : 0;
  const baseDias = painel?.base?.dias ?? 28;

  const liftQtde =
    resumo.qtdeBase > 0 && painel ? resumo.qtde / painel.diasDecorridos / (resumo.qtdeBase / baseDias) : null;
  const liftVendas =
    resumo.vendasBase > 0 && painel
      ? resumo.vendas / painel.diasDecorridos / (resumo.vendasBase / baseDias)
      : null;
  const participacao = totaisLojas && totaisLojas.total.vendas > 0 ? resumo.vendas / totaisLojas.total.vendas : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{companyName}</p>
          <h1 className={styles.title}>Black Friday</h1>
          <p className={styles.subtitle}>
            {temBlack ? (
              <>
                Desde {fmtDia(painel!.inicio!)} · {diaNumero}º dia · {fmtQ(painel!.itens.length)} itens na Black
                {atualizadoAs && <> · atualizado às {atualizadoAs}</>}
              </>
            ) : (
              "Itens que entraram na Black pelo Programar Preços"
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.fimLabel}>
            Fim da Black
            <input type="date" value={fim} onChange={(e) => e.target.value && mudarFim(e.target.value)} />
          </label>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setRecarga((n) => n + 1)}
            disabled={carregando}
          >
            {carregando ? "Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
      </header>

      {aviso && (
        <div className={aviso.tipo === "ok" ? styles.avisoOk : styles.avisoErro} role="status">
          <span>{aviso.texto}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      {erro && <div className={styles.avisoErro}>{erro}</div>}

      {carregando && !painel && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Somando a venda dos itens da Black dia a dia, loja a loja…</p>
          <span>Pode levar alguns segundos.</span>
        </div>
      )}

      {painel && !temBlack && !carregando && (
        <div className={styles.vazio}>
          Nenhum item da Black Friday encontrado no histórico de preços desta empresa. Os itens entram aqui quando
          uma tarefa com &quot;Black Friday&quot; no nome é aplicada no Programar Preços.
        </div>
      )}

      {temBlack && (
        <div className={carregando ? styles.atualizando : undefined}>
          {/* ── KPIs ── */}
          <section className={styles.kpis}>
            <Kpi
              titulo="Venda dos itens da Black"
              valor={fmtR0(resumo.vendas)}
              linhas={[
                liftVendas !== null ? `${fmtX(liftVendas)} o ritmo em R$ de antes` : "sem venda antes da Black",
                participacao !== null ? `${fmtPct(participacao, 1)} da venda total da empresa` : "participação: calculando…",
              ]}
              destaque
            />
            <Kpi
              titulo="Peças vendidas"
              valor={fmtQ(resumo.qtde)}
              linhas={[
                liftQtde !== null ? `${fmtX(liftQtde)} o ritmo em peças de antes` : "—",
                `${dec1.format(resumo.qtde / painel!.diasDecorridos)} pç/dia`,
              ]}
            />
            <Kpi
              titulo="Hoje até agora"
              valor={fmtR0(resumo.vendasHoje)}
              linhas={[`${fmtQ(resumo.qtdeHoje)} peças`, fmtDia(painel!.hoje)]}
            />
            <Kpi
              titulo="Itens com venda"
              valor={`${fmtQ(resumo.comVenda)} de ${fmtQ(itens.length)}`}
              linhas={[`${fmtPct(itens.length ? resumo.comVenda / itens.length : 0)} dos itens já venderam`]}
            />
            <Kpi
              titulo="Estoque restante"
              valor={`${fmtQ(resumo.estoque)} pç`}
              linhas={[`${fmtR0(resumo.estoqueCusto)} a custo`, `${fmtR0(resumo.estoquePreco)} a preço atual`]}
            />
            <Kpi
              titulo="Sobra prevista no fim"
              valor={fmtR0(resumo.sobraCusto)}
              linhas={[`a custo, no ritmo atual`, `faltam ${dec1.format(diasRestantes)} dias (até ${fmtDia(fim)})`]}
              alerta={resumo.sobraCusto > 0}
            />
          </section>

          {/* ── barra de status (filtro rápido) ── */}
          <section className={styles.statusBar} aria-label="Itens por situação">
            <div className={styles.statusTrack}>
              {STATUS_ORDEM.filter((s) => resumo.porStatus[s] > 0).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.statusSeg} ${styles[STATUS_META[s].classe]}`}
                  style={{ flexGrow: resumo.porStatus[s] }}
                  title={`${STATUS_META[s].label}: ${resumo.porStatus[s]} itens`}
                  onClick={() => alternarStatus(s)}
                  aria-label={`Filtrar ${STATUS_META[s].label}`}
                />
              ))}
            </div>
            <div className={styles.statusLegenda}>
              {STATUS_ORDEM.filter((s) => resumo.porStatus[s] > 0).map((s) => (
                <span key={s} title={STATUS_META[s].dica}>
                  <StatusBadge status={s} /> <strong>{fmtQ(resumo.porStatus[s])}</strong>{" "}
                  <small>{fmtPct(itens.length ? resumo.porStatus[s] / itens.length : 0)}</small>
                </span>
              ))}
            </div>
          </section>

          {/* ── curva diária ── */}
          <GraficoDiario serie={serie} baseVendasDia={resumo.vendasBase / baseDias} baseQtdeDia={resumo.qtdeBase / baseDias} hoje={painel!.hoje} />

          {/* ── abas ── */}
          <nav className={styles.tabs}>
            {(
              [
                ["produtos", porCor ? `Itens por cor (${fmtQ(itens.length)})` : `Produtos (${fmtQ(itens.length)})`],
                ["lojas", "Lojas"],
                ["categorias", "Categorias"],
              ] as Array<[Aba, string]>
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`${styles.tab} ${aba === k ? styles.tabOn : ""}`}
                onClick={() => setAba(k)}
              >
                {l}
              </button>
            ))}
          </nav>

          <FiltroSituacao
            selecionados={filtroStatus}
            contagem={contagemStatus.porStatus}
            total={contagemStatus.total}
            onAlternar={alternarStatus}
            onTodos={() => setFiltroStatus(new Set())}
          />

          {aba === "produtos" && (
            <section className={styles.card}>
              <div className={styles.toolbar}>
                <div className={styles.segmented} role="group" aria-label="Detalhamento">
                  <button type="button" className={porCor ? styles.segOn : ""} onClick={() => mudarPorCor(true)}>
                    Por cor
                  </button>
                  <button type="button" className={!porCor ? styles.segOn : ""} onClick={() => mudarPorCor(false)}>
                    Por produto
                  </button>
                </div>
                <input
                  className={styles.search}
                  placeholder="Buscar código, nome, coleção…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
                  <option value="">Todas as categorias</option>
                  {categorias.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <label className={styles.check}>
                  <input type="checkbox" checked={soComEspaco} onChange={(e) => setSoComEspaco(e.target.checked)} />
                  Só com espaço para baixar
                </label>
                <span className={styles.toolbarCount}>
                  {fmtQ(filtrados.length)} {filtrados.length === 1 ? "item" : "itens"}
                </span>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {podeExecutar && (
                        <th className={styles.colCheck}>
                          <input
                            type="checkbox"
                            checked={todosSel}
                            onChange={alternarTodos}
                            title="Selecionar todos os filtrados que ainda podem baixar"
                          />
                        </th>
                      )}
                      <Th o="produto" atual={ordem} desc={desc} onClick={ordenarPor} alinhar="left">
                        Produto
                      </Th>
                      <th>Situação</th>
                      <Th o="desconto" atual={ordem} desc={desc} onClick={ordenarPor}>
                        Preço
                      </Th>
                      <Th o="margem" atual={ordem} desc={desc} onClick={ordenarPor}>
                        Custo · margem
                      </Th>
                      <Th o="vendas" atual={ordem} desc={desc} onClick={ordenarPor} dica="Venda líquida na Black (trocas abatidas)">
                        Vendido
                      </Th>
                      <Th o="hoje" atual={ordem} desc={desc} onClick={ordenarPor}>
                        Hoje
                      </Th>
                      <Th o="lift" atual={ordem} desc={desc} onClick={ordenarPor} dica="Ritmo de peças/dia na Black ÷ ritmo nos 28 dias antes">
                        vs antes
                      </Th>
                      <Th o="estoque" atual={ordem} desc={desc} onClick={ordenarPor}>
                        Estoque
                      </Th>
                      <Th o="sobra" atual={ordem} desc={desc} onClick={ordenarPor} dica="Sobra prevista: peças que sobram no fim da Black no ritmo atual (valor a custo)">
                        Sobra
                      </Th>
                      <th className={styles.obsHeader}>Obs.</th>
                      {podeExecutar && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.slice(0, limite).map((it) => (
                      <Fragment key={it.chave}>
                        <tr
                          className={`${styles.row} ${aberto === it.chave ? styles.rowOpen : ""}`}
                          onClick={() => setAberto((a) => (a === it.chave ? null : it.chave))}
                        >
                          {podeExecutar && (
                            <td className={styles.colCheck} onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selecionados.has(it.produto)}
                                disabled={it.noPiso}
                                onChange={() => alternarSel(it.produto)}
                                title={it.noPiso ? "Já está no custo: não pode baixar mais" : "Selecionar"}
                              />
                            </td>
                          )}
                          <td className={styles.colProduto}>
                            <DescricaoItem it={it} company={companyKey} />
                          </td>
                          <td>
                            <StatusBadge status={it.status} />
                          </td>
                          <td className={styles.num}>
                            <span className={styles.precoAtual}>{fmtR(it.precoAtual)}</span>
                            <span className={styles.precoOrig}>
                              <s>{fmtR(it.precoOriginal)}</s>
                              {it.desconto !== null && <b>−{fmtPct(it.desconto)}</b>}
                            </span>
                          </td>
                          <td className={styles.num}>
                            <span>{fmtR(it.custo)}</span>
                            <span className={it.noPiso ? styles.margemPiso : styles.sub}>
                              {it.noPiso ? "no piso" : `margem ${fmtPct(it.margem)}`}
                            </span>
                          </td>
                          <td className={styles.num}>
                            <strong>{fmtQ(it.qtde)} pç</strong>
                            <span className={styles.sub}>{fmtR(it.vendas)}</span>
                          </td>
                          <td className={styles.num}>{it.qtdeHoje ? <strong>{fmtQ(it.qtdeHoje)}</strong> : <span className={styles.sub}>—</span>}</td>
                          <td className={styles.num}>
                            <Lift lift={it.lift} qtde={it.qtde} />
                          </td>
                          <td className={styles.num}>{fmtQ(it.estoque)}</td>
                          <td className={styles.num}>
                            {it.sobra > 0.5 ? (
                              <>
                                <span>{fmtQ(it.sobra)} pç</span>
                                <span className={styles.sub}>{fmtR0(it.sobraCusto)}</span>
                              </>
                            ) : (
                              <span className={styles.ok}>zera</span>
                            )}
                          </td>
                          <td className={styles.obsCell} onClick={(e) => e.stopPropagation()}>
                            <ObservacaoCell
                              produto={it.produto}
                              cor={it.cor}
                              titulo={it.descricao}
                              corLabel={it.cor ? it.corDesc : null}
                              observacao={observacoes[chaveObs(it.produto, it.cor)] ?? ""}
                              onSave={salvarObservacao}
                            />
                          </td>
                          {podeExecutar && (
                            <td onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={styles.btnBaixar}
                                disabled={it.noPiso}
                                title={it.noPiso ? "Preço já está no custo" : `Pode baixar até ${fmtR(it.custo)}`}
                                onClick={() => setModal({ produtos: [it.produto] })}
                              >
                                Baixar
                              </button>
                            </td>
                          )}
                        </tr>
                        {aberto === it.chave && (
                          <tr className={styles.detailRow}>
                            <td colSpan={podeExecutar ? 12 : 10}>
                              <DetalheProduto item={it} dias={painel!.dias} lojas={painel!.lojas} baseDias={baseDias} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {filtrados.length === 0 && <div className={styles.vazioTabela}>Nenhum item com esses filtros.</div>}
              </div>
              {filtrados.length > limite && (
                <button type="button" className={styles.maisBtn} onClick={() => setLimite((l) => l + PAGINA * 2)}>
                  Mostrar mais ({fmtQ(filtrados.length - limite)} restantes)
                </button>
              )}
            </section>
          )}

          {aba === "lojas" && (
            <PainelLojas
              company={companyKey}
              itens={itensPorStatus}
              filtrado={filtroStatus.size > 0}
              lojas={painel!.lojas}
              totais={totaisLojas}
              diasDecorridos={painel!.diasDecorridos}
              baseDias={baseDias}
            />
          )}

          {aba === "categorias" && (
            <PainelCategorias itens={itensPorStatus} diasDecorridos={painel!.diasDecorridos} baseDias={baseDias} onVer={verCategoria} />
          )}
        </div>
      )}

      {/* ── barra de ação em lote ── */}
      {podeExecutar && selecionados.size > 0 && (
        <div className={styles.bulkBar}>
          <span>
            <strong>{fmtQ(selecionados.size)}</strong> {selecionados.size === 1 ? "item selecionado" : "itens selecionados"}
          </span>
          <button type="button" className={styles.linkBtn} onClick={() => setSelecionados(new Set())}>
            limpar
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setModal({ produtos: [...selecionados] })}
          >
            Baixar preço dos selecionados…
          </button>
        </div>
      )}

      {modal && (
        <ModalRebaixa
          itens={itensProduto.filter((i) => modal.produtos.includes(i.produto))}
          company={companyKey}
          username={username}
          onClose={() => setModal(null)}
          onAplicado={(aplicados, mensagem, okTudo) => {
            aplicarLocal(aplicados);
            setSelecionados(new Set());
            setModal(null);
            setAviso({ tipo: okTudo ? "ok" : "erro", texto: mensagem });
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════ peças ═══════════════════════════════ */

function Kpi({
  titulo,
  valor,
  linhas,
  destaque,
  alerta,
}: {
  titulo: string;
  valor: string;
  linhas: string[];
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className={`${styles.kpi} ${destaque ? styles.kpiDestaque : ""} ${alerta ? styles.kpiAlerta : ""}`}>
      <span className={styles.kpiTitulo}>{titulo}</span>
      <strong className={styles.kpiValor}>{valor}</strong>
      {linhas.map((l) => (
        <span key={l} className={styles.kpiLinha}>
          {l}
        </span>
      ))}
    </div>
  );
}

/**
 * Descrição da linha:
 *  - 1ª linha: nome do item + etiqueta colorida da cor (na visão por produto: "N cores")
 *  - 2ª linha: código | categoria (Scarfme: • grade)
 *  - 3ª linha: subgrupo (só Scarfme)
 */
function DescricaoItem({ it, company, compacto }: { it: Item; company?: CompanyKey; compacto?: boolean }) {
  const scarfme = company === "scarfme";
  const subgrupo = scarfme ? (it.subgrupo ?? "").trim() : "";
  const rebaixas = it.rebaixas.filter((r) => r.painel).length;
  const nCores = it.coresCalc.length;
  return (
    <>
      <span className={styles.prodLinhaNome}>
        <span className={styles.prodNome}>{it.descricao}</span>
        {it.cor ? (
          <span className={styles.corTag} title={`Cor ${it.cor}`}>
            {it.corDesc}
          </span>
        ) : (
          nCores > 1 && <span className={styles.corTagMuted}>{nCores} cores</span>
        )}
      </span>
      <span className={styles.prodMeta}>
        <span>{it.produto}</span>
        {!compacto && (
          <>
            <span className={styles.sep}>|</span>
            <span>
              {it.categoria}
              {scarfme && it.grade ? ` • ${it.grade}` : ""}
            </span>
          </>
        )}
        {rebaixas > 0 && <span className={styles.tagRebaixa}>{rebaixas}× rebaixado</span>}
      </span>
      {subgrupo && <span className={styles.prodCor}>{subgrupo}</span>}
    </>
  );
}

/** Filtro de situação: cada clique liga/desliga uma situação (dá para somar várias). */
function FiltroSituacao({
  selecionados,
  contagem,
  total,
  onAlternar,
  onTodos,
}: {
  selecionados: Set<Status>;
  contagem: Record<Status, number>;
  total: number;
  onAlternar: (s: Status) => void;
  onTodos: () => void;
}) {
  const nenhum = selecionados.size === 0;
  return (
    <div className={styles.filtroSituacao} role="group" aria-label="Filtrar por situação">
      <span className={styles.filtroLabel}>Filtrar por situação</span>
      <button
        type="button"
        className={`${styles.filtroOpcao} ${styles.filtroTodos} ${nenhum ? styles.filtroOpcaoOn : ""}`}
        onClick={onTodos}
        aria-pressed={nenhum}
      >
        Todos <strong>{fmtQ(total)}</strong>
      </button>
      {STATUS_ORDEM.map((s) => {
        const on = selecionados.has(s);
        const m = STATUS_META[s];
        return (
          <button
            key={s}
            type="button"
            className={`${styles.filtroOpcao} ${styles[m.classe]} ${on ? styles.filtroOpcaoOn : ""}`}
            onClick={() => onAlternar(s)}
            disabled={contagem[s] === 0 && !on}
            aria-pressed={on}
            title={m.dica}
          >
            <span className={styles.filtroIcone} aria-hidden>
              {m.icone}
            </span>
            {m.label} <strong>{fmtQ(contagem[s])}</strong>
          </button>
        );
      })}
      {!nenhum && (
        <button type="button" className={styles.linkBtn} onClick={onTodos}>
          limpar filtro
        </button>
      )}
    </div>
  );
}

/* ── observação do item (cópia do funcionamento da Curva ABC, sem escopo de filial) ── */

const OBS_MAX = 240;

function ObservacaoCell({
  produto,
  cor,
  titulo,
  corLabel,
  observacao,
  onSave,
}: {
  produto: string;
  cor: string;
  titulo: string;
  corLabel: string | null;
  observacao: string;
  onSave: (produto: string, cor: string, valor: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const preenchida = observacao.trim().length > 0;

  async function salvar(valor: string) {
    setSaving(true);
    setError(undefined);
    const r = await onSave(produto, cor, valor);
    setSaving(false);
    if (r.ok) setOpen(false);
    else setError(r.error || "Erro ao salvar observação.");
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.obsTrigger} ${preenchida ? "" : styles.obsTriggerEmpty} ${error ? styles.obsTriggerError : ""}`}
        disabled={saving}
        title={error ? `Erro ao salvar: ${error}` : preenchida ? observacao : "Adicionar observação"}
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        <span className={`${styles.obsTriggerText} ${preenchida ? "" : styles.obsTriggerTextMuted}`}>
          {saving ? "Salvando..." : preenchida ? observacao.trim() : "Sem observação"}
        </span>
        <span className={styles.obsTriggerIcon} aria-hidden>
          ✎
        </span>
      </button>
      {open && (
        <ObservacaoModal
          titulo={titulo}
          codigo={produto}
          corLabel={corLabel}
          initialValue={observacao}
          saving={saving}
          error={error}
          onClose={() => {
            if (!saving) setOpen(false);
          }}
          onSave={(v) => void salvar(v)}
        />
      )}
    </>
  );
}

function ObservacaoModal({
  titulo,
  codigo,
  corLabel,
  initialValue,
  saving,
  error,
  onClose,
  onSave,
}: {
  titulo: string;
  codigo: string;
  corLabel: string | null;
  initialValue: string;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSave: (valor: string) => void;
}) {
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => {
    const overflowAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflowAntes;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className={styles.obsModalOverlay} onClick={onClose}>
      <div className={styles.obsModal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.obsModalHeader}>
          <div>
            <h3 className={styles.obsModalTitle}>Observação do item</h3>
            <div className={styles.obsModalMeta}>
              <strong>{titulo}</strong>
              <span>Cód. {codigo}</span>
              {corLabel ? <span>Cor: {corLabel}</span> : <span>Produto (todas as cores)</span>}
            </div>
          </div>
          <button type="button" className={styles.obsModalClose} onClick={onClose} aria-label="Fechar modal de observação">
            ×
          </button>
        </div>
        <div className={styles.obsModalBody}>
          <textarea
            className={styles.obsInput}
            value={draft}
            maxLength={OBS_MAX}
            rows={7}
            autoFocus
            placeholder="Escreva uma observação para este item"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (!(e.key === "Enter" && (e.metaKey || e.ctrlKey))) return;
              e.preventDefault();
              onSave(draft);
            }}
          />
          <div className={styles.obsModalHint}>
            {draft.trim().length}/{OBS_MAX} caracteres · Ctrl+Enter salva
          </div>
          {error && <div className={styles.obsModalError}>{error}</div>}
        </div>
        <div className={styles.obsModalFooter}>
          <button
            type="button"
            className={styles.obsModalButtonGhost}
            disabled={saving || draft.length === 0}
            onClick={() => setDraft("")}
          >
            Limpar
          </button>
          <button type="button" className={styles.obsModalButtonSecondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={styles.obsModalButtonPrimary} disabled={saving} onClick={() => onSave(draft)}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return (
    <span className={`${styles.badge} ${styles[m.classe]}`} title={m.dica}>
      <span aria-hidden>{m.icone}</span> {m.label}
    </span>
  );
}

function Lift({ lift, qtde }: { lift: number | null; qtde: number }) {
  if (qtde <= 0) return <span className={styles.sub}>—</span>;
  if (lift === null) return <span className={styles.liftUp} title="Não vendia nos 28 dias antes da Black">novo</span>;
  const cls = lift >= 2 ? styles.liftUp : lift < 1.2 ? styles.liftDown : styles.liftMid;
  return <span className={cls}>{fmtX(lift)}</span>;
}

function Th({
  o,
  atual,
  desc,
  onClick,
  children,
  alinhar,
  dica,
}: {
  o: Ordem;
  atual: Ordem;
  desc: boolean;
  onClick: (o: Ordem) => void;
  children: React.ReactNode;
  alinhar?: "left";
  dica?: string;
}) {
  return (
    <th
      className={`${styles.thSort} ${alinhar === "left" ? styles.thLeft : ""} ${atual === o ? styles.thOn : ""}`}
      onClick={() => onClick(o)}
      title={dica}
    >
      {children}
      <span className={styles.sortArrow}>{atual === o ? (desc ? "↓" : "↑") : ""}</span>
    </th>
  );
}

/* ── gráfico diário (barras em HTML, 1 série + linha de referência) ── */

function GraficoDiario({
  serie,
  baseVendasDia,
  baseQtdeDia,
  hoje,
}: {
  serie: Array<{ dia: string; v: number; q: number }>;
  baseVendasDia: number;
  baseQtdeDia: number;
  hoje: string;
}) {
  const [modo, setModo] = useState<"v" | "q">("v");
  const [hover, setHover] = useState<number | null>(null);
  const valores = serie.map((s) => (modo === "v" ? s.v : s.q));
  const base = modo === "v" ? baseVendasDia : baseQtdeDia;
  const max = Math.max(1, base * 1.15, ...valores);
  const fmt = (n: number) => (modo === "v" ? fmtR0(n) : `${fmtQ(n)} pç`);
  const sel = hover !== null ? serie[hover] : null;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Venda dos itens da Black por dia</h2>
          <p className={styles.cardSub}>
            Linha tracejada = média diária dos mesmos itens nos 28 dias antes da Black (preço cheio).
          </p>
        </div>
        <div className={styles.segmented}>
          <button type="button" className={modo === "v" ? styles.segOn : ""} onClick={() => setModo("v")}>
            R$
          </button>
          <button type="button" className={modo === "q" ? styles.segOn : ""} onClick={() => setModo("q")}>
            Peças
          </button>
        </div>
      </div>

      <div className={styles.chart} onMouseLeave={() => setHover(null)}>
        <div className={styles.chartTooltip} style={{ visibility: sel ? "visible" : "hidden" }}>
          {sel && (
            <>
              <strong>
                {diaSemana(sel.dia)} {fmtDia(sel.dia)}
                {sel.dia === hoje ? " (até agora)" : ""}
              </strong>
              <span>{fmtR(sel.v)} · {fmtQ(sel.q)} pç</span>
              {base > 0 && (
                <span className={styles.sub}>
                  {fmtX((modo === "v" ? sel.v : sel.q) / base)} a média de antes ({fmt(base)}/dia)
                </span>
              )}
            </>
          )}
        </div>
        <div className={styles.chartPlot}>
          {base > 0 && (
            <div className={styles.chartBase} style={{ bottom: `${(base / max) * 100}%` }}>
              <span>antes: {fmt(base)}/dia</span>
            </div>
          )}
          {serie.map((s, i) => {
            const v = valores[i];
            const h = Math.max(0, (v / max) * 100);
            return (
              <div
                key={s.dia}
                className={styles.chartCol}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={0}
                aria-label={`${fmtDia(s.dia)}: ${fmt(v)}`}
              >
                <div
                  className={`${styles.chartBar} ${s.dia === hoje ? styles.chartBarHoje : ""} ${hover === i ? styles.chartBarHover : ""}`}
                  style={{ height: `${h}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className={styles.chartAxis}>
          {serie.map((s) => (
            <span key={s.dia}>
              {fmtDia(s.dia)}
              <small>{s.dia === hoje ? "hoje" : diaSemana(s.dia)}</small>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── detalhe do produto (linha expandida) ── */

function DetalheProduto({
  item,
  dias,
  lojas,
  baseDias,
}: {
  item: Item;
  dias: string[];
  lojas: LojaApi[];
  baseDias: number;
}) {
  const linhas = lojas
    .map((l) => {
      const v = item.porLoja[l.key];
      const est = item.estoqueLojas[l.key] ?? 0;
      return { loja: l, v, est };
    })
    .filter((r) => (r.v && (r.v.q !== 0 || r.v.qb !== 0 || r.v.v !== 0)) || r.est > 0)
    .sort((a, b) => (b.v?.q ?? 0) - (a.v?.q ?? 0) || b.est - a.est);
  const maxDia = Math.max(1, ...item.dia.map((d) => d[1]));
  const lojasSemVenda = linhas.filter((r) => !r.loja.matriz && r.est > 0 && (r.v?.q ?? 0) <= 0);
  const cores = item.coresCalc;

  return (
    <div className={styles.detail}>
      <div className={styles.detailCol}>
        {cores.length > 0 && (
          <>
            <h3>Por cor</h3>
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>Cor</th>
                  <th>Situação</th>
                  <th>Vendido</th>
                  <th>R$</th>
                  <th>Hoje</th>
                  <th title={`Peças vendidas nos ${baseDias} dias antes da Black`}>Antes ({baseDias}d)</th>
                  <th>Estoque</th>
                  <th title="Peças que sobram no fim da Black no ritmo atual">Sobra</th>
                </tr>
              </thead>
              <tbody>
                {cores.map((c) => (
                  <tr key={c.chave}>
                    <td>
                      <span className={styles.prodNome}>{c.corDesc}</span>
                      <span className={styles.prodMeta}>{c.cor}</span>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>{fmtQ(c.qtde)}</td>
                    <td>{fmtR(c.vendas)}</td>
                    <td>{c.qtdeHoje ? fmtQ(c.qtdeHoje) : "—"}</td>
                    <td>{c.qtdeBase ? fmtQ(c.qtdeBase) : "—"}</td>
                    <td>{fmtQ(c.estoque)}</td>
                    <td>{c.sobra > 0.5 ? `${fmtQ(c.sobra)} pç` : <span className={styles.ok}>zera</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <h3>{item.cor ? `Onde vendeu e onde tem estoque — ${item.corDesc}` : "Onde vendeu e onde tem estoque"}</h3>
        <table className={styles.miniTable}>
          <thead>
            <tr>
              <th>Loja</th>
              <th>Vendido</th>
              <th>R$</th>
              <th>Hoje</th>
              <th title={`Peças vendidas nos ${baseDias} dias antes da Black (preço cheio)`}>Antes ({baseDias}d)</th>
              <th>Estoque</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ loja, v, est }) => (
              <tr key={loja.key} className={loja.matriz ? styles.mutedRow : undefined}>
                <td>{loja.matriz ? `${loja.label} (matriz)` : loja.label}</td>
                <td>{v ? fmtQ(v.q) : "—"}</td>
                <td>{v ? fmtR(v.v) : "—"}</td>
                <td>{v && v.qh ? fmtQ(v.qh) : "—"}</td>
                <td>{v && v.qb ? fmtQ(v.qb) : "—"}</td>
                <td className={est > 0 && (v?.q ?? 0) <= 0 && !loja.matriz ? styles.warnCell : undefined}>{fmtQ(est)}</td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={6}>Sem venda nem estoque em nenhuma loja.</td>
              </tr>
            )}
          </tbody>
        </table>
        {lojasSemVenda.length > 0 && (
          <p className={styles.dica}>
            Tem estoque e não vendeu em: {lojasSemVenda.map((r) => r.loja.label).join(", ")} — vale olhar exposição
            ou transferir para onde gira.
          </p>
        )}
      </div>
      <div className={styles.detailCol}>
        <h3>Peças por dia</h3>
        <div className={styles.spark}>
          {item.dia.map((d, i) => (
            <div key={dias[i]} className={styles.sparkCol} title={`${fmtDia(dias[i])}: ${fmtQ(d[1])} pç · ${fmtR(d[0])}`}>
              <div className={styles.sparkBar} style={{ height: `${(Math.max(0, d[1]) / maxDia) * 100}%` }} />
              <span>{dias[i].slice(8, 10)}</span>
            </div>
          ))}
        </div>
        <p className={styles.sub}>
          Antes da Black: {dec1.format(item.ritmoBase)} pç/dia · Na Black: {dec1.format(item.ritmo)} pç/dia
        </p>

        <h3>Preço</h3>
        <ul className={styles.timeline}>
          <li>
            <span>Original</span>
            <strong>{fmtR(item.precoOriginal)}</strong>
          </li>
          {item.rebaixas.map((r, i) => (
            <li key={`${r.lote}-${i}`}>
              <span>
                {fmtDia(r.data.slice(0, 10))} {r.data.slice(11, 16)} · {r.painel ? "rebaixa do painel" : "tarefa da Black"}
                {r.usuario ? ` · ${r.usuario}` : ""}
              </span>
              <strong>
                {fmtR(r.de)} → {fmtR(r.para)}
              </strong>
            </li>
          ))}
          <li>
            <span>Piso (custo)</span>
            <strong>{fmtR(item.custo)}</strong>
          </li>
        </ul>
        {item.cor && <p className={styles.sub}>O preço é do produto e vale para todas as cores.</p>}
        <p className={styles.sub}>
          {item.noPiso
            ? "Preço já está no custo: não dá para baixar mais."
            : `Ainda dá para baixar ${fmtR(item.espaco)} (${fmtPct(item.precoAtual ? item.espaco / item.precoAtual : 0)}) até o custo.`}
        </p>
      </div>
    </div>
  );
}

/* ── lojas ── */

function PainelLojas({
  itens,
  lojas,
  totais,
  diasDecorridos,
  baseDias,
  filtrado,
  company,
}: {
  company: CompanyKey;
  itens: Item[];
  lojas: LojaApi[];
  totais: TotaisLojasApi | null;
  filtrado: boolean;
  diasDecorridos: number;
  baseDias: number;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [verParados, setVerParados] = useState(false);

  const linhas = useMemo(() => {
    const totalPorLoja = new Map((totais?.lojas ?? []).map((l) => [l.label, l]));
    return lojas
      .filter((l) => !l.matriz)
      .map((l) => {
        let v = 0;
        let q = 0;
        let vh = 0;
        let qh = 0;
        let vb = 0;
        let qb = 0;
        let itensVendidos = 0;
        let estoque = 0;
        let parados = 0;
        for (const it of itens) {
          const x = it.porLoja[l.key];
          const est = it.estoqueLojas[l.key] ?? 0;
          estoque += est;
          if (x) {
            v += x.v;
            q += x.q;
            vh += x.vh;
            qh += x.qh;
            vb += x.vb;
            qb += x.qb;
            if (x.q > 0) itensVendidos += 1;
          }
          if (est > 0 && (!x || x.q <= 0)) parados += 1;
        }
        const total = totalPorLoja.get(l.label);
        return {
          loja: l,
          v,
          q,
          vh,
          qh,
          itensVendidos,
          estoque,
          parados,
          lift: qb > 0 ? q / diasDecorridos / (qb / baseDias) : null,
          liftV: vb > 0 ? v / diasDecorridos / (vb / baseDias) : null,
          participacao: total && total.vendas > 0 ? v / total.vendas : null,
          totalLoja: total?.vendas ?? null,
        };
      })
      .filter((r) => r.v !== 0 || r.q !== 0 || r.estoque > 0)
      .sort((a, b) => b.v - a.v);
  }, [itens, lojas, totais, diasDecorridos, baseDias]);

  const maxV = Math.max(1, ...linhas.map((r) => r.v));

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>
            Lojas — {filtrado ? "só os itens da situação escolhida" : "só os itens da Black"}
          </h2>
          <p className={styles.cardSub}>
            Clique numa loja para ver o que vendeu nela. &quot;% da loja&quot; = venda desses itens ÷ venda total da
            loja no mesmo período.
          </p>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thLeft}>Loja</th>
              <th className={styles.thLeft}>Venda da Black</th>
              <th>Peças</th>
              <th>Hoje</th>
              <th title="Peças/dia na Black ÷ peças/dia nos 28 dias antes">vs antes</th>
              <th>% da loja</th>
              <th>Itens vendidos</th>
              <th title="Itens da Black com estoque nesta loja e nenhuma venda nela">Parados aqui</th>
              <th>Estoque Black</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((r) => (
              <Fragment key={r.loja.key}>
                <tr
                  className={`${styles.row} ${aberta === r.loja.key ? styles.rowOpen : ""}`}
                  onClick={() => {
                    setAberta((a) => (a === r.loja.key ? null : r.loja.key));
                    setVerParados(false);
                  }}
                >
                  <td className={styles.colProduto}>
                    <span className={styles.prodNome}>{r.loja.label}</span>
                  </td>
                  <td className={styles.barCell}>
                    <div className={styles.inlineBar}>
                      <div style={{ width: `${Math.max(0, (r.v / maxV) * 100)}%` }} />
                    </div>
                    <span>{fmtR0(r.v)}</span>
                  </td>
                  <td className={styles.num}>{fmtQ(r.q)}</td>
                  <td className={styles.num}>{r.qh ? `${fmtQ(r.qh)} pç` : "—"}</td>
                  <td className={styles.num}>
                    <Lift lift={r.lift} qtde={r.q} />
                  </td>
                  <td className={styles.num}>
                    {r.participacao !== null ? fmtPct(r.participacao, 1) : totais ? "—" : "…"}
                    {r.totalLoja !== null && <span className={styles.sub}>de {fmtR0(r.totalLoja)}</span>}
                  </td>
                  <td className={styles.num}>{fmtQ(r.itensVendidos)}</td>
                  <td className={styles.num}>
                    {r.parados > 0 ? <span className={styles.warnText}>{fmtQ(r.parados)}</span> : "—"}
                  </td>
                  <td className={styles.num}>{fmtQ(r.estoque)} pç</td>
                </tr>
                {aberta === r.loja.key && (
                  <tr className={styles.detailRow}>
                    <td colSpan={9}>
                      <DetalheLoja
                        company={company}
                        itens={itens}
                        loja={r.loja}
                        verParados={verParados}
                        setVerParados={setVerParados}
                        baseDias={baseDias}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetalheLoja({
  company,
  itens,
  loja,
  verParados,
  setVerParados,
  baseDias,
}: {
  company: CompanyKey;
  itens: Item[];
  loja: LojaApi;
  verParados: boolean;
  setVerParados: (v: boolean) => void;
  baseDias: number;
}) {
  const vendidos = itens
    .map((it) => ({ it, x: it.porLoja[loja.key], est: it.estoqueLojas[loja.key] ?? 0 }))
    .filter((r) => r.x && (r.x.q !== 0 || r.x.v !== 0))
    .sort((a, b) => b.x!.v - a.x!.v);
  const parados = itens
    .map((it) => ({ it, est: it.estoqueLojas[loja.key] ?? 0, x: it.porLoja[loja.key] }))
    .filter((r) => r.est > 0 && (!r.x || r.x.q <= 0))
    .sort((a, b) => b.est * b.it.custo - a.est * a.it.custo);

  const lista = verParados ? parados : vendidos;

  return (
    <div className={styles.detailLoja}>
      <div className={styles.segmented}>
        <button type="button" className={!verParados ? styles.segOn : ""} onClick={() => setVerParados(false)}>
          Vendeu aqui ({fmtQ(vendidos.length)})
        </button>
        <button type="button" className={verParados ? styles.segOn : ""} onClick={() => setVerParados(true)}>
          Tem estoque e não vendeu ({fmtQ(parados.length)})
        </button>
      </div>
      <table className={styles.miniTable}>
        <thead>
          <tr>
            <th>Produto</th>
            <th>Situação na rede</th>
            <th>Preço</th>
            <th>Vendido aqui</th>
            <th>R$ aqui</th>
            <th>Hoje</th>
            <th title={`Peças vendidas aqui nos ${baseDias} dias antes da Black`}>Antes ({baseDias}d)</th>
            <th>Estoque aqui</th>
            <th>Vendido na rede</th>
          </tr>
        </thead>
        <tbody>
          {lista.slice(0, 200).map(({ it, x, est }) => (
            <tr key={it.chave}>
              <td>
                <DescricaoItem it={it} company={company} compacto />
              </td>
              <td>
                <StatusBadge status={it.status} />
              </td>
              <td>{fmtR(it.precoAtual)}</td>
              <td>{x ? fmtQ(x.q) : "—"}</td>
              <td>{x ? fmtR(x.v) : "—"}</td>
              <td>{x && x.qh ? fmtQ(x.qh) : "—"}</td>
              <td>{x && x.qb ? fmtQ(x.qb) : "—"}</td>
              <td>{fmtQ(est)}</td>
              <td>{fmtQ(it.qtde)} pç</td>
            </tr>
          ))}
          {lista.length === 0 && (
            <tr>
              <td colSpan={9}>{verParados ? "Nenhum item parado nesta loja." : "Nenhum item da Black vendido aqui ainda."}</td>
            </tr>
          )}
        </tbody>
      </table>
      {lista.length > 200 && <p className={styles.sub}>Mostrando os 200 primeiros de {fmtQ(lista.length)}.</p>}
    </div>
  );
}

/* ── categorias ── */

function PainelCategorias({
  itens,
  diasDecorridos,
  baseDias,
  onVer,
}: {
  itens: Item[];
  diasDecorridos: number;
  baseDias: number;
  onVer: (c: string) => void;
}) {
  const linhas = useMemo(() => {
    const m = new Map<
      string,
      { cat: string; n: number; v: number; q: number; qb: number; est: number; sobraCusto: number; st: Record<Status, number> }
    >();
    for (const it of itens) {
      let r = m.get(it.categoria);
      if (!r) {
        r = {
          cat: it.categoria,
          n: 0,
          v: 0,
          q: 0,
          qb: 0,
          est: 0,
          sobraCusto: 0,
          st: Object.fromEntries(STATUS_ORDEM.map((s) => [s, 0])) as Record<Status, number>,
        };
        m.set(it.categoria, r);
      }
      r.n += 1;
      r.v += it.vendas;
      r.q += it.qtde;
      r.qb += it.qtdeBase;
      r.est += Math.max(0, it.estoque);
      r.sobraCusto += it.sobraCusto;
      r.st[it.status] += 1;
    }
    return [...m.values()].sort((a, b) => b.v - a.v);
  }, [itens]);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Categorias</h2>
          <p className={styles.cardSub}>Clique numa categoria para abrir os produtos dela.</p>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thLeft}>Categoria</th>
              <th>Itens</th>
              <th>Venda R$</th>
              <th>Peças</th>
              <th>vs antes</th>
              <th>Estoque</th>
              <th>Sobra prevista</th>
              <th className={styles.thLeft}>Situação dos itens</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((r) => (
              <tr key={r.cat} className={styles.row} onClick={() => onVer(r.cat)}>
                <td className={styles.colProduto}>
                  <span className={styles.prodNome}>{r.cat}</span>
                </td>
                <td className={styles.num}>{fmtQ(r.n)}</td>
                <td className={styles.num}>{fmtR0(r.v)}</td>
                <td className={styles.num}>{fmtQ(r.q)}</td>
                <td className={styles.num}>
                  <Lift lift={r.qb > 0 ? r.q / diasDecorridos / (r.qb / baseDias) : null} qtde={r.q} />
                </td>
                <td className={styles.num}>{fmtQ(r.est)}</td>
                <td className={styles.num}>{r.sobraCusto > 0.5 ? fmtR0(r.sobraCusto) : <span className={styles.ok}>zera</span>}</td>
                <td>
                  <div className={styles.miniStack} title={STATUS_ORDEM.map((s) => `${STATUS_META[s].label}: ${r.st[s]}`).join(" · ")}>
                    {STATUS_ORDEM.filter((s) => r.st[s] > 0).map((s) => (
                      <div key={s} className={styles[STATUS_META[s].classe]} style={{ flexGrow: r.st[s] }} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── modal de rebaixa ── */

function ModalRebaixa({
  itens,
  company,
  username,
  onClose,
  onAplicado,
}: {
  itens: Item[];
  company: CompanyKey;
  username: string;
  onClose: () => void;
  onAplicado: (aplicados: Array<{ produto: string; de: number | null; para: number }>, mensagem: string, okTudo: boolean) => void;
}) {
  const unico = itens.length === 1 ? itens[0] : null;
  const [pct, setPct] = useState("10");
  const [preco, setPreco] = useState(() =>
    unico && unico.precoAtual ? String(arred2(unico.precoAtual * 0.9)).replace(".", ",") : ""
  );
  const [modoUnico, setModoUnico] = useState<"pct" | "preco">("pct");
  const [usar90, setUsar90] = useState(company === "nerd");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !enviando && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose, enviando]);

  const pctNum = Number(pct.replace(",", "."));
  const precoNum = Number(preco.replace(/\./g, "").replace(",", "."));

  const propostas = useMemo<PropostaLinha[]>(() => {
    return itens.map((it) => {
      if (unico && modoUnico === "preco") {
        if (!Number.isFinite(precoNum) || precoNum <= 0) {
          return { item: it, novo: null, limitado: false, motivo: "informe o novo preço" };
        }
        if (precoNum < it.custo - 0.005) {
          return { item: it, novo: null, limitado: false, motivo: `abaixo do custo (${fmtR(it.custo)})` };
        }
        return proporRebaixa(it, precoNum, false);
      }
      if (!Number.isFinite(pctNum) || pctNum <= 0 || pctNum >= 100) {
        return { item: it, novo: null, limitado: false, motivo: "informe um % entre 0 e 100" };
      }
      return proporRebaixa(it, (it.precoAtual ?? 0) * (1 - pctNum / 100), usar90);
    });
  }, [itens, unico, modoUnico, precoNum, pctNum, usar90]);

  const validas = propostas.filter((p) => p.novo !== null);
  const limitadas = validas.filter((p) => p.limitado).length;

  const aplicar = async () => {
    if (validas.length === 0) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/black-friday/rebaixar", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company,
          itens: validas.map((p) => ({ produto: p.item.produto, valor: p.novo })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && !json.rejeitados) throw new Error(json.error || `Erro ${res.status}`);
      const rejeitados: Array<{ produto: string; motivo: string }> = json.rejeitados ?? [];
      const r = json.resultado as { aplicados: number; naoConfirmados: number; semMudanca: number; erros: string[] } | null;
      const rejSet = new Set(rejeitados.map((x) => x.produto));
      const falhou = !r || r.naoConfirmados > 0 || r.erros.length > 0;
      const aplicados = falhou
        ? []
        : validas
            .filter((p) => !rejSet.has(p.item.produto))
            .map((p) => ({ produto: p.item.produto, de: p.item.precoAtual, para: p.novo! }));
      const partes: string[] = [];
      if (aplicados.length) partes.push(`${aplicados.length} ${aplicados.length === 1 ? "preço baixado" : "preços baixados"}`);
      if (rejeitados.length)
        partes.push(`${rejeitados.length} recusado(s): ${rejeitados.slice(0, 3).map((x) => `${x.produto} (${x.motivo})`).join("; ")}`);
      if (r && (r.naoConfirmados > 0 || r.erros.length > 0))
        partes.push(`atenção: ${r.erros.join(" | ") || `${r.naoConfirmados} não confirmados`} — clique em Atualizar para conferir`);
      onAplicado(aplicados, partes.join(" · ") || "Nada a alterar.", !falhou && rejeitados.length === 0);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao aplicar.");
      setEnviando(false);
    }
  };

  return (
    <div className={styles.modalBackdrop} onClick={() => !enviando && onClose()}>
      <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2>{unico ? "Baixar preço" : `Baixar preço de ${fmtQ(itens.length)} itens`}</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} disabled={enviando} aria-label="Fechar">
            ×
          </button>
        </div>

        {unico && (
          <div className={styles.modalProduto}>
            <strong>{unico.descricao}</strong>
            <span>
              {unico.produto} · {unico.categoria}
            </span>
            <div className={styles.precoTrio}>
              <div>
                <span>Original</span>
                <strong>{fmtR(unico.precoOriginal)}</strong>
              </div>
              <div>
                <span>Atual na Black</span>
                <strong>{fmtR(unico.precoAtual)}</strong>
                <small>{unico.desconto !== null ? `−${fmtPct(unico.desconto)}` : ""}</small>
              </div>
              <div>
                <span>Piso (custo)</span>
                <strong>{fmtR(unico.custo)}</strong>
                <small>pode baixar até −{fmtPct(unico.precoAtual ? unico.espaco / unico.precoAtual : 0)}</small>
              </div>
            </div>
          </div>
        )}

        <div className={styles.modalForm}>
          {unico && (
            <div className={styles.segmented}>
              <button type="button" className={modoUnico === "pct" ? styles.segOn : ""} onClick={() => setModoUnico("pct")}>
                % sobre o atual
              </button>
              <button type="button" className={modoUnico === "preco" ? styles.segOn : ""} onClick={() => setModoUnico("preco")}>
                Preço exato
              </button>
            </div>
          )}
          {(!unico || modoUnico === "pct") && (
            <>
              <label className={styles.campo}>
                Baixar
                <input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />% sobre o preço atual
              </label>
              <div className={styles.quick}>
                {[5, 10, 15, 20, 30].map((p) => (
                  <button key={p} type="button" onClick={() => setPct(String(p))} className={pctNum === p ? styles.segOn : ""}>
                    −{p}%
                  </button>
                ))}
              </div>
              <label className={styles.check}>
                <input type="checkbox" checked={usar90} onChange={(e) => setUsar90(e.target.checked)} />
                Terminar em ,90 (arredonda para baixo)
              </label>
            </>
          )}
          {unico && modoUnico === "preco" && (
            <label className={styles.campo}>
              Novo preço R$
              <input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} autoFocus />
            </label>
          )}
          <p className={styles.sub}>
            O preço é do produto: vale para todas as cores dele. O preço nunca fica abaixo do custo: quem passaria do piso é limitado ao custo. Grava na tabela de preço da
            Black (PRECO1 + Preço Líquido) e fica no histórico do Programar Preços, de onde pode ser revertido.
          </p>
        </div>

        <div className={styles.previewWrap}>
          <table className={styles.miniTable}>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Atual</th>
                <th>Novo</th>
                <th>Desc. total</th>
                <th>Margem nova</th>
              </tr>
            </thead>
            <tbody>
              {propostas.map((p) => (
                <tr key={p.item.produto} className={p.novo === null ? styles.mutedRow : undefined}>
                  <td>
                    <span className={styles.prodNome}>{p.item.descricao}</span>
                    <span className={styles.prodMeta}>{p.item.produto}</span>
                  </td>
                  <td>{fmtR(p.item.precoAtual)}</td>
                  <td>
                    {p.novo !== null ? (
                      <>
                        <strong>{fmtR(p.novo)}</strong>
                        {p.limitado && <span className={styles.tagPiso}>no custo</span>}
                      </>
                    ) : (
                      <span className={styles.sub}>{p.motivo}</span>
                    )}
                  </td>
                  <td>{p.novo !== null && p.item.precoOriginal ? `−${fmtPct(1 - p.novo / p.item.precoOriginal)}` : "—"}</td>
                  <td>{p.novo !== null ? fmtPct((p.novo - p.item.custo) / p.novo) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {erro && <div className={styles.avisoErro}>{erro}</div>}

        <div className={styles.modalFoot}>
          <span className={styles.sub}>
            {fmtQ(validas.length)} de {fmtQ(itens.length)} vão baixar
            {limitadas > 0 ? ` · ${limitadas} limitado(s) ao custo` : ""}
          </span>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={enviando}>
            Cancelar
          </button>
          <button type="button" className={styles.btnDanger} onClick={aplicar} disabled={enviando || validas.length === 0}>
            {enviando ? "Aplicando…" : `Baixar ${fmtQ(validas.length)} ${validas.length === 1 ? "preço" : "preços"} agora`}
          </button>
        </div>
      </div>
    </div>
  );
}
