"use client";

import { useEffect, useMemo, useState } from "react";

import {
  type AbaInfo,
  type AbaResposta,
  brl,
  dataHoraBr,
  inteiro,
  mesCurto,
  valorCelula,
  useFinanceiroApi,
} from "./shared";
import styles from "./ControleFinanceiro.module.css";

const ROTULO_TIPO: Record<string, string> = {
  lancamento: "Lançamentos",
  receita_linx: "Receitas Linx",
  entrada_linx: "Exportação Linx",
  entrada_atacado: "Recebíveis atacado",
  entrada_banco: "Entradas por banco",
  caixa_diario: "Caixa diário",
  budget: "Budget",
  cielo: "Cielo",
  dre: "DRE (célula a célula)",
  grade: "Grade (como na planilha)",
};

const POR_PAGINA = 100;

/** Todas as abas gravadas, linha a linha, na estrutura da planilha. */
export default function Planilha({ companyKey, abas }: { companyKey: string; abas: AbaInfo[] }) {
  const api = useFinanceiroApi(companyKey);
  const [abaSel, setAbaSel] = useState((abas.find((a) => a.totalRegistros > 0) ?? abas[0])?.aba ?? "");
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<AbaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const aba = abas.find((a) => a.aba === abaSel) ?? null;

  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(q);
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!api.pronto || !abaSel) return;
    let vivo = true;
    api
      .get<AbaResposta>("/aba", { aba: abaSel, q: busca, pagina, porPagina: POR_PAGINA })
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro"));
    return () => {
      vivo = false;
    };
  }, [api, abaSel, busca, pagina]);

  // DRE é gravada célula a célula; as outras abas seguem as colunas da planilha.
  const colunas = useMemo(() => {
    if (!aba) return [];
    if (aba.tipo === "dre") {
      return [
        { chave: "grupo", titulo: "Bloco", campo: "grupo" },
        { chave: "classificacao", titulo: "Rótulo", campo: "classificacao" },
        { chave: "mes_competencia", titulo: "Mês", campo: "mes_competencia" },
        { chave: "valor", titulo: "Valor", campo: "valor" },
        { chave: "texto", titulo: "Texto", campo: null },
      ];
    }
    return aba.colunas.map((c) => ({ chave: c.chave, titulo: c.titulo, campo: c.campo }));
  }, [aba]);

  const paginas = dados ? Math.max(1, Math.ceil(dados.total / POR_PAGINA)) : 1;

  return (
    <div className={styles.layoutAbas}>
      <nav className={styles.listaAbas} aria-label="Abas da planilha">
        {abas.map((a) => (
          <button
            key={a.aba}
            type="button"
            className={a.aba === abaSel ? styles.abaAtiva : undefined}
            onClick={() => {
              setAbaSel(a.aba);
              setPagina(1);
              setQ("");
              setBusca("");
            }}
            title={ROTULO_TIPO[a.tipo] ?? a.tipo}
          >
            <span>
              {a.aba}
              {a.oculta ? <small> · oculta</small> : null}
              {!a.presenteUltima ? <small> · não veio na última</small> : null}
            </span>
            <small>{inteiro(a.totalRegistros)}</small>
          </button>
        ))}
      </nav>

      <div className={styles.corpo}>
        {aba && (
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>
                {aba.aba} <span className={styles.cardNote}>· {ROTULO_TIPO[aba.tipo] ?? aba.tipo}</span>
              </h2>
              <span className={styles.cardNote}>
                {inteiro(aba.totalRegistros)} registros
                {aba.linhaCabecalho ? ` · cabeçalho na linha ${aba.linhaCabecalho}` : ""}
                {aba.ignoradas ? ` · ${inteiro(aba.ignoradas)} linhas de modelo sem lançamento ignoradas` : ""}
                {` · atualizada em ${dataHoraBr(aba.atualizadoEm)}`}
              </span>
            </div>
            {aba.preambulo.length > 0 && (
              <div className={styles.cardBody}>
                <div className={styles.preambulo}>
                  {aba.preambulo.slice(0, 40).map((p) => (
                    <span key={p.endereco}>
                      <code>{p.endereco}</code>
                      {valorCelula(p.valor)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.cardBody}>
              <div className={styles.filtros}>
                <input
                  className={styles.input}
                  placeholder="Buscar em qualquer coluna…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  style={{ width: 280 }}
                />
                {dados && (
                  <span className={styles.cardNote}>
                    {inteiro(dados.total)} linhas
                    {dados.soma ? ` · soma do valor ${brl(dados.soma)}` : ""}
                  </span>
                )}
              </div>
            </div>
            {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}
            {dados && (
              <>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.num}>Linha</th>
                        {colunas.map((c) => (
                          <th key={c.chave} title={c.campo ? `gravado em ${c.campo}` : "gravado em extras"}>
                            {c.titulo}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dados.itens.map((i) => (
                        <tr key={i.id}>
                          <td className={`${styles.num} ${styles.muted}`}>{i.linha}</td>
                          {colunas.map((c) => {
                            const v = c.campo ? (i.c[c.campo] ?? i.x[c.chave]) : i.x[c.chave];
                            const txt =
                              c.campo === "mes_competencia" && aba.tipo === "dre" ? mesCurto(String(v)) : valorCelula(v);
                            return (
                              <td key={c.chave} className={typeof v === "number" ? styles.num : undefined}>
                                {txt}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {!dados.itens.length && (
                        <tr>
                          <td colSpan={colunas.length + 1} className={styles.muted}>
                            Nenhuma linha.
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
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={pagina >= paginas}
                      onClick={() => setPagina(pagina + 1)}
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
