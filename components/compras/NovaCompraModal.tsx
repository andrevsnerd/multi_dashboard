"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CompraSalvaListEntry } from "@/lib/types/compra-salva";
import {
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
import { brl, dataBrasiliaDeIso, dataBrCompleta, money, parseMoeda } from "./gastos-compra-format";

interface Props {
  companyKey: string;
  username: string;
  /** Mês (YYYY-MM) sugerido para a data da compra. */
  mesSugerido?: string | null;
  hoje: string;
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
  onClose,
  onSaved,
}: Props) {
  const [origem, setOrigem] = useState<CompraGastoOrigem>("salva");

  const [salvas, setSalvas] = useState<CompraSalvaListEntry[]>([]);
  const [salvasErro, setSalvasErro] = useState<string | null>(null);
  const [carregandoSalvas, setCarregandoSalvas] = useState(false);
  const [compraSalvaId, setCompraSalvaId] = useState("");

  // Uma linha só: a próxima aparece sozinha ao digitar nesta.
  const [linhas, setLinhas] = useState<LinhaLivre[]>([{ ...LINHA_VAZIA }]);
  const [valorUnicoTexto, setValorUnicoTexto] = useState("");

  const [titulo, setTitulo] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [tipo, setTipo] = useState<CompraGastoTipo>("mercadoria");
  const [dataCompra, setDataCompra] = useState(mesSugerido ? `${mesSugerido}-15` : hoje);
  const [chegadaIni, setChegadaIni] = useState("");
  const [observacao, setObservacao] = useState("");

  /** Itens já reconhecidos da Compra Salva escolhida (valor exato, não o arredondado da lista). */
  const [previa, setPrevia] = useState<CompraGastoCandidata | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);

  const [parcelas, setParcelas] = useState<CompraGastoParcela[]>([]);
  const [parcelasEditadas, setParcelasEditadas] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // ───────── Compras Salvas disponíveis ─────────
  // Uma busca por empresa, na montagem do modal — nada de guard por ref nem
  // pelos estados de carga: flag de carga nas dependências dispara o cleanup do
  // próprio efeito, e guard por ref sobrevive à remontagem do StrictMode (dev
  // roda o efeito 2x), nos dois casos matando a única resposta que ia gravar.
  useEffect(() => {
    let cancelado = false;
    setCarregandoSalvas(true);
    setSalvasErro(null);
    fetch(`/api/controle-estoque/compras-salvas?company=${companyKey}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as { data?: CompraSalvaListEntry[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? "Erro ao listar compras salvas");
        return j.data ?? [];
      })
      .then((lista) => {
        if (!cancelado) setSalvas(lista);
      })
      .catch((e) => {
        if (!cancelado) setSalvasErro(e instanceof Error ? e.message : "Erro ao listar compras salvas");
      })
      .finally(() => {
        if (!cancelado) setCarregandoSalvas(false);
      });
    return () => {
      cancelado = true;
    };
  }, [companyKey]);

  const salvaSelecionada = useMemo(
    () => salvas.find((s) => s.id === compraSalvaId) ?? null,
    [salvas, compraSalvaId]
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
    if (origem === "salva") return cents(previa?.total ?? salvaSelecionada?.totalValor ?? 0);
    if (origem === "itens") {
      return cents(itensDasLinhas.reduce((s, i) => s + i.qtd * i.custoUnitario, 0));
    }
    return parseMoeda(valorUnicoTexto);
  }, [origem, previa, salvaSelecionada, itensDasLinhas, valorUnicoTexto]);

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

  /** Ao escolher a Compra Salva, título e data vêm dela — só o parcelamento sobra para editar. */
  /**
   * Escolher a Compra Salva já traz tudo pronto: título, data da compra e os
   * itens reconhecidos com o valor exato (qtd × custo). Só o parcelamento fica
   * para o usuário.
   */
  const escolherCompraSalva = useCallback(
    async (id: string) => {
      setCompraSalvaId(id);
      setParcelasEditadas(false);
      setPrevia(null);
      if (!id) return;

      const escolhida = salvas.find((s) => s.id === id);
      if (escolhida) {
        setTitulo(escolhida.title);
        setDataCompra(dataBrasiliaDeIso(escolhida.savedAt));
      }

      setCarregandoPrevia(true);
      try {
        const res = await fetch(
          `/api/compras-gastos/reconhecer?company=${companyKey}&compraSalvaId=${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as { candidata?: CompraGastoCandidata; error?: string };
        if (!res.ok || !json.candidata) {
          setErro(json.error ?? "Não foi possível ler os itens da Compra Salva.");
          return;
        }
        setPrevia(json.candidata);
        setTitulo(json.candidata.titulo);
        setDataCompra(json.candidata.dataCompra);
      } catch {
        setErro("Não foi possível ler os itens da Compra Salva.");
      } finally {
        setCarregandoPrevia(false);
      }
    },
    [salvas, companyKey]
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
    if (origem === "salva" && !compraSalvaId) {
      setErro("Selecione a Compra Salva de origem.");
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

      if (origem === "salva") {
        body.compraSalvaId = compraSalvaId;
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
              className={`${styles.origin} ${origem === "salva" ? styles.originActive : ""}`}
              aria-pressed={origem === "salva"}
              onClick={() => setOrigem("salva")}
            >
              <span className={styles.originName}>Compra Salva</span>
              <span className={styles.originDesc}>
                Vincula uma lista já montada no dashboard. Valor, itens e data vêm dela.
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

          {origem === "salva" && (
            <div>
              <label className={styles.field}>
                <span>Compra Salva</span>
                <select
                  value={compraSalvaId}
                  onChange={(e) => void escolherCompraSalva(e.target.value)}
                  disabled={carregandoSalvas}
                >
                  <option value="">
                    {carregandoSalvas
                      ? "carregando…"
                      : salvas.length === 0
                        ? "nenhuma compra salva nesta empresa"
                        : "selecione uma compra salva"}
                  </option>
                  {salvas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {dataBrCompleta(dataBrasiliaDeIso(s.savedAt))} · {s.title} — {s.itemCount} itens ·{" "}
                      {brl(s.totalValor)}
                      {s.comprada ? " · comprada" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {salvasErro && <p className={styles.note}>{salvasErro}</p>}

              {carregandoPrevia && <p className={styles.note}>lendo os itens da compra…</p>}

              {previa && (
                <div className={styles.previa}>
                  <div className={styles.previaHead}>
                    <span>
                      <strong>{previa.itemCount}</strong>{" "}
                      {previa.itemCount === 1 ? "item reconhecido" : "itens reconhecidos"} · comprada
                      em {dataBrCompleta(previa.dataCompra)}
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
              só com a primeira parcela e o restante vai para os meses dos novos vencimentos.
            </p>
            <ParcelasEditor
              total={total}
              parcelas={parcelas}
              onChange={alterarParcelas}
              vencimentoSugerido={dataCompra}
              rodape={
                origem === "salva" && !parcelasEditadas
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
