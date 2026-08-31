"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CompraTransitoListEntry } from "@/lib/types/compra-transito";
import {
  COMPRA_GASTO_CANAL_LABEL,
  COMPRA_GASTO_TIPO_LABEL,
  type CompraGastoCandidata,
  type CompraGastoItem,
  type CompraGastoLote,
  type CompraGastoOrigem,
  type CompraGastoParcela,
  type CompraGastoTipo,
} from "@/lib/types/compra-gasto";
import { cents } from "@/lib/utils/compra-gastos-agregacao";

import ParcelasEditor from "./ParcelasEditor";
import styles from "./GastosCompra.module.css";
import { brl, dataBr, dataBrasiliaDeIso, dataBrCompleta, money, parseMoeda } from "./gastos-compra-format";

interface Props {
  companyKey: string;
  username: string;
  /** Mês (YYYY-MM) sugerido para a data da compra. */
  mesSugerido?: string | null;
  hoje: string;
  /**
   * Ids de Compras em trânsito que já foram lançadas como compra. Ficam FORA do
   * select: lançar a mesma compra de novo duplicaria o comprometido.
   */
  comprasTransitoLancadas?: Set<string>;
  /**
   * Descrições (normalizadas) das compras já lançadas no painel. Serve para
   * avisar sobre o que veio das Compras Salvas antigas, cujo vínculo não é com
   * o trânsito e por isso escapa da trava por id.
   */
  titulosLancados?: Set<string>;
  onClose: () => void;
  onSaved: (lote: CompraGastoLote) => void;
}

interface LinhaLivre {
  descricao: string;
  produto: string;
  corProduto: string;
  qtd: string;
  custoUnitario: string;
}

const LINHA_VAZIA: LinhaLivre = { descricao: "", produto: "", corProduto: "", qtd: "", custoUnitario: "" };

const TIPOS: CompraGastoTipo[] = ["mercadoria", "frete", "adiantamento", "material", "outros"];

export default function NovaCompraModal({
  companyKey,
  username,
  mesSugerido,
  hoje,
  comprasTransitoLancadas,
  titulosLancados,
  onClose,
  onSaved,
}: Props) {
  const [origem, setOrigem] = useState<CompraGastoOrigem>("transito");

  const [transitos, setTransitos] = useState<CompraTransitoListEntry[]>([]);
  const [transitosErro, setTransitosErro] = useState<string | null>(null);
  const [carregandoTransitos, setCarregandoTransitos] = useState(false);
  const [compraTransitoId, setCompraTransitoId] = useState("");

  // Uma linha só: a próxima aparece sozinha ao digitar nesta.
  const [linhas, setLinhas] = useState<LinhaLivre[]>([{ ...LINHA_VAZIA }]);
  const [valorUnicoTexto, setValorUnicoTexto] = useState("");

  const [titulo, setTitulo] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [tipo, setTipo] = useState<CompraGastoTipo>("mercadoria");
  const [dataCompra, setDataCompra] = useState(mesSugerido ? `${mesSugerido}-15` : hoje);
  const [chegadaIni, setChegadaIni] = useState("");
  const [observacao, setObservacao] = useState("");

  /** Itens já reconhecidos da Compra em trânsito escolhida (valor exato, não o arredondado da lista). */
  const [previa, setPrevia] = useState<CompraGastoCandidata | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);

  const [parcelas, setParcelas] = useState<CompraGastoParcela[]>([]);
  const [parcelasEditadas, setParcelasEditadas] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // ───────── Compras em trânsito confirmadas ─────────
  // Uma busca por empresa, na montagem do modal — nada de guard por ref nem
  // pelos estados de carga: flag de carga nas dependências dispara o cleanup do
  // próprio efeito, e guard por ref sobrevive à remontagem do StrictMode (dev
  // roda o efeito 2x), nos dois casos matando a única resposta que ia gravar.
  useEffect(() => {
    let cancelado = false;
    setCarregandoTransitos(true);
    setTransitosErro(null);
    fetch(`/api/compras-transito?company=${companyKey}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as { data?: CompraTransitoListEntry[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? "Erro ao listar compras em trânsito");
        return j.data ?? [];
      })
      .then((lista) => {
        // Rascunho não é compra: só o que foi CONFIRMADO em trânsito (em trânsito
        // ou já recebido) é reconhecido como gasto.
        if (!cancelado) setTransitos(lista.filter((c) => c.status !== "rascunho"));
      })
      .catch((e) => {
        if (!cancelado)
          setTransitosErro(e instanceof Error ? e.message : "Erro ao listar compras em trânsito");
      })
      .finally(() => {
        if (!cancelado) setCarregandoTransitos(false);
      });
    return () => {
      cancelado = true;
    };
  }, [companyKey]);

  /**
   * Só as Compras em trânsito ainda não lançadas. A que já virou compra sai do
   * select — não existe motivo legítimo para lançar a mesma duas vezes, e o
   * risco de duplicar o comprometido do mês é real.
   */
  const disponiveis = useMemo(
    () =>
      comprasTransitoLancadas
        ? transitos.filter((c) => !comprasTransitoLancadas.has(c.id))
        : transitos,
    [transitos, comprasTransitoLancadas]
  );
  const ocultadas = transitos.length - disponiveis.length;

  const transitoSelecionado = useMemo(
    () => transitos.find((c) => c.id === compraTransitoId) ?? null,
    [transitos, compraTransitoId]
  );

  /** Já existe compra lançada com esta descrição? Suspeita, não veredicto. */
  const jaLancadaPorTitulo = useCallback(
    (title: string) => !!titulosLancados?.has(title.trim().toLowerCase().replace(/\s+/g, " ")),
    [titulosLancados]
  );

  const suspeitas = useMemo(
    () => disponiveis.filter((c) => jaLancadaPorTitulo(c.title)).length,
    [disponiveis, jaLancadaPorTitulo]
  );

  const itensDasLinhas = useMemo<CompraGastoItem[]>(
    () =>
      linhas
        .filter((l) => l.descricao.trim() || l.produto.trim())
        .map((l) => ({
          descricao: l.descricao.trim() || l.produto.trim(),
          produto: l.produto.trim() || null,
          corProduto: l.corProduto.trim() || null,
          corDescricao: null,
          qtd: parseMoeda(l.qtd) || 0,
          custoUnitario: parseMoeda(l.custoUnitario) || 0,
        })),
    [linhas]
  );

  const total = useMemo(() => {
    if (origem === "transito") return cents(previa?.total ?? transitoSelecionado?.totalValor ?? 0);
    if (origem === "itens") {
      return cents(itensDasLinhas.reduce((s, i) => s + i.qtd * i.custoUnitario, 0));
    }
    return parseMoeda(valorUnicoTexto);
  }, [origem, previa, transitoSelecionado, itensDasLinhas, valorUnicoTexto]);

  // A compra nasce INTEIRA: uma parcela de 100% na data da compra. Só quando o
  // usuário divide é que o valor sai desse mês e vai para os vencimentos novos.
  useEffect(() => {
    if (parcelasEditadas) return;
    if (total <= 0 || !dataCompra) {
      setParcelas([]);
      return;
    }
    setParcelas([
      { numero: 1, vencimento: dataCompra, valor: total, pago: false, dataPagamento: null },
    ]);
  }, [total, dataCompra, parcelasEditadas]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Escolher a Compra em trânsito já traz tudo pronto: título, data da compra
   * (o dia em que o trânsito foi confirmado), a previsão de chegada (a menor
   * data de recebimento dos itens) e os itens reconhecidos com o valor exato
   * (qtd × custo). Só o parcelamento fica para o usuário.
   */
  const escolherCompraTransito = useCallback(
    async (id: string) => {
      setCompraTransitoId(id);
      setParcelasEditadas(false);
      setPrevia(null);
      if (!id) return;

      const escolhida = transitos.find((c) => c.id === id);
      if (escolhida) {
        setTitulo(escolhida.title);
        setDataCompra(dataBrasiliaDeIso(escolhida.confirmedAt));
      }

      setCarregandoPrevia(true);
      try {
        const res = await fetch(
          `/api/compras-gastos/reconhecer?company=${companyKey}&compraTransitoId=${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as { candidata?: CompraGastoCandidata; error?: string };
        if (!res.ok || !json.candidata) {
          setErro(json.error ?? "Não foi possível ler os itens da Compra em trânsito.");
          return;
        }
        setPrevia(json.candidata);
        setTitulo(json.candidata.titulo);
        setDataCompra(json.candidata.dataCompra);
        // Sem data de recebimento não há previsão para dar: nesse caso o que o
        // usuário já digitou fica de pé em vez de ser apagado.
        if (json.candidata.previsaoChegada) setChegadaIni(json.candidata.previsaoChegada);
      } catch {
        setErro("Não foi possível ler os itens da Compra em trânsito.");
      } finally {
        setCarregandoPrevia(false);
      }
    },
    [transitos, companyKey]
  );

  const atualizarLinha = useCallback((i: number, campo: keyof LinhaLivre, valor: string) => {
    setLinhas((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [campo]: valor };
      // Mantém sempre uma linha vazia no fim para digitar a próxima.
      if (i === prev.length - 1 && valor.trim()) next.push({ ...LINHA_VAZIA });
      return next;
    });
  }, []);

  const removerLinha = useCallback((i: number) => {
    setLinhas((prev) => (prev.length <= 1 ? [{ ...LINHA_VAZIA }] : prev.filter((_, idx) => idx !== i)));
  }, []);

  const alterarParcelas = useCallback((novas: CompraGastoParcela[]) => {
    setParcelasEditadas(true);
    setParcelas(novas);
  }, []);

  async function salvar() {
    setErro(null);

    if (!titulo.trim()) {
      setErro("Descreva a compra (o que é esse gasto).");
      return;
    }
    if (origem === "transito" && !compraTransitoId) {
      setErro("Selecione a Compra em trânsito de origem.");
      return;
    }
    if (origem === "itens" && itensDasLinhas.length === 0) {
      setErro("Adicione pelo menos uma linha à compra.");
      return;
    }
    if (origem === "valor" && total <= 0) {
      setErro("Informe o valor total da compra.");
      return;
    }
    if (!parcelas.length || parcelas.some((p) => !p.vencimento)) {
      setErro("Toda parcela precisa de data de vencimento.");
      return;
    }

    setSalvando(true);
    try {
      const body: Record<string, unknown> = {
        companyKey,
        origem,
        titulo: titulo.trim(),
        fornecedor: fornecedor.trim() || null,
        tipo,
        dataCompra,
        chegadaIni: chegadaIni || null,
        observacao: observacao.trim() || null,
      };

      if (origem === "transito") {
        body.compraTransitoId = compraTransitoId;
        // Sem edição manual, o servidor divide o total exato dos itens (a lista
        // mostra o valor arredondado, e usá-lo aqui deixaria centavos sobrando).
        if (parcelasEditadas) body.parcelas = parcelas;
        else body.parcelasConfig = { quantidade: 1, primeiroVencimento: dataCompra };
      } else if (origem === "itens") {
        body.itens = itensDasLinhas;
        body.parcelas = parcelas;
      } else {
        body.valorUnico = total;
        body.parcelas = parcelas;
      }

      const res = await fetch("/api/compras-gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data?: CompraGastoLote; error?: string };
      if (!res.ok || !json.data) {
        setErro(json.error ?? "Não foi possível salvar a compra.");
        return;
      }
      onSaved(json.data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar a compra.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className={styles.overlay} onClick={onClose} role="presentation" />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Nova compra">
        <div className={styles.modalHead}>
          <div className={styles.drawerTop}>
            <div>
              <div className={styles.drawerCode}>Nova compra</div>
              <h3 className={styles.drawerTitle}>De onde vem essa compra?</h3>
            </div>
            <button type="button" className={styles.closeX} onClick={onClose} aria-label="Fechar">
              ✕
            </button>
          </div>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.originGrid} role="group" aria-label="Origem da compra">
            <button
              type="button"
              className={`${styles.origin} ${origem === "transito" ? styles.originActive : ""}`}
              aria-pressed={origem === "transito"}
              onClick={() => setOrigem("transito")}
            >
              <span className={styles.originName}>Compra em trânsito</span>
              <span className={styles.originDesc}>
                Vincula uma compra já confirmada em trânsito. Valor, itens, data e previsão de
                chegada vêm dela.
              </span>
            </button>
            <button
              type="button"
              className={`${styles.origin} ${origem === "itens" ? styles.originActive : ""}`}
              aria-pressed={origem === "itens"}
              onClick={() => setOrigem("itens")}
            >
              <span className={styles.originName}>Itens digitados</span>
              <span className={styles.originDesc}>
                Você escreve as linhas. Cada uma pode apontar para um produto — ou ser só texto.
              </span>
            </button>
            <button
              type="button"
              className={`${styles.origin} ${origem === "valor" ? styles.originActive : ""}`}
              aria-pressed={origem === "valor"}
              onClick={() => setOrigem("valor")}
            >
              <span className={styles.originName}>Só valor</span>
              <span className={styles.originDesc}>
                Uma descrição e um valor. Para adiantamento, frete, verba de coleção, serviço.
              </span>
            </button>
          </div>

          {origem === "transito" && (
            <div>
              <label className={styles.field}>
                <span>Compra em trânsito</span>
                <select
                  value={compraTransitoId}
                  onChange={(e) => void escolherCompraTransito(e.target.value)}
                  disabled={carregandoTransitos}
                >
                  <option value="">
                    {carregandoTransitos
                      ? "carregando…"
                      : transitos.length === 0
                        ? "nenhuma compra confirmada em trânsito nesta empresa"
                        : disponiveis.length === 0
                          ? "todas as compras em trânsito já foram lançadas"
                          : "selecione uma compra em trânsito"}
                  </option>
                  {disponiveis.map((c) => (
                    <option key={c.id} value={c.id}>
                      {dataBrCompleta(dataBrasiliaDeIso(c.confirmedAt))} · {c.title} — {c.itemCount}{" "}
                      itens · {brl(c.totalValor)}
                      {c.minDataRecebimento ? ` · chega ${dataBr(c.minDataRecebimento)}` : ""}
                      {c.status === "recebido" ? " · recebida" : ""}
                      {jaLancadaPorTitulo(c.title) ? " · ⚠ descrição já lançada" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {transitosErro && <p className={styles.note}>{transitosErro}</p>}
              <p className={styles.note}>
                Só aparecem compras <b>confirmadas em trânsito</b> — rascunho é lista em montagem,
                não compra.
              </p>
              {ocultadas > 0 && (
                <p className={styles.note}>
                  {ocultadas} {ocultadas === 1 ? "compra já lançada" : "compras já lançadas"}{" "}
                  {ocultadas === 1 ? "não aparece" : "não aparecem"} na lista — cada Compra em
                  trânsito entra aqui uma única vez.
                </p>
              )}
              {suspeitas > 0 && (
                <p className={styles.note}>
                  ⚠ {suspeitas}{" "}
                  {suspeitas === 1
                    ? "compra tem descrição igual à de uma compra"
                    : "compras têm descrição igual à de compras"}{" "}
                  já lançada no painel (as que entraram pela Compra Salva, antes de a fonte ser o
                  trânsito). Continuam selecionáveis porque descrição igual não é prova — confira
                  antes, para não contar o mesmo dinheiro duas vezes.
                </p>
              )}

              {carregandoPrevia && <p className={styles.note}>lendo os itens da compra…</p>}

              {previa && (
                <div className={styles.previa}>
                  <div className={styles.previaHead}>
                    <span>
                      <strong>{previa.itemCount}</strong>{" "}
                      {previa.itemCount === 1 ? "item reconhecido" : "itens reconhecidos"} ·{" "}
                      {previa.totalQuantidade.toLocaleString("pt-BR")} peças · confirmada em{" "}
                      {dataBrCompleta(previa.dataCompra)}
                      {previa.previsaoChegada
                        ? ` · chega ${dataBrCompleta(previa.previsaoChegada)}`
                        : ""}
                    </span>
                    <b>{brl(previa.total)}</b>
                  </div>
                  <div className={styles.previaItens}>
                    {previa.itens.slice(0, 6).map((item, i) => (
                      <div className={styles.previaItem} key={i}>
                        <span className={styles.previaDesc}>
                          {item.descricao}
                          {item.corDescricao ? ` · ${item.corDescricao}` : ""}
                        </span>
                        <span className={styles.previaQtd}>{item.qtd.toLocaleString("pt-BR")} un</span>
                        <span className={styles.previaValor}>
                          {item.custoUnitario > 0 ? money(item.qtd * item.custoUnitario) : "sem custo"}
                        </span>
                      </div>
                    ))}
                    {previa.itemCount > 6 && (
                      <span className={styles.note} style={{ margin: 0 }}>
                        + {previa.itemCount - 6} itens
                      </span>
                    )}
                  </div>
                  {jaLancadaPorTitulo(previa.titulo) && (
                    <p className={styles.note} style={{ margin: 0 }}>
                      ⚠ Já existe compra lançada com esta descrição. Se for a mesma compra (lançada
                      antes pela Compra Salva), não lance de novo — o comprometido do mês contaria o
                      mesmo dinheiro duas vezes.
                    </p>
                  )}
                  {previa.semCusto > 0 && (
                    <p className={styles.note} style={{ margin: 0 }}>
                      {previa.semCusto} {previa.semCusto === 1 ? "item está" : "itens estão"} sem custo
                      cadastrado — o valor acima está subestimado e a compra será marcada como
                      estimativa.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {origem === "itens" && (
            <div>
              <div className={styles.blockTitle}>Linhas da compra</div>
              <div className={styles.freeLines}>
                <div className={styles.freeLine}>
                  <span className={styles.freeLineHead}>Descrição</span>
                  <span className={styles.freeLineHead}>Produto (opcional)</span>
                  <span className={styles.freeLineHead}>Cor</span>
                  <span className={styles.freeLineHead}>Qtd × custo</span>
                  <span className={`${styles.freeLineHead} ${styles.freeLineTotal}`}>Total</span>
                  <span />
                </div>
                {linhas.map((l, i) => {
                  const totalLinha = (parseMoeda(l.qtd) || 0) * (parseMoeda(l.custoUnitario) || 0);
                  return (
                    <div className={styles.freeLine} key={i}>
                      <input
                        value={l.descricao}
                        placeholder="ex: frete rodoviário, tecido viscose…"
                        onChange={(e) => atualizarLinha(i, "descricao", e.target.value)}
                      />
                      <input
                        value={l.produto}
                        placeholder="cód. Linx"
                        onChange={(e) => atualizarLinha(i, "produto", e.target.value)}
                      />
                      <input
                        value={l.corProduto}
                        placeholder="cor"
                        onChange={(e) => atualizarLinha(i, "corProduto", e.target.value)}
                      />
                      <div style={{ display: "flex", gap: 4 }}>
                        <input
                          value={l.qtd}
                          placeholder="qtd"
                          inputMode="decimal"
                          onChange={(e) => atualizarLinha(i, "qtd", e.target.value)}
                        />
                        <input
                          value={l.custoUnitario}
                          placeholder="custo"
                          inputMode="decimal"
                          onChange={(e) => atualizarLinha(i, "custoUnitario", e.target.value)}
                        />
                      </div>
                      <span className={styles.freeLineTotal}>
                        {totalLinha > 0 ? money(totalLinha) : "—"}
                      </span>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => removerLinha(i)}
                        aria-label="Remover linha"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className={styles.note}>
                Preencher o código do produto vincula a linha ao cadastro do Linx (casa com a
                entrada de estoque). Sem código, a linha é só descrição — frete, rateio, amostra,
                serviço.
              </p>
            </div>
          )}

          {origem === "valor" && (
            <div className={styles.fieldGrid}>
              <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                <span>Descrição do gasto</span>
                <input
                  value={titulo}
                  placeholder="ex: sinal 30% Consuelo Annexe"
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Valor total</span>
                <input
                  className={styles.money}
                  value={valorUnicoTexto}
                  placeholder="0,00"
                  inputMode="decimal"
                  onChange={(e) => {
                    setValorUnicoTexto(e.target.value);
                    setParcelasEditadas(false);
                  }}
                />
              </label>
            </div>
          )}

          <div className={styles.divider} />

          <div>
            <div className={styles.blockTitle}>Identificação e datas</div>
            <div className={styles.fieldGrid}>
              {origem !== "valor" && (
                <label className={styles.field}>
                  <span>Descrição</span>
                  <input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
                </label>
              )}
              <label className={styles.field}>
                <span>Fornecedor</span>
                <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Tipo de gasto</span>
                <select value={tipo} onChange={(e) => setTipo(e.target.value as CompraGastoTipo)}>
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {COMPRA_GASTO_TIPO_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Data da compra</span>
                <input
                  type="date"
                  value={dataCompra}
                  onChange={(e) => {
                    setDataCompra(e.target.value);
                    setParcelasEditadas(false);
                  }}
                />
              </label>
              <label className={styles.field}>
                <span>Previsão de chegada</span>
                <input type="date" value={chegadaIni} onChange={(e) => setChegadaIni(e.target.value)} />
              </label>
            </div>
          </div>

          <div>
            <div className={styles.blockTitle}>Parcelamento</div>
            <p className={styles.note} style={{ margin: "0 0 10px" }}>
              Por padrão a compra vem inteira, vencendo na data da compra. Ao dividir, esse mês fica
              só com a primeira parcela e o restante vai para os meses dos novos vencimentos. Em{" "}
              <b>Tipo</b> você aplica um modelo pronto: Salete (2x, 90 e 120 dias) ou China (
              {COMPRA_GASTO_CANAL_LABEL.transferencia} 40% + {COMPRA_GASTO_CANAL_LABEL.alibaba} 60%,
              somados nas mesmas datas).
            </p>
            <ParcelasEditor
              total={total}
              parcelas={parcelas}
              onChange={alterarParcelas}
              vencimentoSugerido={dataCompra}
              rodape={
                origem === "transito" && !parcelasEditadas
                  ? "Prévia: o valor exato dos itens é confirmado ao salvar"
                  : "Soma das parcelas"
              }
            />
          </div>

          <label className={styles.field}>
            <span>Observação</span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="ex: sinal de 30% já dentro das parcelas; grade a definir"
            />
          </label>

          {erro && <div className={styles.error}>{erro}</div>}
        </div>

        <div className={styles.modalFoot}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
            onClick={onClose}
            disabled={salvando}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
            onClick={() => void salvar()}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Salvar compra"}
          </button>
        </div>
      </div>
    </>
  );
}
