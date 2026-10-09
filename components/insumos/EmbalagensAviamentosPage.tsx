"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import { isReadOnlyRole } from "@/lib/auth/permissions";

import styles from "./EmbalagensAviamentosPage.module.css";

/**
 * Tela "Embalagens e Aviamentos": o estoque digitado de cada embalagem e aviamento.
 *
 * É aqui que esse estoque se altera. A Projeção Compra só lê o da Rede ScarfMe (o mesmo
 * registro), então o que muda aqui vale lá ao recarregar a aba. O Corporativo usa só parte
 * dos itens, em estoque separado, e não entra na projeção.
 *
 * Grava sozinho, sem botão, com o mesmo mecanismo que as abas da projeção usavam:
 *
 *   1. Enquanto o campo está sendo digitado, quem manda é o RASCUNHO (texto): apagar o campo
 *      não vira 0 na hora nem prende o cursor.
 *   2. O que está na fila de gravação vence o que veio do servidor até a gravação confirmar.
 */

type Rede = "scarfme" | "corporativo";
type Tipo = "embalagens" | "aviamentos";
type Estoque = Record<string, number>;

interface Item {
  id: string;
  nome: string;
}

interface Resposta {
  itens: Record<Rede, Record<Tipo, Item[]>>;
  estoque: Record<Rede, Record<Tipo, Estoque>>;
  error?: string;
}

const REDES: { key: Rede; label: string }[] = [
  { key: "scarfme", label: "Rede ScarfMe" },
  { key: "corporativo", label: "Corporativo" },
];

const SECOES: { tipo: Tipo; titulo: string; coluna: string }[] = [
  { tipo: "embalagens", titulo: "Embalagens", coluna: "Embalagem" },
  { tipo: "aviamentos", titulo: "Aviamentos", coluna: "Aviamento" },
];

/** Chave da fila e das edições: uma por rede × tipo, que é o que o PUT grava de uma vez. */
type Grupo = `${Rede}|${Tipo}`;
const grupoDe = (rede: Rede, tipo: Tipo): Grupo => `${rede}|${tipo}`;

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export default function EmbalagensAviamentosPage() {
  const { user } = useAuth();
  const username = user?.username ?? "";
  const somenteLeitura = isReadOnlyRole(user?.role);

  const [rede, setRede] = useState<Rede>("scarfme");
  const [itens, setItens] = useState<Partial<Record<Rede, Record<Tipo, Item[]>>>>({});
  const [salvo, setSalvo] = useState<Partial<Record<Rede, Record<Tipo, Estoque>>>>({});
  /** Edições ainda não confirmadas pelo servidor. Vencem o que veio do GET. */
  const [editado, setEditado] = useState<Partial<Record<Grupo, Estoque>>>({});
  /** Texto cru da célula que está sendo digitada (grupo|id → string). */
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Muda a cada "Atualizar": é o que dispara a consulta de novo. */
  const [versao, setVersao] = useState(0);

  // ── Consulta ──
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    fetch("/api/embalagens-aviamentos", { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json()) as Resposta;
        if (!r.ok) throw new Error(json?.error || "Erro ao carregar o estoque");
        return json;
      })
      .then((json) => {
        if (cancelado) return;
        setItens(json.itens ?? {});
        setSalvo(json.estoque ?? {});
      })
      .catch((e: Error) => {
        if (cancelado) return;
        setErro(e.message || "Erro ao carregar o estoque");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [versao]);

  const estoqueDe = useCallback(
    (r: Rede, tipo: Tipo): Estoque => ({
      ...(salvo[r]?.[tipo] ?? {}),
      ...(editado[grupoDe(r, tipo)] ?? {}),
    }),
    [salvo, editado]
  );

  const secoes = useMemo(
    () =>
      SECOES.map((secao) => {
        const estoque = estoqueDe(rede, secao.tipo);
        const linhas = (itens[rede]?.[secao.tipo] ?? []).map((item) => ({
          item,
          estoque: Math.max(0, Number(estoque[item.id] ?? 0) || 0),
        }));
        return {
          ...secao,
          linhas,
          total: linhas.reduce((s, l) => s + l.estoque, 0),
          zerados: linhas.filter((l) => l.estoque === 0).length,
        };
      }),
    [itens, rede, estoqueDe]
  );

  // ── Gravação automática ──
  /** Linhas esperando gravação. Fora do estado: o timer lê o valor da hora. */
  const filaRef = useRef<Partial<Record<Grupo, Estoque>>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gravarFila = useCallback(async () => {
    const lotes = filaRef.current;
    filaRef.current = {};
    const grupos = (Object.keys(lotes) as Grupo[]).filter(
      (g) => Object.keys(lotes[g] ?? {}).length > 0
    );
    if (grupos.length === 0) return;

    setSalvando(true);
    setAviso(null);
    let falhou: string | null = null;
    for (const grupo of grupos) {
      const lote = lotes[grupo] ?? {};
      const [r, tipo] = grupo.split("|") as [Rede, Tipo];
      try {
        const res = await fetch("/api/embalagens-aviamentos", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ rede: r, tipo, estoque: lote }),
        });
        const json = (await res.json()) as { estoque?: Estoque; error?: string };
        if (!res.ok) throw new Error(json?.error || "Erro ao salvar o estoque");
        setSalvo((prev) => ({
          ...prev,
          [r]: { ...(prev[r] ?? { embalagens: {}, aviamentos: {} }), [tipo]: json.estoque ?? {} },
        }));
        // Sai das pendentes só quem foi gravado com o valor que ainda está na tela: se a
        // pessoa digitou de novo enquanto o PUT ia, a edição nova continua mandando.
        setEditado((prev) => {
          const atual = { ...(prev[grupo] ?? {}) };
          Object.keys(lote).forEach((id) => {
            if (atual[id] === lote[id] && filaRef.current[grupo]?.[id] == null) delete atual[id];
          });
          return { ...prev, [grupo]: atual };
        });
      } catch (e) {
        // O lote volta para a fila: a próxima digitação (ou a saída do campo) tenta de novo.
        filaRef.current = {
          ...filaRef.current,
          [grupo]: { ...lote, ...(filaRef.current[grupo] ?? {}) },
        };
        falhou = e instanceof Error ? e.message : "Erro ao salvar o estoque";
      }
    }
    setSalvando(false);
    setAviso(falhou ?? "Estoque salvo.");
  }, [username]);

  /** Enfileira a célula e grava sozinho depois de uma pausa na digitação. */
  const agendarGravacao = useCallback(
    (grupo: Grupo, id: string, valor: number) => {
      filaRef.current = {
        ...filaRef.current,
        [grupo]: { ...(filaRef.current[grupo] ?? {}), [id]: valor },
      };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void gravarFila();
      }, 700);
    },
    [gravarFila]
  );

  /** Sair do campo não espera a pausa: grava na hora. */
  const gravarAgora = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void gravarFila();
  }, [gravarFila]);

  // Sair da tela não pode engolir o que ficou na fila.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void gravarFila();
    };
  }, [gravarFila]);

  const status = salvando
    ? "Salvando…"
    : aviso || (somenteLeitura ? "Somente leitura." : "O estoque grava sozinho ao ser alterado.");

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.titulo}>Embalagens e Aviamentos</h1>
          <p className={styles.subtitulo}>
            Estoque de embalagens e aviamentos, contado à mão. A <strong>Rede ScarfMe</strong> é o
            estoque que a <strong>Projeção Compra</strong> usa: o que for alterado aqui já vale lá. O{" "}
            <strong>Corporativo</strong> usa só parte dos itens, em estoque separado.
          </p>
        </div>
        <div className={styles.acoes}>
          <span className={styles.status}>{status}</span>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => setVersao((v) => v + 1)}
            disabled={carregando}
          >
            {carregando ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </header>

      <div className={styles.segmented} role="tablist" aria-label="Rede">
        {REDES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={rede === r.key}
            className={`${styles.segment} ${rede === r.key ? styles.segmentActive : ""}`}
            onClick={() => {
              gravarAgora();
              setRede(r.key);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {erro && <div className={styles.faixaErro}>{erro}</div>}

      <div className={styles.grid}>
        {secoes.map((secao) => {
          const grupo = grupoDe(rede, secao.tipo);
          return (
            <section key={secao.tipo} className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitulo}>{secao.titulo}</h2>
                <span className={styles.cardResumo}>
                  {fmt(secao.linhas.length)} itens · {fmt(secao.total)} un.
                  {secao.zerados > 0 && ` · ${fmt(secao.zerados)} zerados`}
                </span>
              </div>
              <div className={styles.tabelaScroll}>
                <table className={styles.tabela}>
                  <thead>
                    <tr>
                      <th>{secao.coluna}</th>
                      {secao.tipo === "aviamentos" && <th>Código</th>}
                      <th className={styles.colNum}>Estoque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {secao.linhas.length === 0 ? (
                      <tr>
                        <td colSpan={secao.tipo === "aviamentos" ? 3 : 2} className={styles.vazio}>
                          {carregando ? "Carregando…" : "Sem itens."}
                        </td>
                      </tr>
                    ) : (
                      secao.linhas.map((l) => {
                        const chave = `${grupo}|${l.item.id}`;
                        const foiEditado = editado[grupo]?.[l.item.id] != null;
                        return (
                          <tr key={l.item.id}>
                            <td className={styles.nome}>{l.item.nome}</td>
                            {secao.tipo === "aviamentos" && (
                              <td className={styles.codigo}>{l.item.id}</td>
                            )}
                            <td className={styles.colNum}>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                aria-label={`Estoque de ${l.item.nome}`}
                                className={`${styles.inputNum} ${
                                  foiEditado ? styles.inputEditado : ""
                                } ${l.estoque === 0 ? styles.inputZero : ""}`}
                                value={rascunho[chave] ?? String(l.estoque)}
                                disabled={somenteLeitura}
                                onChange={(e) => {
                                  const texto = e.target.value;
                                  setAviso(null);
                                  // O campo mostra o que foi digitado, inclusive vazio: só vira
                                  // número (e vai para a fila) quando há algo para gravar.
                                  setRascunho((prev) => ({ ...prev, [chave]: texto }));
                                  if (texto.trim() === "") return;
                                  const valor = Math.max(0, Math.round(Number(texto) || 0));
                                  setEditado((prev) => ({
                                    ...prev,
                                    [grupo]: { ...(prev[grupo] ?? {}), [l.item.id]: valor },
                                  }));
                                  agendarGravacao(grupo, l.item.id, valor);
                                }}
                                onBlur={() => {
                                  // Campo deixado vazio volta a mostrar o valor que vale hoje.
                                  setRascunho((prev) => {
                                    const proximo = { ...prev };
                                    delete proximo[chave];
                                    return proximo;
                                  });
                                  gravarAgora();
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {secao.linhas.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={secao.tipo === "aviamentos" ? 2 : 1}>Total</td>
                        <td className={styles.colNum}>{fmt(secao.total)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
