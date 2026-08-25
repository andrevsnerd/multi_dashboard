"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CompraSalvaListEntry } from "@/lib/types/compra-salva";
import {
  COMPRA_GASTO_TIPO_LABEL,
  type CompraGastoItem,
  type CompraGastoLote,
  type CompraGastoOrigem,
  type CompraGastoParcela,
  type CompraGastoTipo,
} from "@/lib/types/compra-gasto";
import { cents, gerarParcelas } from "@/lib/utils/compra-gastos-agregacao";

import styles from "./GastosCompra.module.css";
import { brl, money, parseMoeda } from "./gastos-compra-format";

interface Props {
  companyKey: string;
  username: string;
  /** Mês (YYYY-MM) sugerido para o primeiro vencimento. */
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

  const [linhas, setLinhas] = useState<LinhaLivre[]>([{ ...LINHA_VAZIA }, { ...LINHA_VAZIA }]);
  const [valorUnicoTexto, setValorUnicoTexto] = useState("");

  const [codigo, setCodigo] = useState("");
  const [titulo, setTitulo] = useState("");
  const [colecao, setColecao] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [tipo, setTipo] = useState<CompraGastoTipo>("mercadoria");
  const [dataCompra, setDataCompra] = useState(hoje);
  const [chegadaIni, setChegadaIni] = useState("");
  const [chegadaFim, setChegadaFim] = useState("");
  const [pdv, setPdv] = useState("");
  const [estimado, setEstimado] = useState(false);
  const [observacao, setObservacao] = useState("");

  const [qtdParcelas, setQtdParcelas] = useState(1);
  const [primeiroVencimento, setPrimeiroVencimento] = useState(
    `${mesSugerido ?? hoje.slice(0, 7)}-15`
  );
  const [intervalo, setIntervalo] = useState<"mensal" | "quinzenal">("mensal");
  const [parcelas, setParcelas] = useState<CompraGastoParcela[]>([]);
  const [parcelasEditadas, setParcelasEditadas] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // ───────── Compras Salvas disponíveis ─────────
  useEffect(() => {
    if (origem !== "salva" || salvas.length > 0 || carregandoSalvas) return;
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
        if (cancelado) return;
        setSalvas(lista);
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
  }, [origem, companyKey, salvas.length, carregandoSalvas]);

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
    if (origem === "salva") return cents(salvaSelecionada?.totalValor ?? 0);
    if (origem === "itens") {
      return cents(itensDasLinhas.reduce((s, i) => s + i.qtd * i.custoUnitario, 0));
    }
    return parseMoeda(valorUnicoTexto);
  }, [origem, salvaSelecionada, itensDasLinhas, valorUnicoTexto]);

  // Regera a prévia de parcelas enquanto o usuário não editar linha a linha.
  useEffect(() => {
    if (parcelasEditadas) return;
    setParcelas(gerarParcelas(total, qtdParcelas, primeiroVencimento, intervalo));
  }, [total, qtdParcelas, primeiroVencimento, intervalo, parcelasEditadas]);

  // Título e código sugeridos ao escolher uma Compra Salva.
  useEffect(() => {
    if (origem === "salva" && salvaSelecionada) {
      setTitulo((atual) => atual || salvaSelecionada.title);
    }
  }, [origem, salvaSelecionada]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const somaParcelas = cents(parcelas.reduce((s, p) => s + p.valor, 0));
  const parcelasDivergem = parcelas.length > 0 && Math.abs(somaParcelas - total) > 0.5;

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

  const atualizarParcela = useCallback(
    (i: number, campo: "vencimento" | "valor", valor: string) => {
      setParcelasEditadas(true);
      setParcelas((prev) => {
        const next = [...prev];
        next[i] = {
          ...next[i],
          [campo]: campo === "valor" ? parseMoeda(valor) : valor,
        };
        return next;
      });
    },
    []
  );

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
        codigo: codigo.trim() || titulo.trim().slice(0, 24),
        titulo: titulo.trim(),
        colecao: colecao.trim() || null,
        fornecedor: fornecedor.trim() || null,
        tipo,
        dataCompra,
        chegadaIni: chegadaIni || null,
        chegadaFim: chegadaFim || chegadaIni || null,
        pdv: pdv || null,
        estimado,
        observacao: observacao.trim() || null,
      };

      if (origem === "salva") {
        body.compraSalvaId = compraSalvaId;
        // Sem edição manual, o servidor divide o total real dos itens (evita
        // divergir do arredondamento da listagem).
        if (parcelasEditadas) body.parcelas = parcelas;
        else body.parcelasConfig = { quantidade: qtdParcelas, primeiroVencimento, intervalo };
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
                Vincula uma lista já montada no dashboard. Valor e itens vêm calculados.
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
                  onChange={(e) => {
                    setCompraSalvaId(e.target.value);
                    setParcelasEditadas(false);
                  }}
                  disabled={carregandoSalvas}
                >
                  <option value="">
                    {carregandoSalvas ? "carregando…" : "selecione uma compra salva"}
                  </option>
                  {salvas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} — {s.itemCount} itens · {brl(s.totalValor)}
                      {s.comprada ? " · comprada" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {salvasErro && <p className={styles.note}>{salvasErro}</p>}
              <p className={styles.note}>
                O valor vem de qtd × custo dos itens, item por item. Item sem custo cadastrado não
                soma zero escondido: a compra nasce marcada como estimativa e a observação registra
                quantos ficaram de fora.
              </p>
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
              <label className={styles.field}>
                <span>Código</span>
                <input
                  className={styles.money}
                  value={codigo}
                  placeholder="compra 11"
                  onChange={(e) => setCodigo(e.target.value)}
                />
              </label>
              {origem !== "valor" && (
                <label className={styles.field}>
                  <span>Descrição</span>
                  <input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
                </label>
              )}
              <label className={styles.field}>
                <span>Coleção</span>
                <input value={colecao} onChange={(e) => setColecao(e.target.value)} />
              </label>
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
                <input type="date" value={dataCompra} onChange={(e) => setDataCompra(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Previsão de chegada</span>
                <input type="date" value={chegadaIni} onChange={(e) => setChegadaIni(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Chegada até</span>
                <input type="date" value={chegadaFim} onChange={(e) => setChegadaFim(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>No PDV</span>
                <input type="date" value={pdv} onChange={(e) => setPdv(e.target.value)} />
              </label>
            </div>
          </div>

          <div>
            <div className={styles.blockTitle}>Parcelas</div>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span>Nº de parcelas</span>
                <input
                  type="number"
                  min={1}
                  max={48}
                  value={qtdParcelas}
                  onChange={(e) => {
                    setQtdParcelas(Math.max(1, Math.min(48, Number(e.target.value) || 1)));
                    setParcelasEditadas(false);
                  }}
                />
              </label>
              <label className={styles.field}>
                <span>1º vencimento</span>
                <input
                  type="date"
                  value={primeiroVencimento}
                  onChange={(e) => {
                    setPrimeiroVencimento(e.target.value);
                    setParcelasEditadas(false);
                  }}
                />
              </label>
              <label className={styles.field}>
                <span>Intervalo</span>
                <select
                  value={intervalo}
                  onChange={(e) => {
                    setIntervalo(e.target.value as "mensal" | "quinzenal");
                    setParcelasEditadas(false);
                  }}
                >
                  <option value="mensal">Mensal, mesmo dia</option>
                  <option value="quinzenal">A cada 15 dias</option>
                </select>
              </label>
            </div>

            {parcelas.length > 0 && (
              <div className={styles.parcelaGrid} style={{ marginTop: 10 }}>
                {parcelas.map((p, i) => (
                  <div className={styles.parcelaLine} key={i}>
                    <span className={styles.parcelaNum}>
                      {i + 1}/{parcelas.length}
                    </span>
                    <input
                      type="date"
                      value={p.vencimento}
                      onChange={(e) => atualizarParcela(i, "vencimento", e.target.value)}
                    />
                    <input
                      className={styles.money}
                      value={money(p.valor)}
                      inputMode="decimal"
                      onChange={(e) => atualizarParcela(i, "valor", e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className={styles.sumRow}>
              <span className={styles.note} style={{ margin: 0 }}>
                {origem === "salva" && !parcelasEditadas
                  ? "Prévia: o valor exato dos itens é confirmado ao salvar"
                  : "Soma das parcelas"}
              </span>
              <b className={parcelasDivergem ? styles.neg : undefined}>{brl(somaParcelas)}</b>
            </div>
            {parcelasDivergem && (
              <p className={styles.note}>
                A soma das parcelas difere do total da compra ({brl(total)}). Ajuste se não for
                intencional — o gasto do mês segue as parcelas.
              </p>
            )}
          </div>

          <label className={styles.check}>
            <input type="checkbox" checked={estimado} onChange={(e) => setEstimado(e.target.checked)} />
            <span>
              <strong>Marcar como estimativa.</strong> Entra no comprometido com hachura no gráfico,
              para não confundir verba reservada com compra fechada.
            </span>
          </label>

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
