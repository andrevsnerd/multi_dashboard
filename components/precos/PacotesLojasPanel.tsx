"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthContext";

import base from "./AlterarPrecosPage.module.css";
import styles from "./ProgramarPrecosPage.module.css";

/**
 * Aba "Pacotes nas lojas" (Alterar Custo / Preço e Programar Preços): a mudança de um
 * lote (ou de uma lista de códigos) já chegou em cada loja? Lógica e fontes do Linx em
 * lib/repositories/pacotesLojas.ts.
 */

type StatusLoja = "entregue" | "aguardando" | "fila" | "nao-vai";

interface Analise {
  geradoEm: string;
  lote: string | null;
  loteData: string | null;
  produtos: Array<{ produto: string; descricao: string; vaiParaLoja: boolean; motivo: string | null; naFila: boolean }>;
  naoEncontrados: string[];
  lojas: Array<{
    codigo: string;
    loja: string;
    ultimaComunicacao: string | null;
    pacotesPendentes: number;
    pendenteDesde: string | null;
    aguardando: string[];
    status: StatusLoja;
  }>;
}

interface Props {
  companyKey: "nerd" | "scarfme";
  titulo: string;
  abas?: ReactNode;
  /** Lote vindo de outra aba ("Pacotes" numa tarefa aplicada); muda `pedido` para analisar de novo. */
  loteInicial?: string | null;
  pedido?: number;
}

const STATUS: Record<StatusLoja, { texto: string; classe: string }> = {
  entregue: { texto: "Entregue", classe: styles.statusAplicada },
  aguardando: { texto: "Aguardando a loja baixar", classe: styles.statusAgendada },
  fila: { texto: "Na fila do Linx", classe: styles.statusPendente },
  "nao-vai": { texto: "Não vai para loja", classe: styles.statusErro },
};

/** 'yyyy-MM-ddTHH:mm:ss' (relógio de Brasília gravado pelo Linx) → 'dd/MM HH:mm'. */
function relogio(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : iso;
}

export default function PacotesLojasPanel({ companyKey, titulo, abas, loteInicial, pedido }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [lote, setLote] = useState(loteInicial ?? "");
  const [codigos, setCodigos] = useState("");
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const analisar = useCallback(
    async (loteAlvo: string, textoCodigos: string) => {
      if (!username) return;
      const loteLimpo = loteAlvo.trim();
      const lista = textoCodigos.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);
      if (!loteLimpo && lista.length === 0) {
        setErro("Informe um lote ou cole os códigos.");
        return;
      }
      setCarregando(true);
      setErro(null);
      try {
        const res = await fetch("/api/precos/pacotes", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ company: companyKey, lote: loteLimpo || null, codigos: loteLimpo ? [] : lista }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao analisar os pacotes.");
        setAnalise(json as Analise);
      } catch (e) {
        setAnalise(null);
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setCarregando(false);
      }
    },
    [username, companyKey]
  );

  // Veio um lote de outra aba: preenche e já analisa.
  useEffect(() => {
    if (!loteInicial || !username) return;
    setLote(loteInicial);
    setCodigos("");
    void analisar(loteInicial, "");
  }, [loteInicial, pedido, username, analisar]);

  const comEnvio = analise?.produtos.filter((p) => p.vaiParaLoja).length ?? 0;
  const entregues = analise?.lojas.filter((l) => l.status === "entregue").length ?? 0;

  return (
    <div className={base.wrapper}>
      <header className={base.header}>
        <h1 className={base.title}>{titulo}</h1>
        {abas}
      </header>

      <section className={base.card}>
        <h2 className={base.cardTitle}>Pacotes nas lojas</h2>
        <p className={base.dica}>
          Depois de uma alteração, o Linx põe o produto na fila, monta um pacote para cada loja (~5 min) e apaga o
          pacote quando a loja baixa. Informe o lote (do histórico) ou os códigos e veja loja a loja se já chegou.
        </p>
        <div className={styles.linhaCampos}>
          <label className={base.campoTexto}>
            <span className={base.campoLabel}>Lote</span>
            <input
              className={base.input}
              value={lote}
              onChange={(e) => setLote(e.target.value)}
              placeholder="ex.: PRC202611121907447HZSJD"
            />
          </label>
        </div>
        <label className={base.campoTexto}>
          <span className={base.campoLabel}>ou códigos de produto / de barras (um por linha; vale quando o lote está vazio)</span>
          <textarea
            className={base.textarea}
            rows={3}
            value={codigos}
            onChange={(e) => setCodigos(e.target.value)}
            placeholder={"07.A1.00B3\n042396"}
          />
        </label>
        <div className={base.acoes}>
          <span className={base.dica}>
            {analise ? `Analisado às ${new Date(analise.geradoEm).toLocaleTimeString("pt-BR")}` : ""}
          </span>
          <button
            type="button"
            className={base.btnPrimario}
            disabled={carregando}
            onClick={() => void analisar(lote, codigos)}
          >
            {carregando ? "Analisando…" : "Analisar pacotes"}
          </button>
        </div>
      </section>

      {erro && <div className={base.erroBox}>{erro}</div>}

      {analise && (
        <>
          <section className={base.card}>
            <div className={base.resumoLinha}>
              {analise.lote && (
                <>
                  Lote <code className={base.lote}>{analise.lote}</code> gravado em {relogio(analise.loteData)} ·
                </>
              )}
              <strong>{analise.produtos.length}</strong> produto(s) ·
              {comEnvio > 0 ? (
                <>
                  <strong>
                    {entregues} de {analise.lojas.length}
                  </strong>{" "}
                  loja(s) já receberam
                </>
              ) : (
                <> nenhum produto vai para loja</>
              )}
            </div>
            {analise.naoEncontrados.length > 0 && (
              <p className={base.textoErro}>Não encontrados: {analise.naoEncontrados.join(", ")}.</p>
            )}

            <div className={base.tabelaWrap}>
              <table className={base.tabelaFicha}>
                <thead>
                  <tr>
                    <th>Loja</th>
                    <th>Situação</th>
                    <th>Última comunicação</th>
                    <th className={base.thNum}>Pacotes pendentes</th>
                    <th>Pendente desde</th>
                    <th>Produtos esperando</th>
                  </tr>
                </thead>
                <tbody>
                  {analise.lojas.map((l) => (
                    <tr key={l.codigo}>
                      <td>
                        {l.loja} <span className={base.tdMetaSub}>{l.codigo}</span>
                      </td>
                      <td>
                        <span className={`${styles.status} ${STATUS[l.status].classe}`}>{STATUS[l.status].texto}</span>
                      </td>
                      <td>{relogio(l.ultimaComunicacao)}</td>
                      <td className={base.thNum}>{l.pacotesPendentes}</td>
                      <td>{relogio(l.pendenteDesde)}</td>
                      <td className={base.tdDesc} title={l.aguardando.join(", ")}>
                        {l.aguardando.length === 0
                          ? "—"
                          : l.aguardando.length === comEnvio
                            ? `todos (${l.aguardando.length})`
                            : l.aguardando.join(", ")}
                      </td>
                    </tr>
                  ))}
                  {analise.lojas.length === 0 && (
                    <tr>
                      <td colSpan={6} className={base.dica}>
                        Nenhuma loja da empresa se comunicou com o Linx nos últimos 30 dias.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className={base.dica}>
              &quot;Entregue&quot; = não sobrou fila nem pacote pendente com esses produtos para a loja (pacote baixado é
              apagado do servidor). A última comunicação nem sempre acompanha cada download. Só aparecem lojas que
              falaram com o Linx nos últimos 30 dias.
            </p>
          </section>

          <section className={base.card}>
            <h2 className={base.cardTitle}>Produtos</h2>
            <div className={base.tabelaWrap}>
              <table className={base.tabelaFicha}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Descrição</th>
                    <th>Vai para loja?</th>
                    <th>Fila do Linx</th>
                  </tr>
                </thead>
                <tbody>
                  {analise.produtos.map((p) => (
                    <tr key={p.produto}>
                      <td className={base.tdCodigo}>{p.produto}</td>
                      <td className={base.tdDesc}>{p.descricao}</td>
                      <td>{p.vaiParaLoja ? "sim" : <span className={base.textoErro}>não — {p.motivo}</span>}</td>
                      <td>{p.naFila ? "ainda na fila (não empacotado)" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
