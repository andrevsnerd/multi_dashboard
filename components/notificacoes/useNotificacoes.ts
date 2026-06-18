"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { TRAVA_DIAS_MINIMOS } from "@/lib/config/notificacoes-trava";
import type { Notificacao, NotificacoesResponse } from "@/lib/types/notificacao";

const COMPANIES = ["nerd", "scarfme"] as const;
const POLL_MS = 60_000;

/** Extrai a empresa atual da URL (ex.: /nerd/... -> "nerd"). */
function getCompanyFromPath(pathname: string | null): string | null {
  const seg = (pathname ?? "").split("/").filter(Boolean)[0];
  return seg && (COMPANIES as readonly string[]).includes(seg) ? seg : null;
}

function isRomaneiosPath(pathname: string | null): boolean {
  return (pathname ?? "").includes("/romaneios");
}

interface NotificacoesState {
  company: string | null;
  pathname: string | null;
  notificacoes: Notificacao[];
  bloqueios: Notificacao[];
  naoLidas: number;
  /** Prazo (dias mínimos) da trava da empresa atual — para textos da UI. */
  diasMinimos: number;
  loading: boolean;
  marcarLida: (key: string) => Promise<void>;
  marcarTodas: () => Promise<void>;
  refetch: () => Promise<void>;
}

const NotificacoesContext = createContext<NotificacoesState | null>(null);

/**
 * Provider único de notificações: faz UM polling e compartilha o estado com o
 * sino, a tela cheia e a trava de bloqueio. Evita buscas duplicadas no banco.
 *
 * Empresa: prioriza a da URL; se não houver (ex.: tela de seleção "/"), cai
 * para a única empresa permitida do usuário — assim a trava continua valendo
 * mesmo fora das telas da empresa.
 */
export function NotificacoesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const username = user?.username ?? null;

  const companyFromPath = getCompanyFromPath(pathname);
  const allowed = user?.allowedCompanies;
  const fallbackCompany = allowed && allowed.length === 1 ? allowed[0] : null;
  const company = companyFromPath ?? fallbackCompany;

  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [bloqueios, setBloqueios] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [diasMinimos, setDiasMinimos] = useState(TRAVA_DIAS_MINIMOS);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef(true);

  const fetchNotificacoes = useCallback(async () => {
    if (!username || !company) {
      setNotificacoes([]);
      setBloqueios([]);
      setNaoLidas(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/notificacoes?company=${encodeURIComponent(company)}`, {
        headers: { "x-auth-username": username },
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as NotificacoesResponse;
      if (!activeRef.current) return;
      setNotificacoes(json.data || []);
      setBloqueios(json.bloqueios || []);
      setNaoLidas(json.naoLidas || 0);
      if (typeof json.diasMinimos === "number") setDiasMinimos(json.diasMinimos);
    } catch {
      // silencioso: notificações nunca devem quebrar a UI
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [username, company]);

  // Polling principal.
  useEffect(() => {
    activeRef.current = true;
    void fetchNotificacoes();
    const id = username && company ? setInterval(() => void fetchNotificacoes(), POLL_MS) : undefined;
    return () => {
      activeRef.current = false;
      if (id) clearInterval(id);
    };
  }, [username, company, fetchNotificacoes]);

  // Revalida assim que o usuário SAI da tela de romaneios (onde ele confirma),
  // para a trava sumir imediatamente após a confirmação.
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    const saiuDeRomaneios = isRomaneiosPath(prevPathRef.current) && !isRomaneiosPath(pathname);
    prevPathRef.current = pathname;
    if (saiuDeRomaneios) void fetchNotificacoes();
  }, [pathname, fetchNotificacoes]);

  const marcarLida = useCallback(
    async (key: string) => {
      if (!username) return;
      setNotificacoes((prev) => prev.map((n) => (n.key === key ? { ...n, lida: true } : n)));
      setNaoLidas((prev) => Math.max(0, prev - 1));
      try {
        await fetch("/api/notificacoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ keys: [key] }),
        });
      } catch {
        /* próximo poll reconcilia */
      }
    },
    [username]
  );

  const marcarTodas = useCallback(async () => {
    if (!username || !company) return;
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })));
    setNaoLidas(0);
    try {
      await fetch("/api/notificacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ marcarTodas: true, company }),
      });
    } catch {
      /* próximo poll reconcilia */
    }
  }, [username, company]);

  const value: NotificacoesState = {
    company,
    pathname,
    notificacoes,
    bloqueios,
    naoLidas,
    diasMinimos,
    loading,
    marcarLida,
    marcarTodas,
    refetch: fetchNotificacoes,
  };

  return createElement(NotificacoesContext.Provider, { value }, children);
}

/** Consome o estado de notificações compartilhado. */
export function useNotificacoes(): NotificacoesState {
  const ctx = useContext(NotificacoesContext);
  if (!ctx) {
    // Fora do provider: estado inerte (não quebra, só não notifica).
    return {
      company: null,
      pathname: null,
      notificacoes: [],
      bloqueios: [],
      naoLidas: 0,
      diasMinimos: TRAVA_DIAS_MINIMOS,
      loading: false,
      marcarLida: async () => {},
      marcarTodas: async () => {},
      refetch: async () => {},
    };
  }
  return ctx;
}
