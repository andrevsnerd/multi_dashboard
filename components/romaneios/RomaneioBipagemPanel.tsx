"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RomaneioDetalheItem } from "./RomaneioDetalhePage";
import styles from "./RomaneioBipagemPanel.module.css";

/**
 * CONFERÊNCIA POR BIPAGEM — modo alternativo de confirmar um romaneio.
 *
 * O gerente bipa as peças que chegaram; cada bipe soma +1 no item (e no tamanho
 * do código, em peça P/M/G). No fim, "Confirmar" chama a MESMA confirmação do
 * modo manual (`handleConfirmarTudo` da tela) com as quantidades bipadas — entrada
 * em lote, trava de duplicata, divergência na origem e trava de inventário são as
 * de sempre. Este painel só decide as quantidades.
 *
 * Regras do dono (27/10/2026):
 *  - NUNCA confirmar peça fora do romaneio nem acima do que ele diz: o bipe que
 *    passaria do enviado (no tamanho) é recusado com aviso para separar a peça e
 *    avisar a logística. Gerente não ajusta — sobra é a logística que lança.
 *  - Item não bipado fica PENDENTE (não é confirmado com 0); a listagem já mostra
 *    "Parcialmente confirmado" para a logística resolver.
 *
 * Os bipes são eventos no Neon (lib/utils/romaneio-bipagem-store.ts) com fila
 * local: rede caindo não perde leitura, e outro aparelho retoma de onde parou.
 */

// ---------- tipos ----------

type TipoEvento = "bipe" | "excedente" | "fora_romaneio" | "nao_encontrado";

interface Evento {
  id: string;
  tipo: TipoEvento;
  produto: string;
  cor: string;
  tamanho: number | null;
  delta: number;
  codigo: string;
  username: string;
  criadoEm: string;
  /** Já gravado no servidor. */
  sincronizado: boolean;
  /** Quando foi confirmado pelo servidor (ms) — protege contra GET atrasado. */
  sincronizadoEm?: number;
}

interface CodigoBarra {
  produto: string;
  cor: string;
  tamanho: number | null;
}

interface OpcaoEscolha {
  label: string;
  sku: string;
  tamanho: number | null;
}

interface Ocorrencia {
  id: string;
  titulo: string;
  detalhe: string;
  codigo: string;
  /** Código ambíguo / sem tamanho: o operador escolhe a peça. */
  opcoes?: OpcaoEscolha[];
  /** A escolha retira em vez de somar (bipe feito no modo retirar). */
  retirar?: boolean;
}

interface Contagem {
  total: number;
  porTam: Record<number, number>;
}

export interface QuantidadesBipadas {
  quantidades: Map<string, number>;
  quantidadesTam: Map<string, Record<number, number>>;
}

interface Props {
  companySlug: string;
  romaneioId: string;
  /** Filial que recebe (saída: destino definido; trânsito: destino do romaneio). */
  filialDestino: string;
  username: string;
  itens: RomaneioDetalheItem[];
  confirmados: Map<string, number>;
  /** Saída do dashboard: peça P/M/G é conferida tamanho a tamanho. */
  conferePorTamanho: boolean;
  /** Trânsito do Linx: só libera com tudo integral. */
  exigeIntegral: boolean;
  confirmando: boolean;
  onConfirmar: (dados: QuantidadesBipadas) => Promise<boolean>;
  onSair: () => void;
}

// ---------- helpers ----------

const LEITOR_GAP_MS = 45;
const LEITOR_MIN_CHARS = 4;
const SOM_KEY = "saidas-entradas:som-bipe";
const REFRESH_MS = 20000;
/** Evento gravado há menos que isto e ausente do GET: o GET saiu antes do INSERT, mantém. */
const JANELA_GET_ATRASADO_MS = 60000;
const LOTE_ENVIO = 200;

function novoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Cor vem '06' de uma fonte e '6' de outra. */
function normCor(cor: string | null | undefined): string {
  const c = (cor ?? "").toString().trim();
  const n = Number(c);
  return c !== "" && Number.isInteger(n) ? String(n) : c.toUpperCase();
}

function skuDe(produto: string, cor: string | null | undefined): string {
  return `${(produto || "").trim().toUpperCase()}|${normCor(cor)}`;
}

/** Igual ao /bipar: código numérico casa sem os zeros à esquerda. */
function normCodigo(codigo: string): string {
  const c = (codigo || "").trim();
  return /^\d+$/.test(c) ? c.replace(/^0+(?=\d)/, "") : c.toUpperCase();
}

function chaveTela(item: RomaneioDetalheItem): string {
  return `${item.produto}|${item.corProduto ?? ""}`;
}

function temGrade(item: RomaneioDetalheItem): boolean {
  return Boolean(item.exigeTamanho && item.tamanhos && item.tamanhos.length > 0);
}

function contar(eventos: Evento[]): Map<string, Contagem> {
  const mapa = new Map<string, Contagem>();
  for (const e of eventos) {
    if (e.tipo !== "bipe" || e.delta === 0) continue;
    const sku = skuDe(e.produto, e.cor);
    const c = mapa.get(sku) ?? { total: 0, porTam: {} };
    c.total += e.delta;
    if (e.tamanho) c.porTam[e.tamanho] = (c.porTam[e.tamanho] ?? 0) + e.delta;
    mapa.set(sku, c);
  }
  return mapa;
}

function nomeItem(item: RomaneioDetalheItem): string {
  const cor = item.descCor || item.corProduto || "";
  return `${item.descProduto || item.produto}${cor ? ` — ${cor}` : ""}`;
}

function lerLocal<T>(chave: string, padrao: T): T {
  try {
    const raw = window.localStorage.getItem(chave);
    return raw ? (JSON.parse(raw) as T) : padrao;
  } catch {
    return padrao;
  }
}

function gravarLocal(chave: string, valor: unknown) {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // aba privada / cota cheia: segue só com o servidor
  }
}

// ---------- componente ----------

export default function RomaneioBipagemPanel({
  companySlug,
  romaneioId,
  filialDestino,
  username,
  itens,
  confirmados,
  conferePorTamanho,
  exigeIntegral,
  confirmando,
  onConfirmar,
  onSair,
}: Props) {
  const escopo = `${companySlug}::${romaneioId}::${filialDestino.trim().toUpperCase()}`;
  const chaveFila = `romaneio-bipagem:fila:${escopo}`;
  const chaveOcorrencias = `romaneio-bipagem:oc:${escopo}`;

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [codigos, setCodigos] = useState<Map<string, CodigoBarra[]>>(new Map());
  const [eventos, setEventosState] = useState<Evento[]>([]);
  const eventosRef = useRef<Evento[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [dispensando, setDispensando] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<{ ok: boolean; titulo: string; detalhe: string } | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [modoRetirar, setModoRetirar] = useState(false);
  const [somLigado, setSomLigado] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "faltando" | "completos">("todos");
  const [resumoAberto, setResumoAberto] = useState(false);
  const [ciente, setCiente] = useState(false);
  const [descartarArmado, setDescartarArmado] = useState(false);
  const [syncErro, setSyncErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [consultasNoAr, setConsultasNoAr] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const enviandoRef = useRef(false);
  const timerEnvioRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linhasRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const setEventos = useCallback((fn: (prev: Evento[]) => Evento[]) => {
    eventosRef.current = fn(eventosRef.current);
    setEventosState(eventosRef.current);
  }, []);

  // Itens do romaneio por SKU normalizado; pendentes = ainda não confirmados.
  const itemPorSku = useMemo(() => {
    const m = new Map<string, RomaneioDetalheItem>();
    for (const item of itens) m.set(skuDe(item.produto, item.corProduto), item);
    return m;
  }, [itens]);
  const pendentes = useMemo(() => itens.filter((i) => !confirmados.has(chaveTela(i))), [itens, confirmados]);

  const contagem = useMemo(() => contar(eventos), [eventos]);
  const naoSincronizados = eventos.filter((e) => !e.sincronizado).length;

  const porTamanhoDoItem = useCallback(
    (item: RomaneioDetalheItem) => conferePorTamanho && temGrade(item),
    [conferePorTamanho]
  );

  // ---------- som / foco ----------

  useEffect(() => {
    const salvo = lerLocal<string | null>(SOM_KEY, null);
    if (salvo !== null) setSomLigado(String(salvo) === "1");
  }, []);

  const tocar = useCallback(
    (ok: boolean) => {
      if (!somLigado) return;
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        if (!audioRef.current) audioRef.current = new Ctor();
        const ctx = audioRef.current;
        if (ctx.state === "suspended") void ctx.resume();
        const toques = ok ? 1 : 3;
        const duracao = ok ? 0.08 : 0.16;
        for (let i = 0; i < toques; i++) {
          const inicio = ctx.currentTime + i * 0.22;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = ok ? "square" : "sawtooth";
          osc.frequency.setValueAtTime(ok ? 1200 : 240, inicio);
          gain.gain.setValueAtTime(ok ? 0.05 : 0.07, inicio);
          gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(inicio);
          osc.stop(inicio + duracao);
        }
      } catch {
        // sem áudio: segue sem som
      }
    },
    [somLigado]
  );

  const focar = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // ---------- carga ----------

  const mesclarDoServidor = useCallback(
    (doServidor: Array<Omit<Evento, "sincronizado">>) => {
      const ids = new Set(doServidor.map((e) => e.id));
      const agora = Date.now();
      setEventos((prev) => {
        const locais = prev.filter(
          (e) =>
            !ids.has(e.id) &&
            (!e.sincronizado || agora - (e.sincronizadoEm ?? 0) < JANELA_GET_ATRASADO_MS)
        );
        return [
          ...doServidor.map((e) => ({ ...e, sincronizado: true })),
          ...locais,
        ].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
      });
    },
    [setEventos]
  );

  const buscarEventos = useCallback(async () => {
    const params = new URLSearchParams({ company: companySlug, romaneio: romaneioId, filialDestino });
    const res = await fetch(`/api/romaneios/bipagem?${params.toString()}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { eventos?: Array<Omit<Evento, "sincronizado">>; error?: string };
    if (!res.ok) throw new Error(json.error || "Falha ao ler os bipes salvos.");
    return json.eventos ?? [];
  }, [companySlug, romaneioId, filialDestino]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroCarga(null);
    try {
      const produtos = [...new Set(itens.map((i) => i.produto))];
      const [resCod, doServidor] = await Promise.all([
        fetch("/api/romaneios/bipagem/codigos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ produtos }),
        }).then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { codigos?: Array<CodigoBarra & { codigo: string }>; error?: string };
          if (!r.ok) throw new Error(j.error || "Falha ao carregar os códigos de barra.");
          return j.codigos ?? [];
        }),
        buscarEventos(),
      ]);

      const mapa = new Map<string, CodigoBarra[]>();
      for (const c of resCod) {
        const k = normCodigo(c.codigo);
        if (!k) continue;
        const lista = mapa.get(k) ?? [];
        lista.push({ produto: c.produto, cor: c.cor, tamanho: c.tamanho });
        mapa.set(k, lista);
      }
      setCodigos(mapa);

      // Bipes deste aparelho que não chegaram ao servidor (aba fechou / rede caiu).
      const fila = lerLocal<Evento[]>(chaveFila, []).map((e) => ({ ...e, sincronizado: false }));
      eventosRef.current = fila;
      mesclarDoServidor(doServidor);
      setOcorrencias(lerLocal<Ocorrencia[]>(chaveOcorrencias, []));
    } catch (e) {
      setErroCarga(e instanceof Error ? e.message : "Falha ao preparar a bipagem.");
    } finally {
      setCarregando(false);
      focar();
    }
  }, [itens, buscarEventos, chaveFila, chaveOcorrencias, mesclarDoServidor, focar]);

  useEffect(() => {
    void carregar();
    // Só na entrada do modo: recarregar a cada mudança de `itens` zeraria o mapa no meio da bipagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outro aparelho bipando o mesmo romaneio: soma aparece aqui.
  useEffect(() => {
    if (carregando || erroCarga) return;
    const t = setInterval(() => {
      buscarEventos().then(mesclarDoServidor).catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [carregando, erroCarga, buscarEventos, mesclarDoServidor]);

  // ---------- persistência local + envio ----------

  useEffect(() => {
    if (carregando) return;
    const fila = eventos.filter((e) => !e.sincronizado);
    gravarLocal(chaveFila, fila.length > 0 ? fila : null);
  }, [eventos, carregando, chaveFila]);

  useEffect(() => {
    if (carregando) return;
    gravarLocal(chaveOcorrencias, ocorrencias.length > 0 ? ocorrencias : null);
  }, [ocorrencias, carregando, chaveOcorrencias]);

  // O timer NÃO reinicia a cada bipe: bipando sem parar, o envio sai mesmo assim.
  useEffect(() => () => {
    if (timerEnvioRef.current) clearTimeout(timerEnvioRef.current);
  }, []);

  useEffect(() => {
    if (carregando || naoSincronizados === 0 || enviandoRef.current || timerEnvioRef.current) return;
    const espera = syncErro ? 3000 : 400;
    timerEnvioRef.current = setTimeout(async () => {
      timerEnvioRef.current = null;
      const lote = eventosRef.current.filter((e) => !e.sincronizado).slice(0, LOTE_ENVIO);
      if (lote.length === 0) return;
      enviandoRef.current = true;
      try {
        const res = await fetch("/api/romaneios/bipagem", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            companyKey: companySlug,
            romaneioId,
            filialDestino,
            eventos: lote.map(({ sincronizado: _s, sincronizadoEm: _t, username: _u, ...e }) => e),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error || "o servidor recusou");
        const ids = new Set(lote.map((e) => e.id));
        const agora = Date.now();
        setEventos((prev) => prev.map((e) => (ids.has(e.id) ? { ...e, sincronizado: true, sincronizadoEm: agora } : e)));
        setSyncErro(null);
      } catch (e) {
        setSyncErro(e instanceof Error ? e.message : "sem conexão");
      } finally {
        enviandoRef.current = false;
        setTentativa((n) => n + 1);
      }
    }, espera);
  }, [carregando, naoSincronizados, syncErro, tentativa, username, companySlug, romaneioId, filialDestino, setEventos]);

  // ---------- regras do bipe ----------

  const registrarEvento = useCallback(
    (e: Omit<Evento, "id" | "username" | "criadoEm" | "sincronizado">) => {
      const ev: Evento = { ...e, id: novoId(), username, criadoEm: new Date().toISOString(), sincronizado: false };
      setEventos((prev) => [...prev, ev]);
    },
    [username, setEventos]
  );

  const abrirOcorrencia = useCallback(
    (oc: Omit<Ocorrencia, "id">) => {
      setOcorrencias((prev) => [...prev, { ...oc, id: novoId() }]);
      setUltimo({ ok: false, titulo: oc.titulo, detalhe: oc.detalhe });
      tocar(false);
    },
    [tocar]
  );

  const marcarDestaque = useCallback((sku: string) => {
    setDestaque(sku);
    requestAnimationFrame(() => linhasRef.current.get(sku)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, []);

  /** Soma (ou retira) uma peça do item no tamanho dado, respeitando o teto do romaneio. */
  const aplicar = useCallback(
    (item: RomaneioDetalheItem, tamanho: number | null, codigo: string, retirar: boolean): boolean => {
      const sku = skuDe(item.produto, item.corProduto);
      const atual = contar(eventosRef.current).get(sku) ?? { total: 0, porTam: {} };
      const grade = porTamanhoDoItem(item);
      const tam = grade ? item.tamanhos!.find((t) => t.ordinal === tamanho) ?? null : null;
      const rotulo = `${nomeItem(item)}${tam ? ` · ${tam.label}` : ""}`;

      if (retirar) {
        const tem = grade ? atual.porTam[tamanho ?? 0] ?? 0 : atual.total;
        if (tem <= 0) {
          abrirOcorrencia({ titulo: "Nada para retirar", detalhe: `${rotulo} não tem peça bipada.`, codigo });
          return false;
        }
        registrarEvento({ tipo: "bipe", produto: item.produto, cor: item.corProduto ?? "", tamanho, delta: -1, codigo });
        setUltimo({ ok: true, titulo: "Peça retirada", detalhe: `${rotulo}: ${grade ? tem - 1 : atual.total - 1} bipada(s)` });
        tocar(true);
        marcarDestaque(sku);
        return true;
      }

      // Teto: no tamanho (peça P/M/G) e no total. Bipe a mais = peça sobrando ou bipe duplicado.
      const enviadoTam = grade ? tam?.qtde ?? 0 : null;
      const bipadoTam = grade ? atual.porTam[tamanho ?? 0] ?? 0 : null;
      const estoura =
        atual.total + 1 > item.qtde || (enviadoTam !== null && (bipadoTam ?? 0) + 1 > enviadoTam);
      if (estoura) {
        const detalhe =
          enviadoTam !== null && enviadoTam === 0
            ? `${rotulo}: este tamanho NÃO veio no romaneio.`
            : enviadoTam !== null
              ? `${rotulo}: o romaneio tem ${enviadoTam} neste tamanho e ${bipadoTam} já foram bipadas.`
              : `${rotulo}: o romaneio tem ${item.qtde} e ${atual.total} já foram bipadas.`;
        registrarEvento({ tipo: "excedente", produto: item.produto, cor: item.corProduto ?? "", tamanho, delta: 0, codigo });
        abrirOcorrencia({
          titulo: "Peça a mais — não entra",
          detalhe: `${detalhe} Se bipou duas vezes, ignore. Se a peça está sobrando, separe e avise a logística.`,
          codigo,
        });
        marcarDestaque(sku);
        return false;
      }

      registrarEvento({ tipo: "bipe", produto: item.produto, cor: item.corProduto ?? "", tamanho, delta: 1, codigo });
      const novoTotal = atual.total + 1;
      setUltimo({
        ok: true,
        titulo: novoTotal === item.qtde ? "Item completo ✓" : "Peça conferida",
        detalhe: `${rotulo}: ${novoTotal}/${item.qtde}`,
      });
      tocar(true);
      marcarDestaque(sku);
      return true;
    },
    [porTamanhoDoItem, registrarEvento, abrirOcorrencia, tocar, marcarDestaque]
  );

  /** Código que não é de nenhum item do romaneio: pergunta ao /bipar o que é, só para avisar. */
  const avisarForaDoRomaneio = useCallback(
    async (codigo: string) => {
      setConsultasNoAr((n) => n + 1);
      try {
        const params = new URLSearchParams({ codigoBarras: codigo, filial: filialDestino, company: companySlug });
        const res = await fetch(`/api/transferencia-produtos/bipar?${params.toString()}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          status?: string;
          opcoes?: Array<{ produto: string; descProduto: string; corProduto: string | null; descCor: string }>;
        };
        if (!res.ok) throw new Error();
        const op = json.opcoes?.[0];
        if (json.status === "nao_encontrado" || !op) {
          registrarEvento({ tipo: "nao_encontrado", produto: "", cor: "", tamanho: null, delta: 0, codigo });
          abrirOcorrencia({
            titulo: "Código não encontrado",
            detalhe: `Nenhum produto tem o código ${codigo}. Bipe de novo ou confira a etiqueta.`,
            codigo,
          });
          return;
        }
        registrarEvento({ tipo: "fora_romaneio", produto: op.produto, cor: op.corProduto ?? "", tamanho: null, delta: 0, codigo });
        abrirOcorrencia({
          titulo: "Peça fora deste romaneio — não entra",
          detalhe: `${op.descProduto || op.produto}${op.descCor ? ` — ${op.descCor}` : ""} (${op.produto}) não está no romaneio ${romaneioId}. Separe a peça e avise a logística.`,
          codigo,
        });
      } catch {
        registrarEvento({ tipo: "fora_romaneio", produto: "", cor: "", tamanho: null, delta: 0, codigo });
        abrirOcorrencia({
          titulo: "Peça fora deste romaneio — não entra",
          detalhe: `O código ${codigo} não é de nenhum item do romaneio ${romaneioId}. Separe a peça e avise a logística.`,
          codigo,
        });
      } finally {
        setConsultasNoAr((n) => n - 1);
      }
    },
    [filialDestino, companySlug, romaneioId, registrarEvento, abrirOcorrencia]
  );

  const processarBipe = useCallback(
    (bruto: string) => {
      const codigo = (bruto || "").trim();
      if (!codigo) return;
      const retirar = modoRetirar;
      const hits = codigos.get(normCodigo(codigo)) ?? [];

      // Só o que é deste romaneio (o mesmo código pode existir em produto de fora).
      const doRomaneio = hits.filter((h) => itemPorSku.has(skuDe(h.produto, h.cor)));
      if (doRomaneio.length === 0) {
        void avisarForaDoRomaneio(codigo);
        return;
      }

      const skus = [...new Set(doRomaneio.map((h) => skuDe(h.produto, h.cor)))];
      if (skus.length > 1) {
        abrirOcorrencia({
          titulo: "Código de mais de um item",
          detalhe: `O código ${codigo} é de ${skus.length} itens deste romaneio. Escolha qual peça você tem na mão.`,
          codigo,
          retirar,
          opcoes: doRomaneio.map((h) => {
            const item = itemPorSku.get(skuDe(h.produto, h.cor))!;
            const tam = item.tamanhos?.find((t) => t.ordinal === h.tamanho);
            return { label: `${nomeItem(item)}${tam && porTamanhoDoItem(item) ? ` · ${tam.label}` : ""}`, sku: skuDe(h.produto, h.cor), tamanho: h.tamanho };
          }),
        });
        return;
      }

      const item = itemPorSku.get(skus[0])!;
      if (confirmados.has(chaveTela(item))) {
        registrarEvento({ tipo: "excedente", produto: item.produto, cor: item.corProduto ?? "", tamanho: null, delta: 0, codigo });
        abrirOcorrencia({
          titulo: "Item já confirmado — não entra",
          detalhe: `${nomeItem(item)} já foi confirmado neste romaneio antes. Se a peça está sobrando, separe e avise a logística.`,
          codigo,
        });
        return;
      }

      if (!porTamanhoDoItem(item)) {
        aplicar(item, doRomaneio[0].tamanho, codigo, retirar);
        return;
      }

      // Peça P/M/G: o código diz o tamanho. Código sem tamanho único → escolher.
      const tamanhos = [...new Set(doRomaneio.map((h) => h.tamanho).filter((t): t is number => !!t))];
      if (tamanhos.length === 1) {
        aplicar(item, tamanhos[0], codigo, retirar);
        return;
      }
      abrirOcorrencia({
        titulo: "Escolha o tamanho",
        detalhe: `O código ${codigo} não diz o tamanho de ${nomeItem(item)}. Escolha o da peça na mão.`,
        codigo,
        retirar,
        opcoes: item.tamanhos!
          .filter((t) => t.qtde > 0)
          .map((t) => ({ label: `${nomeItem(item)} · ${t.label}`, sku: skus[0], tamanho: t.ordinal })),
      });
    },
    [modoRetirar, codigos, itemPorSku, confirmados, porTamanhoDoItem, aplicar, avisarForaDoRomaneio, abrirOcorrencia, registrarEvento]
  );

  const processarRef = useRef(processarBipe);
  processarRef.current = processarBipe;

  const escolherOpcao = useCallback(
    (oc: Ocorrencia, op: OpcaoEscolha) => {
      const item = itemPorSku.get(op.sku);
      if (item && aplicar(item, op.tamanho, oc.codigo, !!oc.retirar)) {
        setOcorrencias((prev) => prev.filter((o) => o.id !== oc.id));
      }
      focar();
    },
    [itemPorSku, aplicar, focar]
  );

  const dispensar = useCallback(
    (id: string) => {
      if (dispensando !== id) {
        setDispensando(id);
        return;
      }
      setOcorrencias((prev) => prev.filter((o) => o.id !== id));
      setDispensando(null);
      focar();
    },
    [dispensando, focar]
  );

  // Leitor com o cursor fora do campo (clicou num botão): a rajada vira bipe e o
  // Enter do leitor não aciona o botão focado. Mesmo critério de Saídas/Entradas.
  useEffect(() => {
    if (carregando || erroCarga || resumoAberto) return;
    let buffer = "";
    let ultimaTecla = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo === inputRef.current) {
        buffer = "";
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Shift" || e.key === "CapsLock") return;
      const editavel = !!alvo && (alvo.isContentEditable || alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA");
      if (editavel) return;
      const agora = performance.now();
      if (e.key.length === 1 && e.key !== " ") {
        if (agora - ultimaTecla > LEITOR_GAP_MS) buffer = "";
        buffer += e.key;
        ultimaTecla = agora;
        e.preventDefault();
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && buffer.length >= LEITOR_MIN_CHARS && agora - ultimaTecla <= LEITOR_GAP_MS * 3) {
        e.preventDefault();
        e.stopPropagation();
        const codigo = buffer;
        buffer = "";
        processarRef.current(codigo);
        focar();
        return;
      }
      buffer = "";
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [carregando, erroCarga, resumoAberto, focar]);

  // ---------- resumo / confirmação ----------

  const linhas = useMemo(
    () =>
      pendentes.map((item) => {
        const sku = skuDe(item.produto, item.corProduto);
        const c = contagem.get(sku) ?? { total: 0, porTam: {} };
        const bipado = Math.max(0, Math.min(c.total, item.qtde));
        return { item, sku, contagem: c, bipado, status: bipado === 0 ? "zero" : bipado < item.qtde ? "parcial" : "completo" };
      }),
    [pendentes, contagem]
  );

  const totais = useMemo(() => {
    const pecasRomaneio = linhas.reduce((s, l) => s + l.item.qtde, 0);
    const pecasBipadas = linhas.reduce((s, l) => s + l.bipado, 0);
    return {
      pecasRomaneio,
      pecasBipadas,
      completos: linhas.filter((l) => l.status === "completo"),
      parciais: linhas.filter((l) => l.status === "parcial"),
      zerados: linhas.filter((l) => l.status === "zero"),
    };
  }, [linhas]);

  const pecasFaltando = totais.pecasRomaneio - totais.pecasBipadas;
  const integralOk = !exigeIntegral || pecasFaltando === 0;

  const motivoBloqueio =
    totais.pecasBipadas === 0
      ? "Nenhuma peça bipada ainda."
      : ocorrencias.length > 0
        ? `Resolva ${ocorrencias.length === 1 ? "a ocorrência" : `as ${ocorrencias.length} ocorrências`} em vermelho antes de confirmar.`
        : consultasNoAr > 0
          ? "Aguarde a verificação do último código."
          : naoSincronizados > 0
            ? "Aguarde salvar os bipes."
            : !integralOk
              ? "Romaneio em trânsito do Linx só é liberado com todas as peças bipadas."
              : null;

  const confirmar = useCallback(async () => {
    const quantidades = new Map<string, number>();
    const quantidadesTam = new Map<string, Record<number, number>>();
    for (const l of linhas) {
      const chave = chaveTela(l.item);
      if (porTamanhoDoItem(l.item)) {
        // Por tamanho, nunca acima do enviado nele (o bipe já barra; aqui é a garantia).
        const porTam = Object.fromEntries(
          l.item.tamanhos!.map((t) => [t.ordinal, Math.max(0, Math.min(l.contagem.porTam[t.ordinal] ?? 0, t.qtde))])
        ) as Record<number, number>;
        quantidadesTam.set(chave, porTam);
        quantidades.set(chave, Object.values(porTam).reduce((s, v) => s + v, 0));
      } else {
        quantidades.set(chave, l.bipado);
      }
    }
    const ok = await onConfirmar({ quantidades, quantidadesTam });
    if (!ok) {
      setResumoAberto(false);
      return;
    }
    const encerrar = () =>
      fetch("/api/romaneios/bipagem", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ companyKey: companySlug, romaneioId, filialDestino, acao: "encerrar" }),
      });
    await encerrar().catch(() => encerrar().catch(() => {}));
    gravarLocal(chaveFila, null);
    gravarLocal(chaveOcorrencias, null);
    onSair();
  }, [linhas, porTamanhoDoItem, onConfirmar, username, companySlug, romaneioId, filialDestino, chaveFila, chaveOcorrencias, onSair]);

  const descartar = useCallback(async () => {
    if (!descartarArmado) {
      setDescartarArmado(true);
      return;
    }
    setDescartarArmado(false);
    const res = await fetch("/api/romaneios/bipagem", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-auth-username": username },
      body: JSON.stringify({ companyKey: companySlug, romaneioId, filialDestino, acao: "descartar" }),
    }).catch(() => null);
    if (!res?.ok) {
      setUltimo({ ok: false, titulo: "Não deu para descartar", detalhe: "Sem resposta do servidor. Tente de novo." });
      return;
    }
    eventosRef.current = [];
    setEventosState([]);
    setOcorrencias([]);
    gravarLocal(chaveFila, null);
    gravarLocal(chaveOcorrencias, null);
    setUltimo(null);
    focar();
  }, [descartarArmado, username, companySlug, romaneioId, filialDestino, chaveFila, chaveOcorrencias, focar]);

  const linhasVisiveis = linhas.filter((l) =>
    filtro === "todos" ? true : filtro === "completos" ? l.status === "completo" : l.status !== "completo"
  );

  // ---------- render ----------

  if (carregando) {
    return <div className={styles.painel}><p className={styles.carregando}>Preparando a bipagem…</p></div>;
  }

  if (erroCarga) {
    return (
      <div className={styles.painel}>
        <div className={styles.ocorrencia}>
          <strong>Não deu para abrir a bipagem</strong>
          <span>{erroCarga}</span>
        </div>
        <div className={styles.rodape}>
          <button type="button" className={styles.btnSecundario} onClick={onSair}>Voltar</button>
          <button type="button" className={styles.btnPrimario} onClick={() => void carregar()}>Tentar de novo</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.painel}>
      <div className={styles.topo}>
        <div>
          <h2 className={styles.titulo}>Conferência por bipagem</h2>
          <p className={styles.sub}>
            Bipe cada peça que chegou. No fim, confirme — o que não for bipado fica pendente e a logística
            resolve por ajuste. A confirmação é uma só: depois dela não dá para bipar de novo.
          </p>
        </div>
        <div className={styles.progresso}>
          <span className={styles.progressoNum}>{totais.pecasBipadas}<small>/{totais.pecasRomaneio}</small></span>
          <span className={styles.progressoLabel}>peças · {totais.completos.length}/{linhas.length} itens completos</span>
          <span className={syncErro ? styles.syncErro : styles.syncOk}>
            {naoSincronizados > 0
              ? syncErro
                ? `⚠ ${naoSincronizados} bipe(s) guardados neste aparelho — sem conexão, tentando de novo`
                : `Salvando ${naoSincronizados}…`
              : "✓ Bipes salvos"}
          </span>
        </div>
      </div>

      <div className={styles.barraBipe}>
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          className={`${styles.campoBipe} ${modoRetirar ? styles.campoBipeRetirar : ""}`}
          placeholder={modoRetirar ? "MODO RETIRAR — bipe a peça para tirar da conferência" : "Bipe o código de barras"}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const v = e.currentTarget.value;
              e.currentTarget.value = "";
              processarBipe(v);
            }
          }}
          autoFocus
        />
        <button
          type="button"
          className={`${styles.btnToggle} ${modoRetirar ? styles.btnToggleAtivo : ""}`}
          onClick={() => { setModoRetirar((v) => !v); focar(); }}
          title="O próximo bipe tira a peça em vez de somar"
        >
          {modoRetirar ? "↩ Retirando" : "Retirar peça"}
        </button>
        <button
          type="button"
          className={styles.btnToggle}
          onClick={() => {
            setSomLigado((v) => {
              gravarLocal(SOM_KEY, v ? "0" : "1");
              return !v;
            });
            focar();
          }}
          title={somLigado ? "Silenciar bipe" : "Ligar som do bipe"}
        >
          {somLigado ? "🔊" : "🔇"}
        </button>
      </div>

      {ultimo && (
        <div className={ultimo.ok ? styles.ultimoOk : styles.ultimoErro}>
          <strong>{ultimo.titulo}</strong>
          <span>{ultimo.detalhe}</span>
        </div>
      )}

      {ocorrencias.length > 0 && (
        <div className={styles.ocorrencias}>
          {ocorrencias.map((oc) => (
            <div key={oc.id} className={styles.ocorrencia}>
              <strong>{oc.titulo}</strong>
              <span>{oc.detalhe}</span>
              {oc.opcoes && (
                <div className={styles.opcoes}>
                  {oc.opcoes.map((op, i) => (
                    <button key={i} type="button" className={styles.btnOpcao} onClick={() => escolherOpcao(oc, op)}>
                      {op.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className={dispensando === oc.id ? styles.btnDispensarArmado : styles.btnDispensar}
                onClick={() => dispensar(oc.id)}
              >
                {dispensando === oc.id ? "Clique de novo para dispensar" : oc.opcoes ? "Dispensar" : "Ciente — dispensar"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.filtros}>
        {(["todos", "faltando", "completos"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={filtro === f ? styles.filtroAtivo : styles.filtro}
            onClick={() => { setFiltro(f); focar(); }}
          >
            {f === "todos" ? `Todos (${linhas.length})` : f === "faltando" ? `Faltando (${linhas.length - totais.completos.length})` : `Completos (${totais.completos.length})`}
          </button>
        ))}
      </div>

      <div className={styles.lista}>
        {linhasVisiveis.map((l) => (
          <div
            key={l.sku}
            ref={(el) => { if (el) linhasRef.current.set(l.sku, el); else linhasRef.current.delete(l.sku); }}
            className={`${styles.linha} ${styles[`linha_${l.status}`]} ${destaque === l.sku ? styles.linhaDestaque : ""}`}
          >
            <div className={styles.linhaInfo}>
              <span className={styles.linhaNome}>{l.item.descProduto || l.item.produto}</span>
              <span className={styles.linhaMeta}>
                {l.item.produto} · {l.item.descCor || l.item.corProduto || "—"}
                {l.item.codigoBarra ? ` · ${l.item.codigoBarra}` : ""}
              </span>
              {porTamanhoDoItem(l.item) && (
                <div className={styles.tamanhos}>
                  {l.item.tamanhos!.filter((t) => t.qtde > 0).map((t) => {
                    const b = Math.max(0, l.contagem.porTam[t.ordinal] ?? 0);
                    return (
                      <span key={t.ordinal} className={b >= t.qtde ? styles.tamOk : b > 0 ? styles.tamParcial : styles.tam}>
                        {t.label} {b}/{t.qtde}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <span className={styles.linhaQtd}>
              {l.bipado}<small>/{l.item.qtde}</small>
            </span>
          </div>
        ))}
        {linhasVisiveis.length === 0 && <p className={styles.vazio}>Nenhum item neste filtro.</p>}
      </div>

      <div className={styles.rodape}>
        <button
          type="button"
          className={descartarArmado ? styles.btnPerigoArmado : styles.btnPerigo}
          onClick={() => void descartar()}
          onBlur={() => setDescartarArmado(false)}
          disabled={eventos.length === 0 || confirmando}
        >
          {descartarArmado ? "Clique de novo: apagar todos os bipes" : "Descartar bipagem"}
        </button>
        <button type="button" className={styles.btnSecundario} onClick={onSair} disabled={confirmando}>
          Sair (os bipes ficam salvos)
        </button>
        <button
          type="button"
          className={styles.btnPrimario}
          disabled={!!motivoBloqueio || confirmando}
          title={motivoBloqueio ?? ""}
          onClick={() => { setCiente(false); setResumoAberto(true); }}
        >
          {confirmando ? "Confirmando…" : `Confirmar conferência (${totais.pecasBipadas} peças)`}
        </button>
      </div>
      {motivoBloqueio && totais.pecasBipadas > 0 && <p className={styles.bloqueio}>{motivoBloqueio}</p>}

      {resumoAberto && (
        <div className={styles.overlay} onClick={() => { if (!confirmando) setResumoAberto(false); }}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitulo}>Confirmar o que chegou</h2>
            <p className={styles.modalLinha}>
              ✅ <strong>{totais.completos.length}</strong> item(ns) completos ·{" "}
              <strong>{totais.pecasBipadas}</strong> de {totais.pecasRomaneio} peças bipadas
            </p>

            {pecasFaltando > 0 && (
              <div className={styles.alertaFalta}>
                <strong>⚠ Faltam {pecasFaltando} peça(s) em relação ao romaneio</strong>

                {totais.parciais.length > 0 && (
                  <>
                    <p>
                      <b>Vieram a menos</b> — confirma o que foi bipado e a diferença volta para a loja de origem:
                    </p>
                    <ul>
                      {totais.parciais.map((l) => (
                        <li key={l.sku}>
                          {nomeItem(l.item)} — bipado <b>{l.bipado}</b> de {l.item.qtde} (faltam {l.item.qtde - l.bipado})
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {totais.zerados.length > 0 && (
                  <>
                    <p>
                      <b>Não bipados</b> — NÃO são confirmados: ficam pendentes, o romaneio fica parcialmente
                      confirmado e a logística resolve por ajuste (não dá para confirmar depois):
                    </p>
                    <ul>
                      {totais.zerados.map((l) => (
                        <li key={l.sku}>{nomeItem(l.item)} — {l.item.qtde} peça(s)</li>
                      ))}
                    </ul>
                  </>
                )}

                <label className={styles.ciente}>
                  <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
                  Conferi: faltam {pecasFaltando} peça(s) e quero confirmar só o que chegou.
                </label>
              </div>
            )}

            <div className={styles.modalAcoes}>
              <button type="button" className={styles.btnSecundario} onClick={() => setResumoAberto(false)} disabled={confirmando}>
                Voltar a bipar
              </button>
              <button
                type="button"
                className={styles.btnPrimario}
                disabled={confirmando || (pecasFaltando > 0 && !ciente)}
                onClick={() => void confirmar()}
              >
                {confirmando ? "Confirmando…" : `Confirmar ${totais.completos.length + totais.parciais.length} item(ns)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
