"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  appendItemFilters,
  type PresentationItemFilters,
} from "@/lib/presentations/item-filters";

import type { VendaColecaoRow } from "@/lib/repositories/colecaoPresentation";

import styles from "./ColecaoExclusaoVendas.module.css";

/**
 * "Tirar vendas do relatório" do Relatório Completo de Coleção.
 *
 * Lista as vendas da coleção linha a linha (ticket/NF × produto × cor × tamanho),
 * no mesmo escopo do deck, e o usuário marca o que sai. Dá para marcar à mão ou
 * colando uma lista "produto; cor; qtd; data" — a lista só MARCA linhas da prévia,
 * então o que sai é sempre uma venda que existe, nunca um número digitado.
 *
 * O componente só guarda a lista e a UI; as chaves marcadas ficam com a página,
 * que as manda no POST /colecao (`excluirVendas`).
 */

interface ColecaoExclusaoVendasProps {
  companyKey: string;
  filial: string | null;
  colecoes: string[];
  /** Recorte da coleção pelo cadastro — a lista mostra só as vendas do recorte. */
  filtros?: PresentationItemFilters;
  start: string;
  end: string;
  excluidas: string[];
  onChange: (keys: string[]) => void;
}

/** '06' ≡ '6' (as fontes divergem no formato do código de cor). */
function normalizeCor(value: string): string {
  const t = (value ?? "").trim();
  if (t === "") return "";
  return /^\d+$/.test(t) ? String(Number(t)) : t.toUpperCase();
}

/** Comparação sem acento e sem caixa. */
function fold(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/** "05/09/2026", "5/9/26" ou "2026-09-05" → "2026-09-05"; inválida → null. */
function parseData(value: string): string | null {
  const t = value.trim();
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const partes = iso
    ? { ano: iso[1], mes: iso[2], dia: iso[3] }
    : br
      ? { ano: br[3].length === 2 ? `20${br[3]}` : br[3], mes: br[2], dia: br[1] }
      : null;
  if (!partes) return null;
  const [ano, mes, dia] = [Number(partes.ano), Number(partes.mes), Number(partes.dia)];
  const d = new Date(ano, mes - 1, dia);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return `${partes.ano}-${partes.mes.padStart(2, "0")}-${partes.dia.padStart(2, "0")}`;
}

function fmtData(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function fmtMoeda(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface ResultadoLista {
  marcadas: number;
  problemas: string[];
}

/**
 * Código de barra sem zeros à esquerda: o Excel tira o zero de um código numérico
 * ao colar, então "0789…" e "789…" têm que ser o mesmo código.
 */
function barraKey(value: string): string {
  return (value ?? "").trim().replace(/^0+/, "");
}

/**
 * Casa as linhas coladas com as vendas da prévia.
 *
 * Colunas: produto; cor; qtd; data; [ticket/NF] — separadas por TAB (colar do
 * Excel) ou ";". Cor aceita código ('6' ≡ '06') ou descrição; cor, data e
 * documento vazios valem "qualquer".
 *
 * A 1ª coluna também pode ser o CÓDIGO DE BARRA: ele já diz produto, cor e (na
 * loja) tamanho, então a cor some — `barra; qtd; data; [ticket/NF]`. A forma longa
 * (`barra; cor; qtd; data`) também é aceita, e a cor é ignorada. A quantidade escolhe QUAIS linhas saem:
 * primeiro uma venda com exatamente aquela quantidade; senão um conjunto de vendas
 * do mesmo produto/cor/dia que some exatamente a quantidade. Se não fechar, a linha
 * não marca nada e vira aviso — tirar "mais ou menos" daria um relatório errado.
 */
function casarLista(texto: string, vendas: VendaColecaoRow[], jaMarcadas: Set<string>) {
  const novas = new Set(jaMarcadas);
  const resultado: ResultadoLista = { marcadas: 0, problemas: [] };

  const barrasConhecidas = new Set(vendas.flatMap((v) => v.codigosBarra.map(barraKey)));

  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  linhas.forEach((linha, idx) => {
    const cols = linha.split(/\t|;/).map((c) => c.trim());
    const rotulo = `Linha ${idx + 1} (${linha})`;
    if (!cols[0]) return;

    // Código de barra na 1ª coluna? Forma curta quando a 3ª coluna é data (ou não há).
    const barra = barrasConhecidas.has(barraKey(cols[0])) ? barraKey(cols[0]) : null;
    const formaCurta =
      barra !== null && (cols.length <= 2 || cols[2] === "" || parseData(cols[2]) !== null);
    const [produtoIn = "", corIn = "", qtdIn = "", dataIn = "", docIn = ""] = formaCurta
      ? [cols[0], "", cols[1] ?? "", cols[2] ?? "", cols[3] ?? ""]
      : cols;

    const qtdTxt = qtdIn.replace(",", ".");
    const qtd = qtdTxt === "" ? null : Number(qtdTxt);
    // Cabeçalho ("produto; cor; qtd; data") ou linha sem número na quantidade.
    if (qtd !== null && !Number.isFinite(qtd)) {
      if (idx === 0) return;
      resultado.problemas.push(`${rotulo}: quantidade “${qtdIn}” não é um número.`);
      return;
    }
    const data = dataIn ? parseData(dataIn) : null;
    if (dataIn && !data) {
      resultado.problemas.push(`${rotulo}: data “${dataIn}” não reconhecida (use dd/mm/aaaa).`);
      return;
    }

    const produto = fold(produtoIn);
    const corCode = normalizeCor(corIn);
    const corDesc = fold(corIn);
    const candidatas = vendas.filter(
      (v) =>
        !novas.has(v.key) &&
        (barra !== null
          ? v.codigosBarra.some((c) => barraKey(c) === barra)
          : fold(v.produto) === produto &&
            (!corIn || normalizeCor(v.cor) === corCode || fold(v.corDescricao) === corDesc)) &&
        (!data || v.data === data) &&
        (!docIn || fold(v.documento).replace(/^0+/, "") === fold(docIn).replace(/^0+/, ""))
    );

    if (candidatas.length === 0) {
      resultado.problemas.push(`${rotulo}: nenhuma venda (ainda não marcada) com esses dados.`);
      return;
    }

    let escolhidas: VendaColecaoRow[] = [];
    if (qtd === null) {
      escolhidas = candidatas;
    } else {
      const exata = candidatas.find((c) => c.qtd === qtd);
      if (exata) {
        escolhidas = [exata];
      } else {
        let soma = 0;
        for (const c of [...candidatas].sort((a, b) => b.qtd - a.qtd)) {
          if (c.qtd > 0 && soma + c.qtd <= qtd) {
            escolhidas.push(c);
            soma += c.qtd;
          }
          if (soma === qtd) break;
        }
        if (soma !== qtd) {
          const total = candidatas.reduce((s, c) => s + c.qtd, 0);
          resultado.problemas.push(
            `${rotulo}: a quantidade ${qtd} não fecha com as vendas encontradas ` +
              `(${candidatas.length} venda(s), ${total} peça(s)). Marque à mão na lista.`
          );
          return;
        }
      }
    }

    escolhidas.forEach((c) => novas.add(c.key));
    resultado.marcadas += escolhidas.length;
  });

  return { novas, resultado };
}

export default function ColecaoExclusaoVendas({
  companyKey,
  filial,
  colecoes,
  filtros,
  start,
  end,
  excluidas,
  onChange,
}: ColecaoExclusaoVendasProps) {
  const [vendas, setVendas] = useState<VendaColecaoRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [soMarcadas, setSoMarcadas] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultadoLista, setResultadoLista] = useState<ResultadoLista | null>(null);

  // Escopo mudou (coleção, recorte, período, filial) → a lista e as marcações não
  // valem mais: a chave de cada venda depende da loja e do dia.
  const filtrosKey = JSON.stringify(filtros ?? {});
  const escopoKey = `${companyKey}|${filial ?? ""}|${colecoes.join(",")}|${filtrosKey}|${start}|${end}`;
  useEffect(() => {
    setVendas(null);
    setErro(null);
    setResultadoLista(null);
    onChange([]);
    // onChange vem da página (setState estável); só o escopo dispara o reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopoKey]);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ company: companyKey, start, end });
      if (filial) params.set("filial", filial);
      colecoes.forEach((c) => params.append("colecao", c));
      appendItemFilters(params, filtros);
      const res = await fetch(`/api/gerador-apresentacoes/colecao-vendas?${params}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { data?: VendaColecaoRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Erro ao listar as vendas.");
      setVendas(json.data ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao listar as vendas.");
      setVendas(null);
    } finally {
      setLoading(false);
    }
  }, [companyKey, filial, colecoes, filtros, start, end]);

  const marcadasSet = useMemo(() => new Set(excluidas), [excluidas]);

  const visiveis = useMemo(() => {
    if (!vendas) return [];
    const termo = fold(busca);
    return vendas.filter((v) => {
      if (soMarcadas && !marcadasSet.has(v.key)) return false;
      if (!termo) return true;
      const alvo = fold(
        `${v.produto} ${v.nome} ${v.cor} ${v.corDescricao} ${v.loja} ${v.documento} ${fmtData(v.data)}`
      );
      // Código de barra casa sem os zeros à esquerda (o Excel os tira).
      const barras = v.codigosBarra.map(barraKey);
      return termo.split(" ").every((p) => {
        const pBarra = barraKey(p);
        return alvo.includes(p) || (pBarra !== "" && barras.some((c) => c.includes(pBarra)));
      });
    });
  }, [vendas, busca, soMarcadas, marcadasSet]);

  const resumo = useMemo(() => {
    const sel = (vendas ?? []).filter((v) => marcadasSet.has(v.key));
    return {
      linhas: sel.length,
      qtd: sel.reduce((s, v) => s + v.qtd, 0),
      valor: sel.reduce((s, v) => s + v.valor, 0),
    };
  }, [vendas, marcadasSet]);

  const totalGeral = useMemo(
    () => (vendas ?? []).reduce((s, v) => s + v.valor, 0),
    [vendas]
  );

  const toggle = (key: string) => {
    onChange(marcadasSet.has(key) ? excluidas.filter((k) => k !== key) : [...excluidas, key]);
  };

  const todasVisiveisMarcadas = visiveis.length > 0 && visiveis.every((v) => marcadasSet.has(v.key));
  const toggleVisiveis = () => {
    const keys = new Set(excluidas);
    if (todasVisiveisMarcadas) visiveis.forEach((v) => keys.delete(v.key));
    else visiveis.forEach((v) => keys.add(v.key));
    onChange(Array.from(keys));
  };

  const aplicarLista = () => {
    if (!vendas) return;
    const { novas, resultado } = casarLista(texto, vendas, marcadasSet);
    onChange(Array.from(novas));
    setResultadoLista(resultado);
  };

  const semColecao = colecoes.length === 0;

  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <span className={styles.title}>Tirar vendas do relatório (opcional)</span>
        <span className={styles.sub}>
          Carregue as vendas da coleção no período e marque as que não devem entrar. Elas saem de
          tudo no deck: faturamento, peças, produtos, lojas e destaque.
        </span>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btn}
          onClick={() => void carregar()}
          disabled={loading || semColecao}
        >
          {loading ? "Carregando vendas..." : vendas ? "Recarregar vendas" : "Carregar vendas da coleção"}
        </button>
        {semColecao && <span className={styles.hint}>Selecione a coleção primeiro.</span>}
        {excluidas.length > 0 && (
          <>
            <span className={styles.resumo}>
              {resumo.linhas} venda(s) marcada(s) para tirar · {resumo.qtd.toLocaleString("pt-BR")}{" "}
              peça(s) · {fmtMoeda(resumo.valor)}
            </span>
            <button type="button" className={styles.linkBtn} onClick={() => onChange([])}>
              Limpar seleção
            </button>
          </>
        )}
      </div>

      {erro && <p className={styles.erro}>{erro}</p>}

      {vendas && (
        <>
          <div className={styles.colar}>
            <label className={styles.label} htmlFor="colecao-excluir-lista">
              Colar lista para marcar — uma venda por linha: <code>produto; cor; qtd; data</code> ou{" "}
              <code>código de barra; qtd; data</code> (ticket/NF opcional na última coluna; pode colar
              direto do Excel)
            </label>
            <textarea
              id="colecao-excluir-lista"
              className={styles.textarea}
              rows={4}
              value={texto}
              placeholder={
                "07.06.0002; 06; 2; 15/09/2026\n07.06.0002; PRETO; 1; 16/09/2026; 00012345\n7891234567890; 1; 17/09/2026"
              }
              onChange={(e) => setTexto(e.target.value)}
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                onClick={aplicarLista}
                disabled={!texto.trim()}
              >
                Marcar da lista
              </button>
              {resultadoLista && (
                <span className={styles.hint}>
                  {resultadoLista.marcadas} venda(s) marcada(s) pela lista
                  {resultadoLista.problemas.length > 0
                    ? ` · ${resultadoLista.problemas.length} linha(s) não casaram:`
                    : "."}
                </span>
              )}
            </div>
            {resultadoLista && resultadoLista.problemas.length > 0 && (
              <ul className={styles.problemas}>
                {resultadoLista.problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.actions}>
            <input
              className={styles.input}
              value={busca}
              placeholder="Filtrar por produto, código de barra, cor, loja, ticket ou data"
              onChange={(e) => setBusca(e.target.value)}
            />
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={soMarcadas}
                onChange={(e) => setSoMarcadas(e.target.checked)}
              />
              Só as marcadas
            </label>
            <span className={styles.hint}>
              {visiveis.length.toLocaleString("pt-BR")} de {vendas.length.toLocaleString("pt-BR")}{" "}
              venda(s) · total da coleção {fmtMoeda(totalGeral)}
            </span>
          </div>

          {vendas.length === 0 ? (
            <p className={styles.hint}>Nenhuma venda da coleção no período/filial selecionados.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.cCheck}>
                      <input
                        type="checkbox"
                        checked={todasVisiveisMarcadas}
                        onChange={toggleVisiveis}
                        title="Marcar/desmarcar todas as vendas visíveis"
                      />
                    </th>
                    <th>Data</th>
                    <th>Loja</th>
                    <th>Ticket/NF</th>
                    <th>Produto</th>
                    <th>Cor</th>
                    <th>Tam.</th>
                    <th>Cód. barra</th>
                    <th className={styles.num}>Qtd</th>
                    <th className={styles.num}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((v) => {
                    const on = marcadasSet.has(v.key);
                    return (
                      <tr
                        key={v.key}
                        className={`${on ? styles.rowOn : ""} ${v.qtd < 0 ? styles.rowTroca : ""}`}
                        onClick={() => toggle(v.key)}
                      >
                        <td className={styles.cCheck}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(v.key)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td>{fmtData(v.data)}</td>
                        <td>{v.loja}</td>
                        <td>{v.documento}</td>
                        <td>
                          <span className={styles.code}>{v.produto}</span> {v.nome}
                        </td>
                        <td>
                          {v.corDescricao || v.cor}
                          {v.corDescricao && <span className={styles.code}> {v.cor}</span>}
                        </td>
                        <td>{v.tamanho}</td>
                        {/* O 1º é o bipado no caixa (loja) ou o menor da cor; os outros
                            códigos da mesma variação ficam no tooltip e também filtram. */}
                        <td title={v.codigosBarra.join("\n")}>
                          {v.codigosBarra[0] ?? ""}
                          {v.codigosBarra.length > 1 && (
                            <span className={styles.code}> +{v.codigosBarra.length - 1}</span>
                          )}
                        </td>
                        <td className={styles.num}>{v.qtd.toLocaleString("pt-BR")}</td>
                        <td className={styles.num}>{fmtMoeda(v.valor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.hint}>
            Linhas em vermelho são trocas/devoluções (quantidade negativa) — já abatem o
            faturamento; tirar uma delas devolve o valor ao relatório. As vendas vêm da mesma
            regra de faturamento do deck (venda líquida com trocas), então o deck sai exatamente
            com o total acima menos o marcado. Mudar coleção, período ou filial limpa a seleção.
          </p>
        </>
      )}
    </div>
  );
}
