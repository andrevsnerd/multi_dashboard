"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import type { Notificacao, NotificacoesResponse } from "@/lib/types/notificacao";

const COMPANIES = ["nerd", "scarfme"] as const;
const POLL_MS = 60_000;

/** Extrai a empresa atual da URL (ex.: /nerd/... -> "nerd"). */
function getCompanyFromPath(pathname: string | null): string | null {
  const seg = (pathname ?? "").split("/").filter(Boolean)[0];
  return seg && (COMPANIES as readonly string[]).includes(seg) ? seg : null;
}

/**
 * Hook reutilizável para o estado de notificações do usuário na empresa atual.
 * Busca com polling leve e expõe ações de leitura. Não dispara nada quando não
 * há usuário/empresa (ex.: tela de login, seleção de empresa, /admin).
 */
export function useNotificacoes() {
  const { user } = useAuth();
  const pathname = usePathname();
  const company = getCompanyFromPath(pathname);
  const username = user?.username ?? null;

  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef(true);

  const fetchNotificacoes = useCallback(async () => {
    if (!username || !company) {
      setNotificacoes([]);
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
      setNaoLidas(json.naoLidas || 0);
    } catch {
      // silencioso: notificações nunca devem quebrar a UI
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [username, company]);

  useEffect(() => {
    activeRef.current = true;
    void fetchNotificacoes();
    const id = username && company ? setInterval(() => void fetchNotificacoes(), POLL_MS) : undefined;
    return () => {
      activeRef.current = false;
      if (id) clearInterval(id);
    };
  }, [username, company, fetchNotificacoes]);

  const marcarLida = useCallback(
    async (key: string) => {
      if (!username) return;
      // Otimista: marca local antes da resposta.
      setNotificacoes((prev) => prev.map((n) => (n.key === key ? { ...n, lida: true } : n)));
      setNaoLidas((prev) => Math.max(0, prev - 1));
      try {
        await fetch("/api/notificacoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ keys: [key] }),
        });
      } catch {
        /* mantém o otimismo; próximo poll reconcilia */
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

  return {
    company,
    notificacoes,
    naoLidas,
    loading,
    marcarLida,
    marcarTodas,
    refetch: fetchNotificacoes,
  };
}
