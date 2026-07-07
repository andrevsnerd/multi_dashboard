"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import styles from "./page.module.css";

export default function AlterarSenhaPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [error, setError] = useState("");
  const [sucesso, setSucesso] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSucesso(false);

    if (novaSenha !== confirmarSenha) {
      setError("A confirmação não confere com a nova senha");
      return;
    }
    if (novaSenha.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/alterar-senha", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-username": user!.username,
        },
        body: JSON.stringify({ senhaAtual, novaSenha }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao alterar senha");
        return;
      }
      setSucesso(true);
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmarSenha("");
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Alterar Senha</h1>
        <p className={styles.subtitle}>Atualize a senha da sua conta ({user.username})</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Senha atual
            <input
              type="password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              className={styles.input}
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </label>
          <label className={styles.label}>
            Nova senha
            <input
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              className={styles.input}
              autoComplete="new-password"
              required
              disabled={loading}
            />
          </label>
          <label className={styles.label}>
            Confirmar nova senha
            <input
              type="password"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
              className={styles.input}
              autoComplete="new-password"
              required
              disabled={loading}
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          {sucesso && <p className={styles.success}>Senha alterada com sucesso.</p>}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.back()}
              disabled={loading}
            >
              Voltar
            </button>
            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
