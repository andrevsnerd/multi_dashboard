"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Redirecionamento legado.
 * As permissões de transferência agora estão integradas ao painel de usuários em /admin.
 */
export default function TransferenciaPermissoesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin");
  }, [router]);

  return (
    <div style={{ padding: 32, color: "#64748b", fontSize: 14 }}>
      Redirecionando para o Painel Admin...
    </div>
  );
}
