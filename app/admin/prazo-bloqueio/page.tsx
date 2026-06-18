"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthContext";
import pageStyles from "../page.module.css";
import styles from "./page.module.css";

const COMPANIES = [
  { key: "scarfme", label: "SCARF ME" },
  { key: "nerd", label: "NERD" },
] as const;

type CompanyKey = (typeof COMPANIES)[number]["key"];

export default function PrazoBloqueioPage() {
  const { user: currentUser } = useAuth();

  const [prazos, setPrazos] = useState<Record<string, number>>({});
  const [limites, setLimites] = useState<{ min: number; max: number }>({ min: 1, max: 90 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Estado por empresa: valor no input + flag de salvando + msg de sucesso.
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const authHeader = useCallback(
    (): Record<string, string> =>
      currentUser ? { "X-Auth-Username": currentUser.username } : {},
    [currentUser]
  );

  const load = useCallback(async () => {
    if (!currentUser?.username) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/prazo-bloqueio", {
        headers: authHeader(),
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar prazos");
      setPrazos(json.data ?? {});
      if (typeof json.min === "number" && typeof json.max === "number") {
        setLimites({ min: json.min, max: json.max });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.username, authHeader]);

  useEffect(() => {
    load();
  }, [load]);

  function handleChange(company: CompanyKey, raw: string) {
    setSavedKey(null);
    const n = parseInt(raw, 10);
    setPrazos((prev) => ({ ...prev, [company]: Number.isNaN(n) ? 0 : n }));
  }

  async function handleSave(company: CompanyKey) {
    const dias = prazos[company];
    if (dias < limites.min || dias > limites.max) {
      setError(`O prazo deve estar entre ${limites.min} e ${limites.max} dias.`);
      return;
    }
    setError("");
    setSavingKey(company);
    setSavedKey(null);
    try {
      const res = await fetch("/api/admin/prazo-bloqueio", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ company, dias }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar");
      setPrazos((prev) => ({ ...prev, [company]: json.dias }));
      setSavedKey(company);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingKey(null);
    }
  }

  if (!currentUser) return null;

  return (
    <main className={pageStyles.container}>
      <header className={pageStyles.header}>
        <div>
          <Link href="/admin" className={pageStyles.backLink}>
            ← Voltar ao Painel Admin
          </Link>
          <h1 className={pageStyles.title}>Prazo de bloqueio</h1>
          <p className={pageStyles.subtitle}>
            Quantos dias uma entrada pode ficar sem confirmação antes de bloquear o acesso da filial.
          </p>
        </div>
      </header>

      {error && <p className={pageStyles.error}>{error}</p>}

      {loading ? (
        <p className={pageStyles.loading}>Carregando...</p>
      ) : (
        <div className={styles.cards}>
          {COMPANIES.map(({ key, label }) => {
            const value = prazos[key] ?? "";
            const saving = savingKey === key;
            const saved = savedKey === key;
            return (
              <div key={key} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.company}>{label}</span>
                  {saved && <span className={styles.saved}>✓ Salvo</span>}
                </div>
                <p className={styles.cardHint}>
                  Bloqueia após <strong>{value || "—"}</strong> dias sem confirmar a entrada.
                </p>
                <div className={styles.controls}>
                  <input
                    type="number"
                    className={styles.input}
                    min={limites.min}
                    max={limites.max}
                    value={value}
                    onChange={(e) => handleChange(key, e.target.value)}
                    disabled={saving}
                  />
                  <span className={styles.unit}>dias</span>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    onClick={() => handleSave(key)}
                    disabled={saving}
                  >
                    {saving ? "Salvando..." : "Salvar"}
                  </button>
                </div>
                <p className={styles.range}>
                  Entre {limites.min} e {limites.max} dias.
                </p>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
