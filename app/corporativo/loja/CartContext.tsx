"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth/AuthContext";
// Fonte única do frete — editar em lib/corporativo/config.ts.
import { FRETE_FIXO } from "@/lib/corporativo/config";
export { FRETE_FIXO };

export interface CartItem {
  produto: string;
  descProduto: string;
  ean: string;
  /** Código da cor (COR_PRODUTO). "" quando o produto não tem cores. */
  cor: string;
  corNome: string;
  /** Tamanho (TAMANHO). Vazio quando o produto nao tem grade de numeracao. */
  tamanho: string;
  /** PRODUTOS.GRADE (dimensao, ex: "90x90") — exibido entre parenteses ao lado do nome. */
  grade: string;
  precoUnitario: number;
  quantidade: number;
  imagem?: string | null;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  subtotal: number;
  frete: number;
  total: number;
  addItem: (item: CartItem) => void;
  setQuantidade: (produto: string, cor: string, tamanho: string, quantidade: number) => void;
  removeItem: (produto: string, cor: string, tamanho: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function keyOf(produto: string, cor: string, tamanho: string) {
  return `${produto} ${cor} ${tamanho}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const storageKey = useMemo(
    () => `corporativo-cart-${user?.id ?? "anon"}`,
    [user?.id]
  );
  const [items, setItems] = useState<CartItem[]>([]);
  // Guarda a chave já carregada, para persistir sempre no storage do usuário certo.
  const storageKeyRef = useRef(storageKey);

  const persist = useCallback((next: CartItem[]) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKeyRef.current, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  // Carrega o carrinho do usuário atual quando a chave muda (login/troca de usuário).
  useEffect(() => {
    storageKeyRef.current = storageKey;
    let loaded: CartItem[] = [];
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
      const parsed = raw ? (JSON.parse(raw) as CartItem[]) : [];
      loaded = Array.isArray(parsed) ? parsed : [];
    } catch {
      loaded = [];
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hidrata o carrinho persistido ao trocar de usuário
    setItems(loaded);
  }, [storageKey]);

  // Mutações persistem no storage no mesmo passo (evita corrida do effect de persistência).
  const commit = useCallback(
    (updater: (prev: CartItem[]) => CartItem[]) => {
      setItems((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const addItem = useCallback(
    (item: CartItem) => {
      commit((prev) => {
        const k = keyOf(item.produto, item.cor, item.tamanho);
        const idx = prev.findIndex((i) => keyOf(i.produto, i.cor, i.tamanho) === k);
        if (idx === -1) return [...prev, item];
        const next = [...prev];
        next[idx] = { ...next[idx], quantidade: next[idx].quantidade + item.quantidade };
        return next;
      });
    },
    [commit]
  );

  const setQuantidade = useCallback(
    (produto: string, cor: string, tamanho: string, quantidade: number) => {
      commit((prev) => {
        const k = keyOf(produto, cor, tamanho);
        if (quantidade <= 0) return prev.filter((i) => keyOf(i.produto, i.cor, i.tamanho) !== k);
        return prev.map((i) => (keyOf(i.produto, i.cor, i.tamanho) === k ? { ...i, quantidade } : i));
      });
    },
    [commit]
  );

  const removeItem = useCallback(
    (produto: string, cor: string, tamanho: string) => {
      commit((prev) => prev.filter((i) => keyOf(i.produto, i.cor, i.tamanho) !== keyOf(produto, cor, tamanho)));
    },
    [commit]
  );

  const clear = useCallback(() => {
    setItems([]);
    persist([]);
  }, [persist]);

  const subtotal = useMemo(
    () => Number(items.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0).toFixed(2)),
    [items]
  );
  const count = useMemo(() => items.reduce((s, i) => s + i.quantidade, 0), [items]);
  const frete = items.length > 0 ? FRETE_FIXO : 0;
  const total = Number((subtotal + frete).toFixed(2));

  const value: CartContextValue = {
    items,
    count,
    subtotal,
    frete,
    total,
    addItem,
    setQuantidade,
    removeItem,
    clear,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart deve ser usado dentro de CartProvider");
  return ctx;
}

export function formatBRL(value: number): string {
  return (value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
