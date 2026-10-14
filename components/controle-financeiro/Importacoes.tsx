"use client";

import { useEffect, useState } from "react";

import { ROTULO_CAMPO, type Campo } from "@/lib/financeiro/planilha";

import {
  type ImportacaoInfo,
  type ResumoImportacao,
  dataHoraBr,
  inteiro,
  valorCelula,
  useFinanceiroApi,
} from "./shared";
import styles from "./ControleFinanceiro.module.css";

interface Alteracao {
  id: number;
  aba: string;
  acao: "novo" | "alterado" | "removido";
  linha: number | null;
  base: string;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  campos: { campo: string; antes: unknown; depois: unknown }[];
}

const rotuloCampo = (c: string) => ROTULO_CAMPO[c as Campo] ?? c;

/** Resumo legível de um registro: descrição/rótulo, datas e valor. */
function resumoRegistro(r: Record<string, unknown> | null): string {
  if (!r) return "";
  const partes = [
    r.descricao ?? r.cliente ?? r.classificacao,
    r.classificacao && r.descricao ? r.classificacao : null,
    r.data_competencia ?? r.mes_competencia ?? r.data_caixa,
    r.valor,
  ].filter((p) => p != null && p !== "");
  if (!partes.length && r.extras) {
    return Object.entries(r.extras as Record<string, unknown>)
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${valorCelula(v)}`)
      .join(" · ");
  }
  return partes.map((p) => valorCelula(p)).join(" · ");
}

export function TabelaResumo({ resumo }: { resumo: ResumoImportacao }) {
  const linhas = resumo.abas.filter((a) => a.noArquivo || a.vigentes);
  return (
    <div className={styles.tableScroll} style={{ maxHeight: 340 }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Aba</th>
            <th className={styles.num}>No arquivo</th>
            <th className={styles.num}>Sem mudança</th>
            <th className={styles.num}>Novos</th>
            <th className={styles.num}>Alterados</th>
            <th className={styles.num}>Removidos</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((a) => (
            <tr key={a.aba}>
              <td>{a.aba}</td>
              <td className={styles.num}>{inteiro(a.noArquivo)}</td>
              <td className={`${styles.num} ${styles.muted}`}>{inteiro(a.iguais)}</td>
              <td className={styles.num}>{a.novos ? <b className={styles.good}>{inteiro(a.novos)}</b> : "—"}</td>
              <td className={styles.num}>{a.alterados ? <b className={styles.warn}>{inteiro(a.alterados)}</b> : "—"}</td>
              <td className={styles.num}>{a.removidos ? <b className={styles.crit}>{inteiro(a.removidos)}</b> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Diferencas({ campos }: { campos: { campo: string; antes: unknown; depois: unknown }[] }) {
  return (
    <div className={styles.diff}>
      {campos.map((c) => (
        <span key={c.campo}>
          {rotuloCampo(c.campo)}: <span className={styles.diffAntes}>{valorCelula(c.antes) || "vazio"}</span> →{" "}
          <span className={styles.diffDepois}>{valorCelula(c.depois) || "vazio"}</span>
        </span>
      ))}
    </div>
  );
}

const STATUS: Record<string, string> = {
  aplicada: "Aplicada",
  analisada: "Aguardando confirmação",
  enviando: "Enviando",
  descartada: "Descartada",
};

export default function Importacoes({ companyKey, versao }: { companyKey: string; versao: number }) {
  const api = useFinanceiroApi(companyKey);
  const [lista, setLista] = useState<ImportacaoInfo[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [acao, setAcao] = useState("");
  const [aba, setAba] = useState("");
  const [pagina, setPagina] = useState(1);
  const [det, setDet] = useState<{ importacao: ImportacaoInfo; alteracoes: { total: number; itens: Alteracao[] } } | null>(
    null
  );
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!api.pronto) return;
    api
      .get<{ importacoes: ImportacaoInfo[] }>("/importacoes")
      .then((r) => {
        setLista(r.importacoes);
        setSel((s) => s ?? r.importacoes.find((i) => i.status === "aplicada")?.id ?? null);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro"));
  }, [api, versao]);

  useEffect(() => {
    if (!api.pronto || sel == null) return;
    let vivo = true;
    api
      .get<typeof det>(`/importacoes/${sel}`, { acao, aba, pagina, porPagina: 50 })
      .then((d) => vivo && setDet(d))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro"));
    return () => {
      vivo = false;
    };
  }, [api, sel, acao, aba, pagina]);

  if (erro) return <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>;
  if (!lista) return <div className={styles.aviso}>Carregando importações…</div>;

  const resumo = det?.importacao.resumo ?? null;
  const paginas = det ? Math.max(1, Math.ceil(det.alteracoes.total / 50)) : 1;

  return (
    <div className={styles.corpo}>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Arquivos importados</h2>
          <span className={styles.cardNote}>cada importação substitui a base pelo conteúdo do arquivo; o que mudou fica registrado aqui</span>
        </div>
        <div className={styles.tableScroll} style={{ maxHeight: 300 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Arquivo</th>
                <th>Por</th>
                <th>Status</th>
                <th className={styles.num}>Novos</th>
                <th className={styles.num}>Alterados</th>
                <th className={styles.num}>Removidos</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr
                  key={i.id}
                  className={styles.rowClick}
                  onClick={() => {
                    setSel(i.id);
                    setPagina(1);
                    setAba("");
                    setAcao("");
                  }}
                  style={i.id === sel ? { background: "var(--cf-wash)" } : undefined}
                >
                  <td className={styles.nowrap}>{dataHoraBr(i.aplicadoEm ?? i.criadoEm)}</td>
                  <td>{i.arquivo}</td>
                  <td>{i.aplicadoPor ?? i.enviadoPor}</td>
                  <td>{STATUS[i.status] ?? i.status}</td>
                  <td className={styles.num}>{inteiro(i.resumo?.totais.novos)}</td>
                  <td className={styles.num}>{inteiro(i.resumo?.totais.alterados)}</td>
                  <td className={styles.num}>{inteiro(i.resumo?.totais.removidos)}</td>
                </tr>
              ))}
              {!lista.length && (
                <tr>
                  <td colSpan={7} className={styles.muted}>
                    Nenhuma importação ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {det && resumo && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>
              {det.importacao.arquivo} · {dataHoraBr(det.importacao.aplicadoEm ?? det.importacao.criadoEm)}
            </h2>
            <span className={styles.cardNote}>
              {resumo.cargaInicial ? "carga inicial — tudo entrou como novo, sem detalhe por registro" : ""}
            </span>
          </div>
          <div className={styles.cardBody}>
            <TabelaResumo resumo={resumo} />
            {resumo.ausentes.length > 0 && (
              <p className={styles.cardNote}>Abas que não vieram no arquivo (mantidas como estavam): {resumo.ausentes.join(", ")}</p>
            )}
          </div>
          {!resumo.cargaInicial && (
            <>
              <div className={styles.cardBody}>
                <div className={styles.filtros}>
                  <select className={styles.select} value={acao} onChange={(e) => (setAcao(e.target.value), setPagina(1))}>
                    <option value="">Todas as mudanças</option>
                    <option value="novo">Novos</option>
                    <option value="alterado">Alterados</option>
                    <option value="removido">Removidos</option>
                  </select>
                  <select className={styles.select} value={aba} onChange={(e) => (setAba(e.target.value), setPagina(1))}>
                    <option value="">Todas as abas</option>
                    {resumo.abas
                      .filter((a) => a.novos || a.alterados || a.removidos)
                      .map((a) => (
                        <option key={a.aba} value={a.aba}>
                          {a.aba}
                        </option>
                      ))}
                  </select>
                  <span className={styles.cardNote}>{inteiro(det.alteracoes.total)} registros</span>
                </div>
              </div>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Mudança</th>
                      <th>Aba</th>
                      <th className={styles.num}>Linha</th>
                      <th>Registro</th>
                      <th>O que mudou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {det.alteracoes.itens.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <span
                            className={`${styles.pill} ${
                              a.acao === "novo" ? styles.pillNovo : a.acao === "alterado" ? styles.pillAlterado : styles.pillRemovido
                            }`}
                          >
                            {a.acao}
                          </span>
                        </td>
                        <td className={styles.nowrap}>{a.aba}</td>
                        <td className={styles.num}>{a.linha ?? "—"}</td>
                        <td className={styles.desc}>{resumoRegistro(a.depois ?? a.antes)}</td>
                        <td>{a.acao === "alterado" ? <Diferencas campos={a.campos} /> : <span className={styles.muted}>—</span>}</td>
                      </tr>
                    ))}
                    {!det.alteracoes.itens.length && (
                      <tr>
                        <td colSpan={5} className={styles.muted}>
                          Nenhuma mudança registrada.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className={styles.paginacao}>
                <span>
                  página {pagina} de {inteiro(paginas)}
                </span>
                <div>
                  <button type="button" className={styles.btn} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                    Anterior
                  </button>
                  <button type="button" className={styles.btn} disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
                    Próxima
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
