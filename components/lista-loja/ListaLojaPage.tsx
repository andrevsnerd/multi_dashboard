"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { type CompanyKey } from "@/lib/config/company";

import styles from "./ListaLojaPage.module.css";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Filial {
  codFilial: string;
  filial: string;
}

interface Produto {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  estoques: Array<{ filial: string; nomeFilial: string; estoque: number }>;
}

interface ListaItem {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  quantidade: number;
  /** Vendas em ~90 dias (proporcional ao volume dos últimos 12 meses), snapshot ao adicionar */
  vendas90d?: number | null;
  /** Estoque na filial da lista, snapshot ao adicionar */
  estoqueFilial?: number | null;
}

interface ListaLoja {
  id: string;
  nome: string;
  username: string;
  filial: string;
  nome_filial: string;
  company: string;
  itens: ListaItem[];
  created_at: string;
  updated_at: string;
}

interface TransferenciaPermissao {
  username: string;
  filiaisOrigem: string[];
  filialAtribuida?: string | null;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function fetchPermissoes(username: string): Promise<TransferenciaPermissao | null> {
  try {
    const res = await fetch("/api/transferencia-produtos/permissoes", {
      headers: { "x-auth-username": username },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: TransferenciaPermissao | null };
    return json.data || null;
  } catch {
    return null;
  }
}

async function fetchFiliais(): Promise<Filial[]> {
  try {
    const res = await fetch("/api/transferencia-produtos/filiais", { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: Filial[] };
    return json.data || [];
  } catch {
    return [];
  }
}

async function buscarPorCodigoBarras(codigoBarras: string, companyKey?: string) {
  const params = new URLSearchParams({ codigoBarras: codigoBarras.trim() });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(
    `/api/transferencia-produtos/produto-por-codigo-barras?${params}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data: { produto: string; corProduto: string | null } | null };
  return json.data || null;
}

async function searchProdutos(term: string, companyKey?: string): Promise<Produto[]> {
  if (!term || term.trim().length < 2) return [];
  const params = new URLSearchParams({ q: term.trim(), entrada: "true" });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(`/api/transferencia-produtos/produtos?${params}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: Produto[] };
  return json.data || [];
}

async function fetchListas(company: string, username: string): Promise<ListaLoja[]> {
  const params = new URLSearchParams({ company });
  const res = await fetch(`/api/lista-loja?${params}`, {
    headers: { "x-auth-username": username },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: ListaLoja[] };
  return json.data || [];
}

async function salvarLista(
  data: {
    id?: string;
    nome: string;
    filial: string;
    nomeFilial: string;
    company: string;
    itens: ListaItem[];
  },
  username: string
): Promise<{ id: string }> {
  const isNew = !data.id;
  const url = isNew ? "/api/lista-loja" : `/api/lista-loja/${data.id}`;
  const res = await fetch(url, {
    method: isNew ? "POST" : "PUT",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error || "Erro ao salvar lista");
  }
  const json = (await res.json()) as { data: { id: string } };
  return json.data;
}

async function deletarLista(id: string, username: string): Promise<void> {
  await fetch(`/api/lista-loja/${id}`, {
    method: "DELETE",
    headers: { "x-auth-username": username },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function buildDefaultListName(filialNome?: string): string {
  const base = (filialNome || "Lista").trim();
  const now = new Date();
  const d = now.toLocaleDateString("pt-BR");
  const t = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${base} ${d} ${t}`;
}

/** Estoque na filial (ou grupo lógico de filiais), alinhado ao Controle de Estoque — não usar só o snapshot da busca de produtos. */
async function fetchEstoqueFilialSum(
  companyKey: string,
  codFilial: string,
  produto: string,
  corProduto: string | null
): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      company: companyKey,
      filial: codFilial.trim(),
      produto: produto.trim(),
    });
    if (corProduto) params.set("corProduto", corProduto.trim());
    const res = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ estoque: number }> };
    const rows = json.data || [];
    const sum = rows.reduce((s, r) => s + Number(r.estoque ?? 0), 0);
    return Math.round(sum);
  } catch {
    return null;
  }
}

async function fetchVendas90Projetado(
  companyKey: string,
  codFilial: string,
  produto: string,
  corProduto: string | null
): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      company: companyKey,
      filial: codFilial.trim(),
      produto: produto.trim(),
    });
    if (corProduto) params.set("corProduto", corProduto.trim());
    const res = await fetch(`/api/controle-estoque/vendas-por-filial-item?${params}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ qtde12m: number }> };
    const rows = json.data || [];
    const qtde12m = rows.reduce((s, r) => s + Number(r.qtde12m ?? 0), 0);
    return Math.round((qtde12m / 365) * 90);
  } catch {
    return null;
  }
}

function sameCart(a: ListaItem[], b: ListaItem[]): boolean {
  if (a.length !== b.length) return false;
  const key = (i: ListaItem) => `${i.produto}|${i.corProduto ?? ""}`;
  const mapA = new Map<string, number>();
  for (const i of a) mapA.set(key(i), i.quantidade);
  for (const i of b) {
    const k = key(i);
    if (!mapA.has(k) || mapA.get(k) !== i.quantidade) return false;
  }
  return true;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ListaLojaPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

type Mode = "list" | "editor";

type ListaLojaItensTableProps = {
  itens: ListaItem[];
  onIncrement: (index: number) => void;
  onDecrement: (index: number) => void;
  onQtyChange: (index: number, qtd: number) => void;
  onRemove: (index: number) => void;
};

function ListaLojaItensTable({
  itens,
  onIncrement,
  onDecrement,
  onQtyChange,
  onRemove,
}: ListaLojaItensTableProps) {
  if (itens.length === 0) return null;
  return (
    <div className={styles.produtosTableWrap}>
      <table className={styles.produtosTable}>
        <thead>
          <tr>
            <th className={styles.colProduto}>Produto</th>
            <th className={styles.colNumeric}>Vendas 90 dias</th>
            <th className={styles.colNumeric}>Estoque</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, idx) => (
            <tr key={`${item.produto}-${item.corProduto ?? "null"}-${idx}`}>
              <td>
                <div className={styles.productTitleRow}>
                  <span className={styles.productTitleName} title={item.descProduto}>
                    {item.descProduto}
                  </span>
                </div>
                <div className={styles.productMeta}>{item.produto}</div>
                <div className={styles.productMeta}>{(item.descCor || "").trim() || "—"}</div>
                {item.codigoBarra ? (
                  <div className={styles.productMeta}>Cód. barras: {item.codigoBarra}</div>
                ) : null}
                <div className={styles.productRowActions}>
                  <div className={styles.qtyControl}>
                    <button
                      type="button"
                      className={styles.qtyBtn}
                      onClick={() => onDecrement(idx)}
                      disabled={item.quantidade <= 1}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      className={styles.qtyInput}
                      value={item.quantidade}
                      onChange={(e) => onQtyChange(idx, parseInt(e.target.value, 10) || 1)}
                      min={1}
                    />
                    <button type="button" className={styles.qtyBtn} onClick={() => onIncrement(idx)}>
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => onRemove(idx)}
                    title="Remover"
                  >🗑</button>
                </div>
              </td>
              <td className={styles.colNumeric}>
                <span className={styles.cellMetric}>
                  {item.vendas90d != null ? item.vendas90d : "—"}
                </span>
              </td>
              <td className={styles.colNumeric}>
                <span className={styles.cellMetric}>
                  {item.estoqueFilial != null ? item.estoqueFilial : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ListaLojaPage({ companyKey, companyName }: ListaLojaPageProps) {
  const { user, isLoading: authLoading } = useAuth();

  const [mode, setMode] = useState<Mode>("list");

  // Lists view
  const [listas, setListas] = useState<ListaLoja[]>([]);
  const [loadingListas, setLoadingListas] = useState(false);

  // Editor state
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [nomeLista, setNomeLista] = useState("");
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [filiaisDisponiveis, setFiliaisDisponiveis] = useState<Filial[]>([]);
  const [filialSelecionada, setFilialSelecionada] = useState<Filial | null>(null);
  const [itens, setItens] = useState<ListaItem[]>([]);
  const itensRef = useRef<ListaItem[]>(itens);
  itensRef.current = itens;

  // Modal adicionar produto
  const [modalAberto, setModalAberto] = useState(false);
  const [modalConfirmarFechar, setModalConfirmarFechar] = useState(false);
  const [itensModal, setItensModal] = useState<ListaItem[]>([]);

  // Search (dentro do modal)
  const [searchTerm, setSearchTerm] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);

  // Color picker (dentro do modal)
  const [colorPickerProduto, setColorPickerProduto] = useState<Produto | null>(null);
  const [colorPickerOpcoes, setColorPickerOpcoes] = useState<Produto[]>([]);
  const [loadingColorPicker, setLoadingColorPicker] = useState(false);

  // UI
  const [salvando, setSalvando] = useState(false);
  const [notificacao, setNotificacao] = useState<{ mensagem: string; tipo: "success" | "error" } | null>(null);
  const [permissoes, setPermissoes] = useState<TransferenciaPermissao | null>(null);
  const [permissoesCarregadas, setPermissoesCarregadas] = useState(false);

  const notifTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Notification ───────────────────────────────────────────────────────────

  const mostrarNotificacao = useCallback(
    (mensagem: string, tipo: "success" | "error" = "success") => {
      if (notifTimeoutRef.current) clearTimeout(notifTimeoutRef.current);
      setNotificacao({ mensagem, tipo });
      notifTimeoutRef.current = setTimeout(() => setNotificacao(null), 3000);
    },
    []
  );

  // ─── Load permissions ───────────────────────────────────────────────────────

  useEffect(() => {
    if (authLoading) return;
    if (!user?.username) { setPermissoesCarregadas(true); return; }
    fetchPermissoes(user.username)
      .then((p) => { setPermissoes(p); setPermissoesCarregadas(true); })
      .catch(() => setPermissoesCarregadas(true));
  }, [user?.username, authLoading]);

  // ─── Load filiais ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!permissoesCarregadas) return;
    fetchFiliais().then((data) => {
      setFiliais(data);
      let disponiveis = data;
      if (permissoes) {
        const resolveFiliais = (lista: string[]) => {
          if (lista.length > 0) {
            return data.filter((f) =>
              lista.some((cod) => f.codFilial.trim() === (cod || "").trim())
            );
          }
          if (permissoes.filialAtribuida) {
            return data.filter(
              (f) => f.codFilial.trim() === permissoes.filialAtribuida!.trim()
            );
          }
          return data;
        };
        disponiveis = resolveFiliais(permissoes.filiaisOrigem || []);
      }
      setFiliaisDisponiveis(disponiveis);
      if (disponiveis.length > 0) setFilialSelecionada(disponiveis[0]);
    });
  }, [permissoes, permissoesCarregadas]);

  // Ao mudar a loja ou abrir outra lista para edição, recalcula vendas 90d e estoque (mesma lógica do Controle de Estoque: grupos de filial, etc.)
  useEffect(() => {
    if (mode !== "editor") return;
    const cod = filialSelecionada?.codFilial?.trim();
    if (!cod || itensRef.current.length === 0) return;

    const itemKey = (i: ListaItem) => `${i.produto}|${i.corProduto ?? ""}`;

    let cancelled = false;
    void (async () => {
      const snapshot = itensRef.current;
      const keys = snapshot.map(itemKey);
      const metrics = await Promise.all(
        snapshot.map(async (item) => {
          const [vendas90d, estoqueFilial] = await Promise.all([
            fetchVendas90Projetado(companyKey, cod, item.produto, item.corProduto),
            fetchEstoqueFilialSum(companyKey, cod, item.produto, item.corProduto),
          ]);
          return { vendas90d, estoqueFilial };
        })
      );
      if (cancelled) return;
      const metricsByKey = new Map(keys.map((k, i) => [k, metrics[i]!]));
      setItens((current) =>
        current.map((it) => {
          const m = metricsByKey.get(itemKey(it));
          return m ? { ...it, vendas90d: m.vendas90d, estoqueFilial: m.estoqueFilial } : it;
        })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [filialSelecionada?.codFilial, mode, companyKey, editingId]);

  // ─── Load lists ─────────────────────────────────────────────────────────────

  const carregarListas = useCallback(async () => {
    if (!user?.username) return;
    setLoadingListas(true);
    try {
      const data = await fetchListas(companyKey, user.username);
      setListas(data);
    } catch {
      // silent
    } finally {
      setLoadingListas(false);
    }
  }, [companyKey, user?.username]);

  useEffect(() => {
    if (mode === "list" && permissoesCarregadas && user?.username) carregarListas();
  }, [mode, permissoesCarregadas, user?.username, carregarListas]);

  // ─── Product search with debounce (modal) ───────────────────────────────────

  useEffect(() => {
    if (!modalAberto) return;
    if (!searchTerm || searchTerm.trim().length < 2) {
      setProdutos([]);
      return;
    }
    let active = true;
    setLoadingProdutos(true);
    const timeoutId = setTimeout(async () => {
      try {
        const term = searchTerm.trim();
        let results: Produto[] = [];

        if (term.length >= 3) {
          const porBarra = await buscarPorCodigoBarras(term, companyKey);
          if (porBarra) {
            results = await searchProdutos(porBarra.produto, companyKey);
          }
        }

        if (results.length === 0) {
          results = await searchProdutos(term, companyKey);
        }

        if (active) setProdutos(results);
      } catch {
        if (active) setProdutos([]);
      } finally {
        if (active) setLoadingProdutos(false);
      }
    }, 300);

    return () => { active = false; clearTimeout(timeoutId); };
  }, [searchTerm, companyKey, modalAberto]);

  // reset color picker quando search muda
  useEffect(() => {
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [searchTerm]);

  // ─── Color picker options ───────────────────────────────────────────────────

  useEffect(() => {
    if (!colorPickerProduto) { setColorPickerOpcoes([]); return; }
    const coresNoResultado = produtos.filter(
      (p) => p.produto.trim() === colorPickerProduto.produto.trim() && p.corProduto !== null
    );
    if (coresNoResultado.length > 0) {
      setColorPickerOpcoes(coresNoResultado);
      return;
    }
    let cancelled = false;
    setLoadingColorPicker(true);
    searchProdutos(colorPickerProduto.produto, companyKey)
      .then((result) => {
        if (!cancelled)
          setColorPickerOpcoes(
            result.filter((p) => p.produto.trim() === colorPickerProduto.produto.trim() && p.corProduto !== null)
          );
      })
      .catch(() => { if (!cancelled) setColorPickerOpcoes([]); })
      .finally(() => { if (!cancelled) setLoadingColorPicker(false); });
    return () => { cancelled = true; };
  }, [colorPickerProduto, companyKey, produtos]);

  // ─── Modal: open / close ─────────────────────────────────────────────────────

  const abrirModal = useCallback(() => {
    setItensModal(itens);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    setModalAberto(true);
  }, [itens]);

  const solicitarFecharModal = useCallback(() => {
    const mudou = !sameCart(itensModal, itens);
    if (mudou) { setModalConfirmarFechar(true); return; }
    setModalAberto(false);
  }, [itensModal, itens]);

  const descartarModal = useCallback(() => {
    setModalConfirmarFechar(false);
    setItensModal(itens);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    setModalAberto(false);
  }, [itens]);

  const continuarNoModal = useCallback(() => {
    setModalConfirmarFechar(false);
  }, []);

  const confirmarModal = useCallback(() => {
    setItens(itensModal);
    setModalAberto(false);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [itensModal]);

  // ─── Modal: add product ──────────────────────────────────────────────────────

  const adicionarProdutoModal = useCallback(
    (produto: Produto) => {
      if (produto.corProduto === null) {
        const temVariantesComCor = produtos.some(
          (p) => p.produto.trim() === produto.produto.trim() && p.corProduto !== null
        );
        if (temVariantesComCor) {
          setColorPickerProduto(produto);
          return;
        }
      }

      const filialCod = filialSelecionada?.codFilial?.trim() || "";
      const base: Omit<ListaItem, "quantidade" | "vendas90d" | "estoqueFilial"> = {
        produto: produto.produto,
        descProduto: produto.descProduto,
        codigoBarra: produto.codigoBarra ?? null,
        corProduto: produto.corProduto,
        descCor: (produto.descCor || "").trim(),
      };

      void (async () => {
        let vendas90: number | null = null;
        let estoque: number | null = null;
        if (filialCod) {
          [vendas90, estoque] = await Promise.all([
            fetchVendas90Projetado(companyKey, filialCod, produto.produto, produto.corProduto),
            fetchEstoqueFilialSum(companyKey, filialCod, produto.produto, produto.corProduto),
          ]);
        }
        setItensModal((prev) => {
          const chave = `${base.produto}|${base.corProduto ?? ""}`;
          const idx = prev.findIndex((i) => `${i.produto}|${i.corProduto ?? ""}` === chave);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { ...next[idx], quantidade: next[idx].quantidade + 1 };
            mostrarNotificacao(`${base.descProduto} +1`);
            return next;
          }
          mostrarNotificacao(`${base.descProduto} adicionado`);
          return [
            ...prev,
            {
              ...base,
              quantidade: 1,
              vendas90d: vendas90,
              estoqueFilial: estoque,
            },
          ];
        });
      })();
    },
    [mostrarNotificacao, produtos, filialSelecionada, companyKey]
  );

  const adicionarComCor = useCallback(
    (produtoComCor: Produto) => {
      setColorPickerProduto(null);
      setColorPickerOpcoes([]);
      adicionarProdutoModal(produtoComCor);
    },
    [adicionarProdutoModal]
  );

  const removerItemModal = useCallback((index: number) => {
    setItensModal((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const atualizarQuantidadeModal = useCallback((index: number, qtd: number) => {
    if (qtd < 1) return;
    setItensModal((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantidade: qtd };
      return next;
    });
  }, []);

  // ─── Editor: lista items (fora do modal) ─────────────────────────────────────

  const removerItem = useCallback((index: number) => {
    setItens((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const atualizarQuantidade = useCallback((index: number, qtd: number) => {
    if (qtd < 1) return;
    setItens((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantidade: qtd };
      return next;
    });
  }, []);

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const abrirNovaLista = useCallback(() => {
    setEditingId(undefined);
    setNomeLista("");
    setItens([]);
    if (filiaisDisponiveis.length > 0) setFilialSelecionada(filiaisDisponiveis[0]);
    setMode("editor");
  }, [filiaisDisponiveis]);

  const abrirEdicao = useCallback(
    (lista: ListaLoja) => {
      setEditingId(lista.id);
      setNomeLista(lista.nome);
      setItens(Array.isArray(lista.itens) ? lista.itens : []);
      const f = filiais.find((f) => f.codFilial === lista.filial);
      if (f) setFilialSelecionada(f);
      setMode("editor");
    },
    [filiais]
  );

  const voltarParaLista = useCallback(() => {
    setMode("list");
  }, []);

  // ─── Save ───────────────────────────────────────────────────────────────────

  const salvar = useCallback(async () => {
    if (!user?.username) return;
    if (!filialSelecionada) { mostrarNotificacao("Selecione uma loja", "error"); return; }
    if (itens.length === 0) { mostrarNotificacao("Adicione pelo menos um produto", "error"); return; }

    setSalvando(true);
    try {
      const nomeFinal = nomeLista.trim() || buildDefaultListName(filialSelecionada.filial);
      const result = await salvarLista(
        {
          id: editingId,
          nome: nomeFinal,
          filial: filialSelecionada.codFilial,
          nomeFilial: filialSelecionada.filial,
          company: companyKey,
          itens,
        },
        user.username
      );
      mostrarNotificacao("Lista salva com sucesso!");
      setEditingId(result.id);
      setNomeLista(nomeFinal);
    } catch (err: unknown) {
      mostrarNotificacao(err instanceof Error ? err.message : "Erro ao salvar", "error");
    } finally {
      setSalvando(false);
    }
  }, [user?.username, nomeLista, filialSelecionada, itens, editingId, companyKey, mostrarNotificacao]);

  // ─── Delete ─────────────────────────────────────────────────────────────────

  const excluirLista = useCallback(
    async (lista: ListaLoja, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!user?.username) return;
      if (!confirm(`Excluir a lista "${lista.nome}"?`)) return;
      try {
        await deletarLista(lista.id, user.username);
        mostrarNotificacao("Lista excluída");
        setListas((prev) => prev.filter((l) => l.id !== lista.id));
      } catch {
        mostrarNotificacao("Erro ao excluir lista", "error");
      }
    },
    [user?.username, mostrarNotificacao]
  );

  // ─── Derived ────────────────────────────────────────────────────────────────

  // Produtos que já estão no modal (para não mostrar nos resultados de busca)
  const produtosJaNoModal = useMemo(() => {
    return new Set(itensModal.map((i) => `${i.produto}|${i.corProduto ?? ""}`));
  }, [itensModal]);

  const totalItens = itens.reduce((s, i) => s + i.quantidade, 0);
  const totalItensModal = itensModal.reduce((s, i) => s + i.quantidade, 0);

  // ─── Render: loading ────────────────────────────────────────────────────────

  if (!permissoesCarregadas) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.centered}>Carregando...</div>
      </div>
    );
  }

  // ─── Render: editor ─────────────────────────────────────────────────────────

  if (mode === "editor") {
    return (
      <div className={styles.wrapper}>
        {/* Toast */}
        {notificacao && (
          <div className={`${styles.toast} ${notificacao.tipo === "error" ? styles.toastError : styles.toastSuccess}`}>
            <span className={styles.toastIcon}>{notificacao.tipo === "success" ? "✓" : "✕"}</span>
            {notificacao.mensagem}
          </div>
        )}

        {/* Header */}
        <div className={styles.topBar}>
          <button type="button" className={styles.backBtn} onClick={voltarParaLista}>
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Voltar
          </button>
          <h1 className={styles.title}>{editingId ? "Editar Lista" : "Nova Lista"}</h1>
          <button type="button" className={styles.saveBtn} onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar Lista"}
          </button>
        </div>

        {/* Meta form */}
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Loja</label>
            {filiaisDisponiveis.length === 1 && filialSelecionada ? (
              <div className={styles.filialFixed}>{filialSelecionada.filial}</div>
            ) : (
              <select
                className={styles.select}
                value={filialSelecionada?.codFilial || ""}
                onChange={(e) => {
                  const f = filiaisDisponiveis.find((f) => f.codFilial === e.target.value);
                  if (f) setFilialSelecionada(f);
                }}
              >
                {filiaisDisponiveis.map((f) => (
                  <option key={f.codFilial} value={f.codFilial}>{f.filial}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Produtos da lista (sem card; scroll da página) */}
        <div className={styles.produtosSection}>
          {itens.length === 0 ? (
            <div className={styles.emptyProducts}>
              <div className={styles.emptyProductsIcon}>
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 2 20 6.5v11L12 22l-8-4.5v-11L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M20 6.5 12 12 4 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </div>
              <div className={styles.emptyProductsTitle}>Nenhum produto adicionado</div>
              <div className={styles.emptyProductsSub}>Clique em &ldquo;Adicionar Produto&rdquo; para começar</div>
            </div>
          ) : (
            <div className={styles.produtosList}>
              <ListaLojaItensTable
                itens={itens}
                onIncrement={(idx) =>
                  atualizarQuantidade(idx, (itens[idx]?.quantidade ?? 1) + 1)
                }
                onDecrement={(idx) =>
                  atualizarQuantidade(idx, (itens[idx]?.quantidade ?? 1) - 1)
                }
                onQtyChange={(idx, q) => atualizarQuantidade(idx, q)}
                onRemove={removerItem}
              />
            </div>
          )}

          <div className={styles.produtosActionsRow}>
            {itens.length > 0 && (
              <span className={styles.badge}>
                {itens.length} prod · {totalItens} un.
              </span>
            )}
            <button
              type="button"
              className={styles.addProductBtn}
              onClick={abrirModal}
            >
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Adicionar Produto
            </button>
            {itens.length > 0 && (
              <button
                type="button"
                className={styles.clearProductsBtn}
                onClick={() => setItens([])}
              >
                Limpar lista
              </button>
            )}
          </div>
        </div>

        {/* Modal – Adicionar Produto */}
        {modalAberto && (
          <div className={styles.modalOverlay} onClick={solicitarFecharModal}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Adicionar Produto</h2>
                <button className={styles.modalCloseBtn} onClick={solicitarFecharModal}>×</button>
              </div>

              <div className={styles.modalContent}>
                {/* Search */}
                <div className={styles.searchBox}>
                  <span className={styles.searchIcon}>🔍</span>
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Buscar por nome, código ou código de barras..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Results */}
                {loadingProdutos ? (
                  <div className={styles.loadingText}>Buscando produtos...</div>
                ) : produtos.length === 0 && searchTerm.length >= 2 ? (
                  <div className={styles.emptySearch}>Nenhum produto encontrado</div>
                ) : (
                  <div className={styles.produtosModalList}>
                    {produtos
                      .filter((p) => !produtosJaNoModal.has(`${p.produto}|${p.corProduto ?? ""}`))
                      .map((produto, index) => {
                        const isPickerActive =
                          colorPickerProduto?.produto === produto.produto && produto.corProduto === null;
                        return (
                          <div
                            key={`${produto.produto}-${produto.corProduto ?? "null"}-${index}`}
                            className={`${styles.produtoModalItem}${isPickerActive ? ` ${styles.produtoModalItemPickerActive}` : ""}`}
                          >
                            <div className={styles.produtoModalIcon}>📦</div>
                            <div className={styles.produtoModalInfo}>
                              <div className={styles.produtoModalName}>{produto.descProduto}</div>
                              <div className={styles.produtoModalDetails}>
                                {produto.produto}
                                {produto.descCor ? ` · ${produto.descCor}` : produto.corProduto ? ` · ${produto.corProduto}` : ""}
                                {produto.codigoBarra ? ` · ${produto.codigoBarra}` : ""}
                              </div>
                            </div>
                            {!isPickerActive && (
                              <button
                                className={styles.addModalBtn}
                                onClick={() => adicionarProdutoModal(produto)}
                              >
                                +
                              </button>
                            )}
                            {isPickerActive && (
                              <div className={styles.colorPickerRow}>
                                {loadingColorPicker ? (
                                  <span className={styles.colorPickerLoading}>Buscando cores...</span>
                                ) : colorPickerOpcoes.length > 0 ? (
                                  <div className={styles.colorChips}>
                                    {colorPickerOpcoes.map((opcao) => (
                                      <button
                                        key={opcao.corProduto}
                                        className={styles.colorChip}
                                        onClick={() => adicionarComCor(opcao)}
                                      >
                                        {opcao.descCor || opcao.corProduto}
                                      </button>
                                    ))}
                                    <button
                                      className={styles.colorChipCancel}
                                      onClick={() => { setColorPickerProduto(null); setColorPickerOpcoes([]); }}
                                    >✕</button>
                                  </div>
                                ) : (
                                  <div className={styles.colorPickerNenhuma}>
                                    <span>Nenhuma cor disponível</span>
                                    <button
                                      className={styles.colorChipCancel}
                                      onClick={() => { setColorPickerProduto(null); setColorPickerOpcoes([]); }}
                                    >✕</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Selecionados no modal */}
                {itensModal.length > 0 && (
                  <div className={styles.modalCartBlock}>
                    <div className={styles.modalCartHeader}>
                      <span className={styles.modalCartTitle}>Selecionados</span>
                      <span className={styles.modalCartMeta}>
                        {itensModal.length} prod · {totalItensModal} un.
                      </span>
                    </div>
                    <div className={styles.modalCartList}>
                      <ListaLojaItensTable
                        itens={itensModal}
                        onIncrement={(idx) =>
                          atualizarQuantidadeModal(
                            idx,
                            (itensModal[idx]?.quantidade ?? 1) + 1
                          )
                        }
                        onDecrement={(idx) =>
                          atualizarQuantidadeModal(
                            idx,
                            (itensModal[idx]?.quantidade ?? 1) - 1
                          )
                        }
                        onQtyChange={(idx, q) => atualizarQuantidadeModal(idx, q)}
                        onRemove={removerItemModal}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  className={styles.btnPrimary}
                  onClick={confirmarModal}
                  disabled={itensModal.length === 0}
                >
                  Confirmar ({itensModal.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal – Confirmar fechar */}
        {modalConfirmarFechar && (
          <div className={styles.modalOverlay} onClick={continuarNoModal}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Descartar alterações?</h2>
                <button className={styles.modalCloseBtn} onClick={continuarNoModal}>×</button>
              </div>
              <div className={styles.modalBody}>
                <p className={styles.confirmacaoTexto}>
                  Você adicionou ou alterou produtos mas ainda não confirmou. Deseja descartar essas alterações?
                </p>
              </div>
              <div className={styles.modalFooter}>
                <button className={styles.btnSecondary} onClick={continuarNoModal}>
                  Continuar no modal
                </button>
                <button className={styles.btnDanger} onClick={descartarModal}>
                  Descartar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Render: list view ───────────────────────────────────────────────────────

  return (
    <div className={styles.wrapper}>
      {notificacao && (
        <div className={`${styles.toast} ${notificacao.tipo === "error" ? styles.toastError : styles.toastSuccess}`}>
          <span className={styles.toastIcon}>{notificacao.tipo === "success" ? "✓" : "✕"}</span>
          {notificacao.mensagem}
        </div>
      )}

      <div className={styles.topBar}>
        <div>
          <h1 className={styles.title}>Lista Loja</h1>
          <p className={styles.subtitle}>{companyName}</p>
        </div>
        <button type="button" className={styles.saveBtn} onClick={abrirNovaLista}>
          + Nova Lista
        </button>
      </div>

      {loadingListas ? (
        <div className={styles.centered}>Carregando listas...</div>
      ) : listas.length === 0 ? (
        <div className={styles.emptyState}>
          <svg viewBox="0 0 24 24" fill="none" width="48" height="48">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p>Nenhuma lista criada ainda</p>
          <button type="button" className={styles.saveBtn} onClick={abrirNovaLista}>
            Criar primeira lista
          </button>
        </div>
      ) : (
        <div className={styles.listasGrid}>
          {listas.map((lista) => {
            const totalUnidades = (lista.itens || []).reduce((s, i) => s + i.quantidade, 0);
            return (
              <div
                key={lista.id}
                className={styles.listaCard}
                onClick={() => abrirEdicao(lista)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && abrirEdicao(lista)}
              >
                <div className={styles.listaCardContent}>
                  <div className={styles.listaCardTop}>
                    <span className={styles.listaFilialTag}>{lista.nome_filial}</span>
                  </div>
                  <div className={styles.listaCardMeta}>
                    <span>{lista.username}</span>
                    <span className={styles.metaDot}>·</span>
                    <span>
                      {(lista.itens || []).length} produto(s)
                      {totalUnidades > 0 ? `, ${totalUnidades} un.` : ""}
                    </span>
                    <span className={styles.metaDot}>·</span>
                    <span>{formatDate(lista.updated_at)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={(e) => excluirLista(lista, e)}
                  aria-label="Excluir lista"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
