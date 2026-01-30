"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import styles from "./page.module.css";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.ok) {
        router.replace("/");
      } else {
        setError(result.error ?? "Erro ao fazer login");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.subtitle}>Entre com seu usuário e senha</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Usuário
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={styles.input}
              autoComplete="username"
              required
              disabled={loading}
            />
          </label>
          <label className={styles.label}>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
