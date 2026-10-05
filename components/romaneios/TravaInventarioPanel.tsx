"use client";

import { useState } from "react";

import styles from "./RomaneiosPage.module.css";

/** Trava manual por filial — ver lib/utils/trava-inventario-store.ts. */
export interface TravaInventarioFilial {
  companyKey: string;
  filial: string;
  codFilial: string | null;
  dataCorte: string; // YYYY-MM-DD
  inventarioNome: string | null;
  aplicadoPor: string | null;
  atualizadoEm: string | null;
}

interface InventarioLinx {
  filial: string;
  codFilial: string | null;
  nome: string;
  data: string; // YYYY-MM-DD
}

interface Props {
  companySlug: string;
  username: string;
  travas: TravaInventarioFilial[];
  onTravasChange: (travas: TravaInventarioFilial[]) => void;
  /** Quantos romaneios pendentes cada trava está segurando (chave: filial). */
  travadosPorFilial: Map<string, number>;
  getFilialDisplayName: (filial: string) => string;
}

export function fmtDia(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Painel do admin na página Romaneios: lista os últimos inventários (INV...) do
 * Linx SÓ quando pedido e aplica/remove a trava por filial com um clique.
 */
export default function TravaInventarioPanel({
  companySlug,
  username,
  travas,
  onTravasChange,
  travadosPorFilial,
  getFilialDisplayName,
}: Props) {
  const [inventarios, setInventarios] = useState<InventarioLinx[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ filial: string; data: string } | null>(null);

  const travaPorFilial = new Map(travas.map((t) => [t.filial.trim().toUpperCase(), t]));

  async function carregarInventarios() {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ company: companySlug, inventarios: "1" });
      const res = await fetch(`/api/romaneios/trava-inventario?${params.toString()}`, {
        headers: { "x-auth-username": username },
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { inventarios?: InventarioLinx[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Erro ao carregar inventários");
      setInventarios(json.inventarios ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar inventários");
    } finally {
      setCarregando(false);
    }
  }

  async function aplicar(filial: string, codFilial: string | null, dataCorte: string, inventarioNome: string | null) {
    setSalvando(filial);
    setErro(null);
    try {
      const res = await fetch("/api/romaneios/trava-inventario", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ companyKey: companySlug, filial, codFilial, dataCorte, inventarioNome }),
      });
      const json = (await res.json().catch(() => ({}))) as { travas?: TravaInventarioFilial[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Erro ao aplicar trava");
      onTravasChange(json.travas ?? []);
      setEditando(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao aplicar trava");
    } finally {
      setSalvando(null);
    }
  }

  async function remover(filial: string) {
    if (!window.confirm(`Remover a trava de ${getFilialDisplayName(filial)}? Os romaneios antigos voltam a poder ser confirmados.`)) return;
    setSalvando(filial);
    setErro(null);
    try {
      const res = await fetch("/api/romaneios/trava-inventario", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ companyKey: companySlug, filial }),
      });
      const json = (await res.json().catch(() => ({}))) as { travas?: TravaInventarioFilial[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Erro ao remover trava");
      onTravasChange(json.travas ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao remover trava");
    } finally {
      setSalvando(null);
    }
  }

  const pendentesDeTrava = (inventarios ?? []).filter((inv) => {
    const t = travaPorFilial.get(inv.filial.trim().toUpperCase());
    return !t || t.dataCorte !== inv.data;
  });

  async function aplicarTodas() {
    for (const inv of pendentesDeTrava) {
      await aplicar(inv.filial, inv.codFilial, inv.data, inv.nome);
    }
  }

  return (
    <details className={styles.travaInventarioPanel}>
      <summary>
        🔒 Trava de inventário — {travas.length === 0 ? "nenhuma filial travada" : `${travas.length} filia${travas.length === 1 ? "l travada" : "is travadas"}`}
      </summary>
      <p className={styles.travaInventarioHint}>
        Na filial travada, romaneio de saída/trânsito com data <strong>anterior</strong> à data de corte fica
        só para consulta — ninguém confirma. Vale até você remover. Filial sem trava não é afetada.
      </p>

      {erro && <p className={styles.travaInventarioErro}>{erro}</p>}

      {travas.length > 0 && (
        <table className={styles.travaInventarioTable}>
          <thead>
            <tr>
              <th>Filial travada</th>
              <th>Corte (antes de)</th>
              <th>Inventário</th>
              <th>Romaneios travados</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {travas.map((t) => (
              <tr key={t.filial}>
                <td>{getFilialDisplayName(t.filial)}</td>
                <td>
                  {editando?.filial === t.filial ? (
                    <input
                      type="date"
                      value={editando.data}
                      onChange={(e) => setEditando({ filial: t.filial, data: e.target.value })}
                    />
                  ) : (
                    fmtDia(t.dataCorte)
                  )}
                </td>
                <td>{t.inventarioNome || "—"}</td>
                <td>{travadosPorFilial.get(t.filial) ?? 0}</td>
                <td className={styles.travaInventarioAcoes}>
                  {editando?.filial === t.filial ? (
                    <>
                      <button
                        type="button"
                        disabled={salvando === t.filial || !editando.data}
                        onClick={() => aplicar(t.filial, t.codFilial, editando.data, t.inventarioNome)}
                      >
                        Salvar
                      </button>
                      <button type="button" onClick={() => setEditando(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setEditando({ filial: t.filial, data: t.dataCorte })}>
                        Alterar data
                      </button>
                      <button type="button" disabled={salvando === t.filial} onClick={() => remover(t.filial)}>
                        Remover
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.travaInventarioBarra}>
        <button type="button" onClick={carregarInventarios} disabled={carregando}>
          {carregando ? "Carregando…" : inventarios ? "Recarregar últimos inventários" : "Carregar últimos inventários (INV…)"}
        </button>
        {pendentesDeTrava.length > 1 && (
          <button type="button" onClick={aplicarTodas} disabled={!!salvando}>
            Aplicar trava em todas ({pendentesDeTrava.length})
          </button>
        )}
      </div>

      {inventarios && (
        inventarios.length === 0 ? (
          <p className={styles.travaInventarioHint}>Nenhum inventário INV… encontrado nas filiais desta empresa.</p>
        ) : (
          <table className={styles.travaInventarioTable}>
            <thead>
              <tr>
                <th>Filial</th>
                <th>Último inventário</th>
                <th>Data</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inventarios.map((inv) => {
                const t = travaPorFilial.get(inv.filial.trim().toUpperCase());
                const emDia = t?.dataCorte === inv.data;
                return (
                  <tr key={inv.filial}>
                    <td>{getFilialDisplayName(inv.filial)}</td>
                    <td>{inv.nome}</td>
                    <td>{fmtDia(inv.data)}</td>
                    <td>{t ? `Travada (antes de ${fmtDia(t.dataCorte)})` : "Sem trava"}</td>
                    <td className={styles.travaInventarioAcoes}>
                      {!emDia && (
                        <button
                          type="button"
                          disabled={salvando === inv.filial}
                          onClick={() => aplicar(inv.filial, inv.codFilial, inv.data, inv.nome)}
                        >
                          {t ? "Atualizar para esta data" : "Aplicar trava"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </details>
  );
}
