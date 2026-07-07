"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import { formatRomaneioDateTimeBrasilia } from "@/lib/utils/romaneios-date";
import styles from "./RomaneiosDuplicadosPanel.module.css";

interface ItemSaida {
  produto: string;
  cor: string;
  qtde: number;
}

interface MembroPlano {
  romaneio: string;
  origem: string;
  destino: string;
  responsavel: string;
  tipo: string;
  emissao: string;
  emissaoMs: number;
  itens: ItemSaida[];
  confirmado: boolean;
  acao: "MANTER" | "REMOVER";
}

interface GrupoPlano {
  chave: string;
  origem: string;
  destino: string;
  responsavel: string;
  assinatura: string;
  membros: MembroPlano[];
}

interface PreviewResponse {
  dryRun: true;
  company: string;
  fonteConfirmacao: string;
  parametros: { dias: number; windowMin: number; tipos: string[] };
  resumo: {
    gruposDuplicados: number;
    gruposComRemocao: number;
    romaneiosARemover: number;
    gruposTodosConfirmados: number;
  };
  grupos: GrupoPlano[];
}

type StatusItem = "pendente" | "processando" | "ok" | "pulado" | "erro";

interface FilaItem {
  romaneio: string;
  filial: string;
  destino: string;
  itensResumo: string;
  status: StatusItem;
  motivo?: string;
}

interface RomaneiosDuplicadosPanelProps {
  companySlug: string;
}

function authHeaders(username?: string | null): Record<string, string> {
  return username ? { "x-auth-username": username } : {};
}

function resumoItens(itens: ItemSaida[]): string {
  return itens.map((i) => `${i.produto}${i.cor ? `/${i.cor}` : ""} x${i.qtde}`).join(", ");
}

export default function RomaneiosDuplicadosPanel({ companySlug }: RomaneiosDuplicadosPanelProps) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [dias, setDias] = useState(60);
  const [windowMin, setWindowMin] = useState(15);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [fila, setFila] = useState<FilaItem[]>([]);
  const [progresso, setProgresso] = useState({ done: 0, total: 0 });

  const carregarPreview = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const params = new URLSearchParams({
        company: companySlug,
        dias: String(dias),
        windowMin: String(windowMin),
      });
      const res = await fetch(`/api/admin/transferencias-duplicadas?${params.toString()}`, {
        headers: authHeaders(username),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as Partial<PreviewResponse> & { error?: string };
      if (!res.ok) throw new Error(json.error || "Falha ao carregar duplicatas");
      setPreview(json as PreviewResponse);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar duplicatas");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [companySlug, dias, windowMin, username]);

  useEffect(() => {
    carregarPreview();
  }, [carregarPreview]);

  // Fila de remoção: só os marcados REMOVER, mais antigo primeiro (ordem mais segura —
  // processa na ordem em que os romaneios foram emitidos).
  const filaRemover = useMemo(() => {
    if (!preview) return [] as MembroPlano[];
    return preview.grupos
      .flatMap((g) => g.membros.filter((m) => m.acao === "REMOVER"))
      .sort((a, b) => a.emissaoMs - b.emissaoMs);
  }, [preview]);

  const podeExecutar = !!preview && preview.fonteConfirmacao === "neon" && filaRemover.length > 0;

  const iniciarRemocaoTotal = () => {
    if (!podeExecutar) return;
    setConfirmando(true);
  };

  const cancelarConfirmacao = () => setConfirmando(false);

  const executarFila = async () => {
    setConfirmando(false);
    setExecutando(true);
    const itens = filaRemover;
    const filaInicial: FilaItem[] = itens.map((m) => ({
      romaneio: m.romaneio,
      filial: m.origem,
      destino: m.destino,
      itensResumo: resumoItens(m.itens),
      status: "pendente",
    }));
    setFila(filaInicial);
    setProgresso({ done: 0, total: itens.length });

    // Processa UM POR VEZ, aguardando cada resposta: a API re-checa a confirmação
    // da loja a cada chamada — processar em fila (não em lote) garante que a
    // checagem seja a mais fresca possível para cada romaneio individualmente.
    for (let i = 0; i < itens.length; i++) {
      const m = itens[i];
      setFila((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "processando" } : f))
      );

      let novoStatus: StatusItem = "erro";
      let motivo: string | undefined;
      try {
        const res = await fetch("/api/admin/transferencias-duplicadas", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(username) },
          body: JSON.stringify({
            company: companySlug,
            confirm: true,
            remover: [{ romaneio: m.romaneio, filial: m.origem }],
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          removidosCount?: number;
          pulados?: Array<{ motivo: string }>;
        };
        if (!res.ok) {
          novoStatus = "erro";
          motivo = json.error || `HTTP ${res.status}`;
        } else if ((json.removidosCount ?? 0) > 0) {
          novoStatus = "ok";
        } else {
          novoStatus = "pulado";
          motivo = json.pulados?.[0]?.motivo || "não removido (confirmado ou inexistente)";
        }
      } catch (e) {
        novoStatus = "erro";
        motivo = e instanceof Error ? e.message : "erro de rede";
      }

      setFila((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: novoStatus, motivo } : f))
      );
      setProgresso({ done: i + 1, total: itens.length });
    }

    setExecutando(false);
    await carregarPreview();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarField}>
          <label htmlFor="dup-dias">Janela (dias)</label>
          <input
            id="dup-dias"
            type="number"
            min={1}
            max={365}
            value={dias}
            disabled={loading || executando}
            onChange={(e) => setDias(Math.min(365, Math.max(1, Number(e.target.value) || 60)))}
          />
        </div>
        <div className={styles.toolbarField}>
          <label htmlFor="dup-janela">Proximidade (min)</label>
          <input
            id="dup-janela"
            type="number"
            min={1}
            max={120}
            value={windowMin}
            disabled={loading || executando}
            onChange={(e) => setWindowMin(Math.min(120, Math.max(1, Number(e.target.value) || 15)))}
          />
        </div>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={carregarPreview}
          disabled={loading || executando}
        >
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {erro && <div className={styles.erroBanner}>{erro}</div>}

      {preview && preview.fonteConfirmacao !== "neon" && (
        <div className={styles.avisoBanner}>
          Confirmações de recebimento não estão disponíveis neste ambiente
          (fonte: {preview.fonteConfirmacao}). Por segurança, a remoção fica <strong>bloqueada</strong>{" "}
          — abra esta tela em produção.
        </div>
      )}

      {loading ? (
        <div className={styles.emptyState}>Carregando duplicatas...</div>
      ) : !preview ? null : preview.resumo.gruposDuplicados === 0 ? (
        <div className={styles.emptyState}>Nenhuma transferência duplicada encontrada nesta janela.</div>
      ) : (
        <>
          <div className={styles.resumoBar}>
            <span>
              <strong>{preview.resumo.gruposDuplicados}</strong> grupo(s) duplicado(s)
            </span>
            <span>
              <strong>{filaRemover.length}</strong> romaneio(s) a remover
            </span>
            {preview.resumo.gruposTodosConfirmados > 0 && (
              <span className={styles.resumoAviso}>
                {preview.resumo.gruposTodosConfirmados} grupo(s) com TODOS confirmados — revisão manual
              </span>
            )}

            {!confirmando && !executando && (
              <button
                type="button"
                className={styles.btnDanger}
                onClick={iniciarRemocaoTotal}
                disabled={!podeExecutar}
              >
                Remover todas as duplicadas ({filaRemover.length})
              </button>
            )}
          </div>

          {confirmando && (
            <div className={styles.confirmBanner}>
              <p>
                Isso vai remover <strong>{filaRemover.length}</strong> romaneio(s) duplicado(s) e devolver
                o estoque à origem de cada um — um por vez, checando de novo se a loja confirmou antes de
                cada remoção. Romaneios já confirmados pela loja nunca são removidos. <strong>Não pode ser desfeito.</strong>
              </p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.btnSecondary} onClick={cancelarConfirmacao}>
                  Cancelar
                </button>
                <button type="button" className={styles.btnDanger} onClick={executarFila}>
                  Sim, remover {filaRemover.length} duplicada(s)
                </button>
              </div>
            </div>
          )}

          {(executando || fila.length > 0) && (
            <div className={styles.filaBox}>
              <div className={styles.filaHeader}>
                {executando
                  ? `Removendo ${progresso.done}/${progresso.total}...`
                  : `Concluído: ${progresso.done}/${progresso.total}`}
              </div>
              <div className={styles.filaList}>
                {fila.map((f, i) => (
                  <div key={`${f.romaneio}-${f.filial}-${i}`} className={styles.filaRow}>
                    <span className={styles.filaRomaneio}>#{f.romaneio}</span>
                    <span className={styles.filaDestino}>{f.filial} → {f.destino || "-"}</span>
                    <span className={styles.filaItens}>{f.itensResumo}</span>
                    <span
                      className={`${styles.filaStatus} ${
                        f.status === "ok"
                          ? styles.filaStatusOk
                          : f.status === "erro"
                          ? styles.filaStatusErro
                          : f.status === "pulado"
                          ? styles.filaStatusPulado
                          : f.status === "processando"
                          ? styles.filaStatusProcessando
                          : styles.filaStatusPendente
                      }`}
                    >
                      {f.status === "ok"
                        ? "Removido"
                        : f.status === "erro"
                        ? `Erro: ${f.motivo}`
                        : f.status === "pulado"
                        ? `Ignorado: ${f.motivo}`
                        : f.status === "processando"
                        ? "Processando..."
                        : "Na fila"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.gruposList}>
            {preview.grupos.map((g) => (
              <div key={g.chave} className={styles.grupoCard}>
                <div className={styles.grupoHeader}>
                  <span className={styles.grupoRota}>
                    {g.origem} <span className={styles.grupoArrow}>→</span> {g.destino || "(sem destino)"}
                  </span>
                  <span className={styles.grupoResponsavel}>{g.responsavel || "-"}</span>
                </div>
                <div className={styles.grupoItens}>{resumoItens(g.membros[0]?.itens ?? [])}</div>
                <div className={styles.membrosTableWrap}>
                  <table className={styles.membrosTable}>
                    <thead>
                      <tr>
                        <th>Romaneio</th>
                        <th>Tipo</th>
                        <th>Emissão</th>
                        <th>Confirmado</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.membros.map((m) => (
                        <tr key={`${m.romaneio}-${m.origem}`}>
                          <td>#{m.romaneio}</td>
                          <td>{m.tipo}</td>
                          <td>{formatRomaneioDateTimeBrasilia(m.emissao)}</td>
                          <td>
                            {m.confirmado ? (
                              <span className={styles.badgeConfirmado}>Sim</span>
                            ) : (
                              <span className={styles.badgeNaoConfirmado}>Não</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={
                                m.acao === "MANTER" ? styles.badgeManter : styles.badgeRemover
                              }
                            >
                              {m.acao}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
