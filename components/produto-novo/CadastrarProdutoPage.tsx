"use client";

/**
 * Cadastrar Produto — o cadastro da tela 002006SPK do Linx (Dados 1, Dados 2,
 * Cores, Complementos, Código de Barras, Tabela de Preços) numa página só,
 * pensada para cadastro rápido:
 *
 *  • escolheu grupo/subgrupo → o resto da ficha se preenche com o valor MAIS
 *    USADO naquele grupo (tipo, coleção, fabricante, categoria, NCM, CEST…), e
 *    cada campo diz de onde veio. Tudo continua editável; o que o usuário mexe
 *    à mão não é sobrescrito quando o grupo muda;
 *  • "usar como modelo" copia a ficha de um produto existente (a capa do
 *    iPhone anterior, por exemplo) — inclusive as cores e o preço;
 *  • preço: só venda (tabela padrão) e custo — as demais tabelas o próprio
 *    Linx deriva, e a tela mostra quais e com que valor;
 *  • fiscal/contábil fica recolhido: é igual em quase todo produto.
 *
 * Nada de código é calculado aqui: código do produto, códigos de barra e
 * tabelas derivadas vêm do servidor (`lib/repositories/produtoNovo.ts`) — o
 * que aparece antes de gravar é PRÉVIA; depois de gravar, releitura do banco.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import type {
  CamposProdutoNovo,
  CampoPadrao,
  ModeloProduto,
  OpcoesProdutoNovo,
  PadraoCampos,
  PreviaProdutoNovo,
  ResultadoProdutoNovo,
} from "@/lib/repositories/produtoNovo";

import styles from "./CadastrarProdutoPage.module.css";

type CompanyKey = "nerd" | "scarfme";

interface Props {
  companyKey: CompanyKey;
}

type Opcoes = OpcoesProdutoNovo & { podeExecutar: boolean; error?: string };

type Origem = "padrao" | "modelo" | "manual";

interface CorSelecionada {
  cor: string;
  descCor: string;
}

const CAMPOS_VAZIOS: CamposProdutoNovo = {
  grupo: "",
  subgrupo: "",
  descProduto: "",
  descProdNf: "",
  tipo: "",
  colecao: "",
  griffe: "",
  linha: "",
  fabricante: "",
  grade: "",
  unidade: "",
  categoria: "",
  subcategoria: "",
  status: "",
  referFabricante: "",
  empresa: null,
  classifFiscal: "",
  idCestNcm: null,
  tributOrigem: "",
  tributIcms: "",
  indicadorCfop: null,
  tipoItemSped: "",
  contaContabil: "",
  periodoPcp: "",
  enviaLojaVarejo: true,
  enviaLojaAtacado: true,
};

/** Campos que recebem padrão, na ordem em que o padrão é aplicado. */
const CAMPOS_COM_PADRAO: CampoPadrao[] = [
  "tipo",
  "colecao",
  "griffe",
  "linha",
  "fabricante",
  "grade",
  "unidade",
  "categoria",
  "subcategoria",
  "status",
  "empresa",
  "classifFiscal",
  "idCestNcm",
  "tributOrigem",
  "tributIcms",
  "indicadorCfop",
  "tipoItemSped",
  "contaContabil",
  "periodoPcp",
  "enviaLojaVarejo",
  "enviaLojaAtacado",
];

const NUMERICOS = new Set<CampoPadrao>(["empresa", "idCestNcm", "indicadorCfop"]);
const BOOLEANOS = new Set<CampoPadrao>(["enviaLojaVarejo", "enviaLojaAtacado"]);

function converterValorPadrao(campo: CampoPadrao, valor: string): CamposProdutoNovo[CampoPadrao] {
  if (BOOLEANOS.has(campo)) return valor === "1";
  if (NUMERICOS.has(campo)) {
    const n = Number(valor);
    return valor !== "" && Number.isFinite(n) ? n : null;
  }
  return valor;
}

function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** Mesma normalização do servidor: caixa alta e espaço simples. */
function nomeLinx(texto: string): string {
  return (texto ?? "").replace(/\s+/g, " ").trimStart().toUpperCase();
}

function parseDinheiro(texto: string): number | null {
  const t = (texto ?? "").replace(/\s|R\$/gi, "");
  if (!t) return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Number(normal);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function dinheiro(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : brl.format(v);
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // DATA_CADASTRAMENTO é meia-noite sem fuso: lê a data em UTC para não voltar um dia.
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function chaveCor(cor: string): string {
  const t = (cor ?? "").trim().toUpperCase();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

/* ══════════════════════════ combobox com busca ══════════════════════════ */

interface OpcaoCombo {
  value: string;
  label: string;
  hint?: string;
}

interface ComboProps {
  value: string;
  options: OpcaoCombo[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Permite deixar vazio (mostra a opção "— nenhum —"). */
  permiteVazio?: boolean;
  ariaLabel: string;
}

/**
 * Select com busca por digitação. Listas como fabricante (388) e coleção (338)
 * não cabem num <select> nativo para cadastro rápido.
 */
function Combo({ value, options, onChange, placeholder, disabled, permiteVazio, ariaLabel }: ComboProps) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const caixaRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const selecionada = options.find((o) => o.value === value) ?? null;

  const filtradas = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    const base = termos.length
      ? options.filter((o) => {
          const alvo = normalizar(`${o.value} ${o.label} ${o.hint ?? ""}`);
          return termos.every((t) => alvo.includes(t));
        })
      : options;
    const lista = base.slice(0, 80);
    return permiteVazio ? [{ value: "", label: "— nenhum —" }, ...lista] : lista;
  }, [busca, options, permiteVazio]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) {
        setAberto(false);
        setBusca("");
      }
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  useEffect(() => {
    const item = listaRef.current?.children[ativo] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  const escolher = (op: OpcaoCombo) => {
    onChange(op.value);
    setAberto(false);
    setBusca("");
  };

  return (
    <div className={styles.combo} ref={caixaRef}>
      <input
        className={styles.input}
        aria-label={ariaLabel}
        disabled={disabled}
        value={aberto ? busca : selecionada ? selecionada.label : value}
        placeholder={aberto && selecionada ? selecionada.label : placeholder}
        onFocus={() => {
          setAberto(true);
          setAtivo(0);
        }}
        onChange={(e) => {
          setBusca(e.target.value);
          setAberto(true);
          setAtivo(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAberto(true);
            setAtivo((a) => Math.min(a + 1, filtradas.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAtivo((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (aberto && filtradas[ativo]) {
              e.preventDefault();
              escolher(filtradas[ativo]);
            }
          } else if (e.key === "Escape") {
            setAberto(false);
            setBusca("");
          } else if (e.key === "Tab" && aberto && busca && filtradas[ativo]) {
            // Tab com busca digitada aceita o destaque — fluxo de teclado do cadastro.
            escolher(filtradas[ativo]);
          }
        }}
      />
      {aberto && !disabled ? (
        <div className={styles.comboLista} ref={listaRef} role="listbox">
          {filtradas.length === 0 ? (
            <div className={styles.comboVazio}>Nada encontrado</div>
          ) : (
            filtradas.map((op, i) => (
              <button
                type="button"
                key={`${op.value}-${i}`}
                className={`${styles.comboItem} ${i === ativo ? styles.comboItemAtivo : ""} ${
                  op.value === value ? styles.comboItemSelecionado : ""
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(op)}
              >
                <span>{op.label}</span>
                {op.hint ? <span className={styles.comboHint}>{op.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ══════════════════════════ página ══════════════════════════ */

export default function CadastrarProdutoPage({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [campos, setCampos] = useState<CamposProdutoNovo>(CAMPOS_VAZIOS);
  const [origens, setOrigens] = useState<Partial<Record<keyof CamposProdutoNovo, Origem>>>({});
  const [nfIgualNome, setNfIgualNome] = useState(true);
  const [cores, setCores] = useState<CorSelecionada[]>([]);
  const [buscaCor, setBuscaCor] = useState("");
  const [venda, setVenda] = useState("");
  const [custo, setCusto] = useState("");
  const [obs, setObs] = useState("");
  const [fiscalAberto, setFiscalAberto] = useState(false);

  const [previa, setPrevia] = useState<PreviaProdutoNovo | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [permitirRepetido, setPermitirRepetido] = useState(false);

  const [codigoModelo, setCodigoModelo] = useState("");
  const [modeloAplicado, setModeloAplicado] = useState<string | null>(null);
  const [carregandoModelo, setCarregandoModelo] = useState(false);

  const [salvando, setSalvando] = useState<"gravar" | "ensaio" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoProdutoNovo | null>(null);

  /* ── carga ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!username) return;
    let cancelado = false;
    setCarregando(true);
    setErroCarga(null);
    (async () => {
      try {
        const res = await fetch(`/api/produto-novo/opcoes?company=${companyKey}`, {
          headers: { "x-auth-username": username },
          cache: "no-store",
        });
        const json = (await res.json()) as Opcoes;
        if (cancelado) return;
        if (!res.ok) {
          setErroCarga(json?.error ?? "Erro ao carregar as opções do cadastro.");
          return;
        }
        setOpcoes(json);
      } catch {
        if (!cancelado) setErroCarga("Falha de conexão ao carregar as opções do cadastro.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [companyKey, username]);

  /* ── padrões ───────────────────────────────────────────────────────── */

  /** Valor padrão de um campo: o mais usado no grupo → na empresa → o fixo do ERP. */
  const padraoDe = useCallback(
    (campo: CampoPadrao, grupo: string) => {
      if (!opcoes) return null;
      const doGrupo: PadraoCampos | undefined = grupo ? opcoes.padroes.porGrupo[grupo] : undefined;
      const v = doGrupo?.[campo];
      if (v && (v.valor !== "" || campo === "categoria" || campo === "subcategoria" || campo === "idCestNcm")) {
        return { ...v, fonte: "grupo" as const };
      }
      const g = opcoes.padroes.geral[campo];
      if (g) return { ...g, fonte: "empresa" as const };
      const f = opcoes.padroes.fixo[campo];
      return f !== undefined ? { valor: f, usos: 0, total: 0, fonte: "fixo" as const } : null;
    },
    [opcoes]
  );

  /** Aplica os padrões do grupo em todo campo que o usuário não mexeu. */
  const aplicarPadroes = useCallback(
    (base: CamposProdutoNovo, origensAtuais: typeof origens, grupo: string) => {
      const novo = { ...base };
      const novasOrigens = { ...origensAtuais };
      for (const campo of CAMPOS_COM_PADRAO) {
        if (origensAtuais[campo] === "manual" || origensAtuais[campo] === "modelo") continue;
        const p = padraoDe(campo, grupo);
        if (!p) continue;
        (novo as Record<string, unknown>)[campo] = converterValorPadrao(campo, p.valor);
        novasOrigens[campo] = "padrao";
      }
      return { campos: novo, origens: novasOrigens };
    },
    [padraoDe]
  );

  // Primeira carga: ficha já nasce com os padrões da empresa.
  const iniciado = useRef(false);
  useEffect(() => {
    if (!opcoes || iniciado.current) return;
    iniciado.current = true;
    const r = aplicarPadroes(CAMPOS_VAZIOS, {}, "");
    setCampos(r.campos);
    setOrigens(r.origens);
  }, [opcoes, aplicarPadroes]);

  // refs para o callback de alteração enxergar o estado mais recente sem
  // recriar a função a cada tecla.
  const camposRef = useRef(campos);
  camposRef.current = campos;
  const origensRef = useRef(origens);
  origensRef.current = origens;
  const nfIgualNomeRef = useRef(nfIgualNome);
  nfIgualNomeRef.current = nfIgualNome;

  const alterar = useCallback(
    <K extends keyof CamposProdutoNovo>(campo: K, valor: CamposProdutoNovo[K]) => {
      setResultado(null);
      let novo: CamposProdutoNovo = { ...camposRef.current, [campo]: valor };
      let novasOrigens = origensRef.current;
      if (campo === "grupo") {
        // Trocar de grupo zera o subgrupo (é escopado) e reaplica os padrões
        // nos campos que ninguém mexeu.
        novo.subgrupo = "";
        const r = aplicarPadroes(novo, novasOrigens, String(valor));
        novo = r.campos;
        novasOrigens = r.origens;
      } else if (campo !== "subgrupo" && campo !== "descProduto" && campo !== "descProdNf") {
        novasOrigens = { ...novasOrigens, [campo]: "manual" };
      }
      if (campo === "categoria") novo.subcategoria = "";
      if (campo === "descProduto" && nfIgualNomeRef.current) novo.descProdNf = String(valor);
      camposRef.current = novo;
      origensRef.current = novasOrigens;
      setCampos(novo);
      setOrigens(novasOrigens);
    },
    [aplicarPadroes]
  );

  // CEST tem que ser um dos do NCM: trocou o NCM, escolhe o CEST que casa.
  const cestsDoNcm = useMemo(
    () => (opcoes?.cests ?? []).filter((c) => c.ncm === campos.classifFiscal),
    [opcoes, campos.classifFiscal]
  );
  useEffect(() => {
    if (!opcoes) return;
    if (campos.idCestNcm !== null && cestsDoNcm.some((c) => c.id === campos.idCestNcm)) return;
    const proximo = cestsDoNcm.length > 0 ? cestsDoNcm[0].id : null;
    if (proximo !== campos.idCestNcm) setCampos((c) => ({ ...c, idCestNcm: proximo }));
  }, [opcoes, cestsDoNcm, campos.idCestNcm]);

  /* ── prévia (código, últimos do subgrupo, nome repetido) ─────────────── */

  useEffect(() => {
    if (!username || !opcoes) return;
    const timer = setTimeout(async () => {
      setCarregandoPrevia(true);
      try {
        const res = await fetch("/api/produto-novo/previa", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            company: companyKey,
            grupo: campos.grupo,
            subgrupo: campos.subgrupo,
            grade: campos.grade,
            descProduto: campos.descProduto,
            empresa: campos.empresa,
          }),
        });
        const json = (await res.json()) as PreviaProdutoNovo & { error?: string };
        if (res.ok) setPrevia(json);
      } catch {
        /* a prévia é conferência: falhar não bloqueia o cadastro */
      } finally {
        setCarregandoPrevia(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [username, opcoes, companyKey, campos.grupo, campos.subgrupo, campos.grade, campos.descProduto, campos.empresa]);

  useEffect(() => setPermitirRepetido(false), [campos.descProduto]);

  /* ── modelo ────────────────────────────────────────────────────────── */

  const aplicarModelo = useCallback(
    (modelo: ModeloProduto) => {
      const novasOrigens: typeof origens = {};
      for (const campo of CAMPOS_COM_PADRAO) novasOrigens[campo] = "modelo";
      setCampos({
        ...modelo.campos,
        // O nome é do produto NOVO: o do modelo vira só ponto de partida editável.
        descProduto: modelo.campos.descProduto,
        descProdNf: modelo.campos.descProduto,
      });
      setNfIgualNome(true);
      setOrigens(novasOrigens);
      setCores(modelo.cores.map((c) => ({ cor: c.cor, descCor: c.descCor })));
      setVenda(modelo.venda ? modelo.venda.toFixed(2).replace(".", ",") : "");
      setCusto(modelo.custo ? modelo.custo.toFixed(2).replace(".", ",") : "");
      setModeloAplicado(`${modelo.produto} ${modelo.descProduto}`);
      setResultado(null);
      setErro(null);
    },
    []
  );

  const carregarModelo = useCallback(
    async (produto: string) => {
      const codigo = produto.trim();
      if (!codigo) return;
      setCarregandoModelo(true);
      setErro(null);
      try {
        const res = await fetch("/api/produto-novo/modelo", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ produto: codigo }),
        });
        const json = (await res.json()) as ModeloProduto & { error?: string };
        if (!res.ok) {
          setErro(json?.error ?? "Erro ao carregar o produto modelo.");
          return;
        }
        aplicarModelo(json);
        setCodigoModelo("");
      } catch {
        setErro("Falha de conexão ao carregar o produto modelo.");
      } finally {
        setCarregandoModelo(false);
      }
    },
    [username, aplicarModelo]
  );

  const limparTudo = useCallback(() => {
    const r = aplicarPadroes(CAMPOS_VAZIOS, {}, "");
    setCampos(r.campos);
    setOrigens(r.origens);
    setNfIgualNome(true);
    setCores([]);
    setVenda("");
    setCusto("");
    setObs("");
    setModeloAplicado(null);
    setResultado(null);
    setErro(null);
  }, [aplicarPadroes]);

  /** Depois de gravar: mantém a ficha (próxima capa do mesmo jeito) e limpa o que muda. */
  const cadastrarOutroParecido = useCallback(() => {
    setCampos((c) => ({ ...c, descProduto: "", descProdNf: "", referFabricante: "" }));
    setNfIgualNome(true);
    setResultado(null);
    setErro(null);
    setObs("");
  }, []);

  /* ── opções dos selects ───────────────────────────────────────────── */

  const op = useMemo(() => {
    if (!opcoes) return null;
    const d = opcoes.dimensoes;
    const simples = (lista: string[]) => lista.map((v) => ({ value: v, label: v }));
    const comUso = (lista: string[], usos: Record<string, number>) =>
      [...lista]
        .sort((a, b) => (usos[b] ?? 0) - (usos[a] ?? 0) || a.localeCompare(b, "pt-BR"))
        .map((v) => ({ value: v, label: v, hint: usos[v] ? `${usos[v]} produtos` : undefined }));
    return {
      grupos: d.grupos.map((g) => ({
        value: g,
        label: g,
        hint: opcoes.codigoGrupo[g] ? `código ${opcoes.codigoGrupo[g]}` : undefined,
      })),
      tipos: comUso(d.tipos, opcoes.usosTipo),
      colecoes: [...d.colecoes]
        .sort(
          (a, b) =>
            (opcoes.usosColecao[b.value] ?? 0) - (opcoes.usosColecao[a.value] ?? 0) ||
            a.label.localeCompare(b.label, "pt-BR")
        )
        .map((c) => ({
          value: c.value,
          label: c.label,
          hint: opcoes.usosColecao[c.value] ? `${opcoes.usosColecao[c.value]} produtos` : undefined,
        })),
      griffes: simples(d.griffes),
      linhas: simples(d.linhas),
      grades: simples(d.grades),
      unidades: simples(d.unidades),
      fabricantes: opcoes.fabricantes.map((f) => ({
        value: f.codigo,
        label: f.nome,
        hint: f.usos ? `${f.usos} produtos` : undefined,
      })),
      categorias: opcoes.categorias.map((c) => ({
        value: c.codigo,
        label: c.nome,
        hint: c.usos ? `${c.usos} produtos` : c.codigo,
      })),
      ncms: opcoes.ncms.map((n) => ({
        value: n.codigo,
        label: `${n.codigo} — ${n.nome}`,
        hint: n.usos ? `${n.usos} produtos` : undefined,
      })),
    };
  }, [opcoes]);

  const subgrupos = useMemo(
    () =>
      (opcoes?.dimensoes.subgruposPorGrupo[campos.grupo] ?? []).map((s) => ({ value: s, label: s })),
    [opcoes, campos.grupo]
  );

  const subcategorias = useMemo(() => {
    const cat = opcoes?.categorias.find((c) => c.codigo === campos.categoria);
    return (cat?.subcategorias ?? []).map((s) => ({
      value: s.codigo,
      label: s.nome,
      hint: s.usos ? `${s.usos} produtos` : s.codigo,
    }));
  }, [opcoes, campos.categoria]);

  /* ── cores ─────────────────────────────────────────────────────────── */

  const coresFiltradas = useMemo(() => {
    const catalogo = opcoes?.cores ?? [];
    const escolhidas = new Set(cores.map((c) => chaveCor(c.cor)));
    const termos = normalizar(buscaCor).split(/\s+/).filter(Boolean);
    const lista = catalogo.filter((c) => {
      if (escolhidas.has(chaveCor(c.cor))) return false;
      if (termos.length === 0) return true;
      const alvo = normalizar(`${c.cor} ${c.descEmpresa ?? ""} ${c.descBasica}`);
      return termos.every((t) => alvo.includes(t));
    });
    // Sem busca, mostra as mais usadas (o catálogo já vem ordenado por uso).
    return lista.slice(0, termos.length ? 60 : 24);
  }, [opcoes, cores, buscaCor]);

  const adicionarCor = (cor: string, descCor: string) => {
    setResultado(null);
    setCores((atual) =>
      atual.some((c) => chaveCor(c.cor) === chaveCor(cor)) ? atual : [...atual, { cor, descCor: descCor.toUpperCase() }]
    );
    setBuscaCor("");
  };

  /* ── preço ─────────────────────────────────────────────────────────── */

  const vendaNum = parseDinheiro(venda);
  const custoNum = parseDinheiro(custo);
  const markup = vendaNum && custoNum ? vendaNum / custoNum : null;

  // Tabelas que o trigger do Linx vai criar. As inativas o próprio Linx esconde
  // na aba de preços: aqui viram só uma contagem.
  const derivadas = useMemo(() => {
    const todas = [
      ...(opcoes?.tabelaVenda?.filhas.map((f) => ({ ...f, base: vendaNum })) ?? []),
      ...(opcoes?.tabelaCusto?.filhas.map((f) => ({ ...f, base: custoNum })) ?? []),
    ];
    return { ativas: todas.filter((f) => !f.inativa), inativas: todas.filter((f) => f.inativa).length };
  }, [opcoes, vendaNum, custoNum]);

  /* ── validação local (o servidor valida de novo) ──────────────────── */

  const pendencias = useMemo(() => {
    const p: string[] = [];
    if (!campos.grupo) p.push("grupo");
    if (!campos.subgrupo) p.push("subgrupo");
    if (!campos.descProduto.trim()) p.push("nome do produto");
    if (!campos.tipo) p.push("tipo");
    if (!campos.colecao) p.push("coleção");
    if (!campos.fabricante) p.push("fabricante");
    if (!campos.griffe) p.push("griffe");
    if (!campos.linha) p.push("linha");
    if (!campos.grade) p.push("grade");
    if (!campos.classifFiscal) p.push("NCM");
    if (campos.categoria && !campos.subcategoria) p.push("subcategoria");
    if (cores.length === 0) p.push("cor");
    if (cores.some((c) => !c.descCor.trim())) p.push("descrição da cor");
    if (!vendaNum) p.push("preço de venda");
    if (!custoNum) p.push("custo");
    return p;
  }, [campos, cores, vendaNum, custoNum]);

  const nomeRepetido = (previa?.nomesIguais.length ?? 0) > 0;
  const tamanhos = previa?.tamanhos ?? [];
  const totalCodigos = cores.length * Math.max(tamanhos.length, 1) * 2;
  const podeExecutar = Boolean(opcoes?.podeExecutar);
  const bloqueado = pendencias.length > 0 || (nomeRepetido && !permitirRepetido) || !podeExecutar;

  /* ── gravar ────────────────────────────────────────────────────────── */

  const enviar = useCallback(
    async (ensaio: boolean) => {
      setSalvando(ensaio ? "ensaio" : "gravar");
      setErro(null);
      setResultado(null);
      try {
        const res = await fetch("/api/produto-novo/criar", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            company: companyKey,
            campos: { ...campos, descProdNf: nfIgualNome ? campos.descProduto : campos.descProdNf },
            cores,
            venda,
            custo,
            permitirNomeRepetido: permitirRepetido,
            ensaio,
            obs: obs.trim() || null,
          }),
        });
        const json = (await res.json()) as ResultadoProdutoNovo & { error?: string };
        if (!res.ok) {
          setErro(json?.error ?? "Erro ao cadastrar o produto.");
          return;
        }
        setResultado(json);
      } catch {
        setErro("Falha de conexão. Antes de tentar de novo, confira no Linx se o produto foi criado.");
      } finally {
        setSalvando(null);
      }
    },
    [username, companyKey, campos, nfIgualNome, cores, venda, custo, permitirRepetido, obs]
  );

  /* ── render ────────────────────────────────────────────────────────── */

  if (carregando) {
    return <div className={styles.carregando}>Carregando o cadastro do Linx…</div>;
  }
  if (erroCarga || !opcoes || !op) {
    return <div className={styles.erro}>{erroCarga ?? "Não foi possível carregar o cadastro."}</div>;
  }

  /** Etiqueta "de onde veio" o valor do campo. */
  const origemTag = (campo: CampoPadrao) => {
    const origem = origens[campo];
    if (origem === "manual") return <span className={styles.tagManual}>alterado</span>;
    if (origem === "modelo") return <span className={styles.tagModelo}>do modelo</span>;
    const p = padraoDe(campo, campos.grupo);
    if (!p) return null;
    if (p.fonte === "fixo") return <span className={styles.tagPadrao}>padrão</span>;
    const pct = p.total > 0 ? Math.round((p.usos / p.total) * 100) : null;
    return (
      <span
        className={styles.tagPadrao}
        title={`${p.usos} de ${p.total} produtos ${p.fonte === "grupo" ? `de ${campos.grupo}` : "da empresa"} nos últimos 24 meses`}
      >
        {p.fonte === "grupo" ? "padrão do grupo" : "padrão da empresa"}
        {pct !== null ? ` · ${pct}%` : ""}
      </span>
    );
  };

  const campo = (
    rotulo: string,
    chave: CampoPadrao | null,
    controle: ReactNode,
    opts: { largo?: boolean } = {}
  ) => (
    <label className={`${styles.campo} ${opts.largo ? styles.campoLargo : ""} ${
      chave && origens[chave] === "manual" ? styles.campoAlterado : ""
    }`}>
      <span className={styles.campoTopo}>
        <span className={styles.campoLabel}>{rotulo}</span>
        {chave ? origemTag(chave) : null}
      </span>
      {controle}
    </label>
  );

  const nomeOpcao = (lista: Array<{ codigo: string; nome: string }>, codigo: string | number | null) => {
    const c = lista.find((x) => x.codigo === String(codigo ?? ""));
    return c ? `${c.codigo} ${c.nome}` : String(codigo ?? "—");
  };
  const cestAtual = cestsDoNcm.find((c) => c.id === campos.idCestNcm) ?? null;

  const somenteLeitura = !podeExecutar;

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Cadastrar Produto</h1>
          <p className={styles.subtitulo}>
            Cria o produto no Linx com cores, códigos de barra (interno + EAN-13) e preço, como a tela
            002006 do ERP. A ficha já vem preenchida com o que mais se repete no grupo — confira e mude o
            que precisar.
          </p>
        </div>
        <div className={styles.modeloBox}>
          <span className={styles.campoLabel}>Copiar de um produto</span>
          <div className={styles.modeloLinha}>
            <input
              className={`${styles.input} ${styles.inputMono}`}
              placeholder="código, ex.: N4.8M.0018"
              value={codigoModelo}
              onChange={(e) => setCodigoModelo(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") void carregarModelo(codigoModelo);
              }}
            />
            <button
              type="button"
              className={styles.btnSecundario}
              onClick={() => void carregarModelo(codigoModelo)}
              disabled={!codigoModelo.trim() || carregandoModelo}
            >
              {carregandoModelo ? "Carregando…" : "Usar como modelo"}
            </button>
          </div>
        </div>
      </header>

      {somenteLeitura ? (
        <div className={styles.avisoTopo}>Seu perfil é somente leitura: dá para montar e conferir, mas não para gravar.</div>
      ) : null}

      {modeloAplicado ? (
        <div className={styles.faixaModelo}>
          Ficha copiada de <strong>{modeloAplicado}</strong> (cores e preço inclusos). Troque o nome e o que
          mais mudar.
          <button type="button" className={styles.btnTexto} onClick={limparTudo}>
            Começar do zero
          </button>
        </div>
      ) : null}

      {/* ── 1. onde fica ─────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            <span className={styles.passo}>1</span> Grupo e subgrupo
          </h2>
          <div className={styles.codigoPrevia}>
            {campos.grupo && campos.subgrupo ? (
              previa?.codigo ? (
                <>
                  Código do produto: <strong className={styles.mono}>{previa.codigo}</strong>
                  <span className={styles.dica}> (prévia — o número final sai na hora de gravar)</span>
                </>
              ) : previa?.erroCodigo ? (
                <span className={styles.textoErro}>{previa.erroCodigo}</span>
              ) : carregandoPrevia ? (
                "Calculando o código…"
              ) : null
            ) : (
              <span className={styles.dica}>O código sai do grupo + subgrupo (ex.: N4.8M.0019).</span>
            )}
          </div>
        </div>
        <div className={styles.grid}>
          {campo(
            "Grupo",
            null,
            <Combo
              ariaLabel="Grupo"
              value={campos.grupo}
              options={op.grupos}
              onChange={(v) => alterar("grupo", v)}
              placeholder="ex.: CAPAS"
            />
          )}
          {campo(
            "Subgrupo",
            null,
            <Combo
              ariaLabel="Subgrupo"
              value={campos.subgrupo}
              options={subgrupos}
              onChange={(v) => alterar("subgrupo", v)}
              placeholder={campos.grupo ? "ex.: IP 18 PRO MAX" : "escolha o grupo primeiro"}
              disabled={!campos.grupo}
            />
          )}
        </div>

        {previa && previa.recentes.length > 0 ? (
          <div className={styles.recentes}>
            <div className={styles.recentesTitulo}>Últimos cadastrados neste subgrupo</div>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nome</th>
                  <th>Cores</th>
                  <th className={styles.num}>Venda</th>
                  <th className={styles.num}>Custo</th>
                  <th>Cadastro</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {previa.recentes.map((r) => (
                  <tr key={r.produto}>
                    <td className={styles.mono}>{r.produto}</td>
                    <td>{r.descProduto}</td>
                    <td className={styles.tdCores}>{r.cores || "—"}</td>
                    <td className={styles.num}>{dinheiro(r.venda)}</td>
                    <td className={styles.num}>{dinheiro(r.custo)}</td>
                    <td>{dataCurta(r.data)}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.btnTexto}
                        onClick={() => void carregarModelo(r.produto)}
                        disabled={carregandoModelo}
                      >
                        usar como modelo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* ── 2. nome ──────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.passo}>2</span> Nome
        </h2>
        <div className={styles.grid}>
          <label className={`${styles.campo} ${styles.campoLargo}`}>
            <span className={styles.campoTopo}>
              <span className={styles.campoLabel}>Nome do produto</span>
              <span className={styles.contador}>{campos.descProduto.length}/40</span>
            </span>
            <input
              className={`${styles.input} ${styles.inputNome}`}
              value={campos.descProduto}
              maxLength={40}
              placeholder="ex.: CP MAGNETIC STURDY IP 18 PRO MAX"
              onChange={(e) => alterar("descProduto", nomeLinx(e.target.value))}
            />
          </label>
          <label className={`${styles.campo} ${styles.campoLargo}`}>
            <span className={styles.campoTopo}>
              <span className={styles.campoLabel}>Descrição fiscal (sai na nota)</span>
              <span className={styles.checkInline}>
                <input
                  type="checkbox"
                  checked={nfIgualNome}
                  onChange={(e) => {
                    setNfIgualNome(e.target.checked);
                    if (e.target.checked) setCampos((c) => ({ ...c, descProdNf: c.descProduto }));
                  }}
                />
                igual ao nome
              </span>
            </span>
            <input
              className={styles.input}
              value={nfIgualNome ? campos.descProduto : campos.descProdNf}
              maxLength={40}
              disabled={nfIgualNome}
              onChange={(e) => alterar("descProdNf", nomeLinx(e.target.value))}
            />
          </label>
        </div>
        {nomeRepetido ? (
          <div className={styles.alerta}>
            Já existe produto com esse nome:{" "}
            {previa!.nomesIguais.map((n) => (
              <span key={n.produto} className={styles.mono}>
                {n.produto} ({n.grupo} / {n.subgrupo}, {dataCurta(n.data)}){" "}
              </span>
            ))}
            <label className={styles.checkInline}>
              <input
                type="checkbox"
                checked={permitirRepetido}
                onChange={(e) => setPermitirRepetido(e.target.checked)}
              />
              é outro produto, cadastrar mesmo assim
            </label>
          </div>
        ) : null}
      </section>

      {/* ── 3. classificação (Dados 1) ───────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.passo}>3</span> Classificação
        </h2>
        <div className={styles.grid}>
          {campo(
            "Categoria",
            "categoria",
            <Combo
              ariaLabel="Categoria"
              value={campos.categoria}
              options={op.categorias}
              onChange={(v) => alterar("categoria", v)}
              permiteVazio
            />
          )}
          {campo(
            "Subcategoria",
            "subcategoria",
            <Combo
              ariaLabel="Subcategoria"
              value={campos.subcategoria}
              options={subcategorias}
              onChange={(v) => alterar("subcategoria", v)}
              disabled={!campos.categoria}
              placeholder={campos.categoria ? "" : "sem categoria"}
            />
          )}
          {campo(
            "Tipo",
            "tipo",
            <Combo ariaLabel="Tipo" value={campos.tipo} options={op.tipos} onChange={(v) => alterar("tipo", v)} />
          )}
          {campo(
            "Coleção / marca",
            "colecao",
            <Combo
              ariaLabel="Coleção"
              value={campos.colecao}
              options={op.colecoes}
              onChange={(v) => alterar("colecao", v)}
            />
          )}
          {campo(
            "Fabricante",
            "fabricante",
            <Combo
              ariaLabel="Fabricante"
              value={campos.fabricante}
              options={op.fabricantes}
              onChange={(v) => alterar("fabricante", v)}
            />
          )}
          {campo(
            "Griffe",
            "griffe",
            <Combo ariaLabel="Griffe" value={campos.griffe} options={op.griffes} onChange={(v) => alterar("griffe", v)} />
          )}
          {campo(
            "Linha",
            "linha",
            <Combo ariaLabel="Linha" value={campos.linha} options={op.linhas} onChange={(v) => alterar("linha", v)} />
          )}
          {campo(
            "Tamanhos (grade)",
            "grade",
            <Combo ariaLabel="Grade" value={campos.grade} options={op.grades} onChange={(v) => alterar("grade", v)} />
          )}
          {campo(
            "Unidade",
            "unidade",
            <Combo
              ariaLabel="Unidade"
              value={campos.unidade}
              options={op.unidades}
              onChange={(v) => alterar("unidade", v)}
            />
          )}
          {campo(
            "Status",
            "status",
            <select
              className={styles.select}
              value={campos.status}
              onChange={(e) => alterar("status", e.target.value)}
            >
              {opcoes.status.map((s) => (
                <option key={s.codigo} value={s.codigo}>
                  {s.nome}
                </option>
              ))}
            </select>
          )}
          {campo(
            "Empresa",
            "empresa",
            <select
              className={styles.select}
              value={campos.empresa ?? ""}
              onChange={(e) => alterar("empresa", e.target.value ? Number(e.target.value) : null)}
            >
              {opcoes.empresas.map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.codigo} {e.nome}
                </option>
              ))}
            </select>
          )}
          <label className={styles.campo}>
            <span className={styles.campoTopo}>
              <span className={styles.campoLabel}>Referência do fabricante</span>
            </span>
            <input
              className={styles.input}
              value={campos.referFabricante}
              maxLength={25}
              placeholder="opcional"
              onChange={(e) => alterar("referFabricante", nomeLinx(e.target.value))}
            />
          </label>
        </div>
      </section>

      {/* ── 4. cores ─────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            <span className={styles.passo}>4</span> Cores
          </h2>
          <span className={styles.dica}>
            {cores.length} cor{cores.length === 1 ? "" : "es"} × {Math.max(tamanhos.length, 1)} tamanho
            {tamanhos.length > 1 ? "s" : ""} ({tamanhos.map((t) => t.grade).join(", ") || "U"}) ={" "}
            <strong>{totalCodigos} códigos de barra</strong>
            {previa?.proximoInterno ? (
              <>
                {" "}
                · próximos: <span className={styles.mono}>{previa.proximoInterno}</span> /{" "}
                <span className={styles.mono}>{previa.proximoEan}</span>
              </>
            ) : null}
          </span>
        </div>

        {cores.length > 0 ? (
          <div className={styles.coresEscolhidas}>
            {cores.map((c, i) => (
              <div key={c.cor} className={styles.corChip}>
                <span className={styles.corCodigo}>{c.cor}</span>
                <input
                  className={styles.corDesc}
                  value={c.descCor}
                  maxLength={40}
                  aria-label={`Descrição da cor ${c.cor}`}
                  onChange={(e) => {
                    const desc = nomeLinx(e.target.value);
                    setCores((atual) => atual.map((x, j) => (j === i ? { ...x, descCor: desc } : x)));
                  }}
                />
                <button
                  type="button"
                  className={styles.corRemover}
                  aria-label={`Tirar a cor ${c.cor}`}
                  onClick={() => setCores((atual) => atual.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.dica}>Nenhuma cor ainda — procure abaixo e clique para adicionar.</p>
        )}

        <input
          className={styles.input}
          value={buscaCor}
          placeholder={`Procure pelo número ou nome (${opcoes.cores.length} cores cadastradas) — Enter adiciona a primeira`}
          onChange={(e) => setBuscaCor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && coresFiltradas[0]) {
              e.preventDefault();
              const c = coresFiltradas[0];
              adicionarCor(c.cor, c.descEmpresa || c.descBasica);
            }
          }}
        />
        <div className={styles.catalogoCores}>
          {coresFiltradas.map((c) => {
            const nome = c.descEmpresa || c.descBasica;
            const divergente = !!c.descEmpresa && normalizar(c.descEmpresa) !== normalizar(c.descBasica);
            return (
              <button
                type="button"
                key={c.cor}
                className={styles.corOpcao}
                onClick={() => adicionarCor(c.cor, nome)}
                title={divergente ? `No cadastro global de cores é "${c.descBasica}"` : undefined}
              >
                <span className={styles.corCodigo}>{c.cor}</span>
                <span>{nome}</span>
                <span className={styles.corUsos}>{c.usosEmpresa > 0 ? c.usosEmpresa : "nova"}</span>
              </button>
            );
          })}
          {coresFiltradas.length === 0 ? (
            <span className={styles.dica}>
              Nenhuma cor casa com “{buscaCor}”. Cor nova de verdade nasce primeiro no cadastro de cores do Linx.
            </span>
          ) : null}
        </div>
      </section>

      {/* ── 5. preço ─────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.passo}>5</span> Preço
        </h2>
        <div className={styles.gridPreco}>
          <label className={styles.campo}>
            <span className={styles.campoLabel}>
              Preço de venda{opcoes.tabelaVenda ? ` (tabela ${opcoes.tabelaVenda.codigo} ${opcoes.tabelaVenda.nome})` : ""}
            </span>
            <input
              className={`${styles.input} ${styles.inputPreco}`}
              inputMode="decimal"
              placeholder="0,00"
              value={venda}
              onChange={(e) => {
                setVenda(e.target.value);
                setResultado(null);
              }}
            />
          </label>
          <label className={styles.campo}>
            <span className={styles.campoLabel}>
              Custo{opcoes.tabelaCusto ? ` (tabela ${opcoes.tabelaCusto.codigo} ${opcoes.tabelaCusto.nome})` : ""}
            </span>
            <input
              className={`${styles.input} ${styles.inputPreco}`}
              inputMode="decimal"
              placeholder="0,00"
              value={custo}
              onChange={(e) => {
                setCusto(e.target.value);
                setResultado(null);
              }}
            />
          </label>
          <div className={styles.markup}>
            <span className={styles.campoLabel}>Markup</span>
            <strong className={markup !== null && markup < 1 ? styles.textoErro : undefined}>
              {markup !== null ? `${markup.toFixed(2).replace(".", ",")}×` : "—"}
            </strong>
            {markup !== null && markup < 1 ? <span className={styles.textoErro}>venda abaixo do custo</span> : null}
          </div>
        </div>

        <div className={styles.derivadas}>
          <span className={styles.dica}>O Linx cria sozinho as tabelas derivadas:</span>
          {derivadas.ativas.map((f) => (
            <span
              key={f.codigo}
              className={`${styles.derivada} ${f.inativa ? styles.derivadaInativa : ""}`}
              title={`${f.pct}% da base${f.inativa ? " · tabela inativa" : ""}`}
            >
              <span className={styles.mono}>{f.codigo}</span> {f.nome}:{" "}
              <strong>{f.base ? dinheiro(Math.round(f.base * f.pct) / 100) : `${f.pct}%`}</strong>
            </span>
          ))}
          {derivadas.inativas > 0 ? (
            <span className={styles.dica}>
              + {derivadas.inativas} tabela{derivadas.inativas === 1 ? "" : "s"} inativa
              {derivadas.inativas === 1 ? "" : "s"} (o Linx também preenche, mas não usa)
            </span>
          ) : null}
        </div>
      </section>

      {/* ── 6. fiscal e contábil (Complementos) ──────────────────────── */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.cardToggle}
          onClick={() => setFiscalAberto((v) => !v)}
          aria-expanded={fiscalAberto}
        >
          <h2 className={styles.cardTitle}>
            <span className={styles.passo}>6</span> Fiscal e contábil
          </h2>
          <span className={styles.resumoFiscal}>
            NCM <strong>{campos.classifFiscal || "—"}</strong> · CEST <strong>{cestAtual?.cest ?? "—"}</strong> ·
            Origem <strong>{campos.tributOrigem || "—"}</strong> · ICMS <strong>{campos.tributIcms || "—"}</strong> ·
            SPED <strong>{campos.tipoItemSped || "—"}</strong> · Conta <strong>{campos.contaContabil || "—"}</strong>
            {" · "}
            {campos.enviaLojaVarejo ? "envia p/ varejo" : "não envia p/ varejo"}
          </span>
          <span className={styles.chevron}>{fiscalAberto ? "▲" : "▼ editar"}</span>
        </button>

        {fiscalAberto ? (
          <div className={styles.grid}>
            {campo(
              "Classificação fiscal (NCM)",
              "classifFiscal",
              <Combo
                ariaLabel="NCM"
                value={campos.classifFiscal}
                options={op.ncms}
                onChange={(v) => alterar("classifFiscal", v)}
              />,
              { largo: true }
            )}
            {campo(
              "CEST",
              "idCestNcm",
              <select
                className={styles.select}
                value={campos.idCestNcm ?? ""}
                onChange={(e) => alterar("idCestNcm", e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— sem CEST —</option>
                {cestsDoNcm.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.cest} — {c.descricao}
                  </option>
                ))}
              </select>,
              { largo: true }
            )}
            {campo(
              "Origem",
              "tributOrigem",
              <select
                className={styles.select}
                value={campos.tributOrigem}
                onChange={(e) => alterar("tributOrigem", e.target.value)}
              >
                {opcoes.origens.map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.codigo} — {o.nome}
                  </option>
                ))}
              </select>,
              { largo: true }
            )}
            {campo(
              "Tributação ICMS",
              "tributIcms",
              <select
                className={styles.select}
                value={campos.tributIcms}
                onChange={(e) => alterar("tributIcms", e.target.value)}
              >
                {opcoes.icms.map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.codigo} — {o.nome}
                  </option>
                ))}
              </select>
            )}
            {campo(
              "Caract. contábil",
              "indicadorCfop",
              <select
                className={styles.select}
                value={campos.indicadorCfop ?? ""}
                onChange={(e) => alterar("indicadorCfop", e.target.value ? Number(e.target.value) : null)}
              >
                {opcoes.indicadoresCfop.map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.codigo} — {o.nome}
                  </option>
                ))}
              </select>
            )}
            {campo(
              "Item SPED",
              "tipoItemSped",
              <select
                className={styles.select}
                value={campos.tipoItemSped}
                onChange={(e) => alterar("tipoItemSped", e.target.value)}
              >
                {opcoes.itensSped.map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.codigo} — {o.nome}
                  </option>
                ))}
              </select>
            )}
            {campo(
              "Conta contábil (estoque, compra, venda e devoluções)",
              "contaContabil",
              <select
                className={styles.select}
                value={campos.contaContabil}
                onChange={(e) => alterar("contaContabil", e.target.value)}
              >
                {opcoes.contas.map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.codigo} — {o.nome}
                  </option>
                ))}
              </select>,
              { largo: true }
            )}
            <div className={`${styles.campo} ${styles.campoLargo}`}>
              <span className={styles.campoLabel}>Controle de atualizações</span>
              <div className={styles.toggles}>
                <label className={styles.checkInline}>
                  <input
                    type="checkbox"
                    checked={campos.enviaLojaVarejo}
                    onChange={(e) => alterar("enviaLojaVarejo", e.target.checked)}
                  />
                  Envia loja varejo
                </label>
                <label className={styles.checkInline}>
                  <input
                    type="checkbox"
                    checked={campos.enviaLojaAtacado}
                    onChange={(e) => alterar("enviaLojaAtacado", e.target.checked)}
                  />
                  Envia loja atacado
                </label>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── gravar ───────────────────────────────────────────────────── */}
      {erro ? <div className={styles.erro}>{erro}</div> : null}

      {resultado ? (
        <section className={`${styles.card} ${resultado.ensaio ? styles.cardEnsaio : styles.cardOk}`}>
          <h2 className={styles.cardTitle}>
            {resultado.ensaio ? "Teste ok — nada foi gravado" : "Produto cadastrado no Linx"}
          </h2>
          <div className={styles.resultadoTopo}>
            <span className={`${styles.mono} ${styles.resultadoCodigo}`}>{resultado.produto}</span>
            <span>{resultado.descProduto}</span>
            {resultado.lote ? <span className={styles.dica}>lote {resultado.lote} no histórico de Alterar Cadastro</span> : null}
          </div>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Cor</th>
                <th>Tamanho</th>
                <th>Código interno</th>
                <th>EAN-13</th>
              </tr>
            </thead>
            <tbody>
              {resultado.codigos.map((c) => (
                <tr key={`${c.cor}-${c.tamanho}`}>
                  <td>
                    <span className={styles.mono}>{c.cor}</span> {c.descCor}
                  </td>
                  <td>{c.grade || c.tamanho}</td>
                  <td className={styles.mono}>{c.interno || "—"}</td>
                  <td className={styles.mono}>{c.ean || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.derivadas}>
            <span className={styles.dica}>Tabelas de preço:</span>
            {resultado.precos.map((p) => (
              <span key={p.tabela} className={styles.derivada}>
                <span className={styles.mono}>{p.tabela}</span> <strong>{dinheiro(p.preco)}</strong>
              </span>
            ))}
          </div>
          {resultado.avisos.length > 0 ? <div className={styles.avisoTopo}>{resultado.avisos.join(" ")}</div> : null}
          {!resultado.ensaio ? (
            <div className={styles.acoes}>
              <a className={styles.btnSecundario} href={`/${companyKey}/imprimir-etiquetas`}>
                Imprimir etiquetas
              </a>
              <div className={styles.acoesDireita}>
                <button type="button" className={styles.btnSecundario} onClick={limparTudo}>
                  Novo do zero
                </button>
                <button type="button" className={styles.btnPrimario} onClick={cadastrarOutroParecido}>
                  Cadastrar outro parecido
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {!resultado || resultado.ensaio ? (
        <div className={styles.barraGravar}>
          <label className={styles.campoObs}>
            <span className={styles.campoLabel}>Observação (vai para o histórico)</span>
            <input
              className={styles.input}
              value={obs}
              placeholder="ex.: pedido 1234 do fornecedor"
              onChange={(e) => setObs(e.target.value)}
            />
          </label>
          <div className={styles.barraDireita}>
            {pendencias.length > 0 ? (
              <span className={styles.pendencias}>Falta: {pendencias.join(", ")}</span>
            ) : nomeRepetido && !permitirRepetido ? (
              <span className={styles.pendencias}>Confirme o nome repetido no passo 2</span>
            ) : null}
            <button
              type="button"
              className={styles.btnSecundario}
              disabled={bloqueado || salvando !== null}
              onClick={() => void enviar(true)}
              title="Roda o cadastro inteiro no Linx e desfaz no fim — confere tudo sem gravar"
            >
              {salvando === "ensaio" ? "Testando…" : "Testar sem gravar"}
            </button>
            <button
              type="button"
              className={styles.btnPrimario}
              disabled={bloqueado || salvando !== null}
              onClick={() => void enviar(false)}
            >
              {salvando === "gravar"
                ? "Cadastrando…"
                : `Cadastrar produto${cores.length ? ` (${cores.length} cor${cores.length === 1 ? "" : "es"})` : ""}`}
            </button>
          </div>
        </div>
      ) : null}

      <p className={styles.rodape}>
        Grava, numa transação só: a ficha em PRODUTOS, o sequencial do subgrupo, as cores, os códigos de barra e
        as tabelas {opcoes.tabelaVenda?.codigo ?? "padrão"} e {opcoes.tabelaCusto?.codigo ?? "de custo"} — se
        qualquer passo falhar, nada fica gravado. Status atual: {nomeOpcao(opcoes.status, campos.status)}.
      </p>
    </div>
  );
}
