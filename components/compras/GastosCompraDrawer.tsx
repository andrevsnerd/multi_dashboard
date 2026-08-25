"use client";

import { useEffect, useState } from "react";

import {
  COMPRA_GASTO_ORIGEM_LABEL,
  COMPRA_GASTO_TIPO_LABEL,
  type CompraGastoLote,
} from "@/lib/types/compra-gasto";
import {
  itemTotal,
  itensSemCusto,
  itensTotal,
  loteStatus,
  loteTotal,
  loteTotalPago,
} from "@/lib/utils/compra-gastos-agregacao";

import styles from "./GastosCompra.module.css";
import { brl, dataBr, dataBrCompleta, money } from "./gastos-compra-format";

interface Props {
  lote: CompraGastoLote;
  hoje: string;
  podeEditar: boolean;
  salvando: boolean;
  onClose: () => void;
  onTogglePago: (indice: number, pago: boolean) => void;
  onDelete: () => void;
}

type Aba = "composicao" | "parcelas" | "detalhes";

const TOM_CLASSE = {
  good: styles.pillGood,
  warn: styles.pillWarn,
  crit: styles.pillCrit,
  mute: styles.pillMute,
} as const;

export default function GastosCompraDrawer({
  lote,
  hoje,
  podeEditar,
  salvando,
  onClose,
  onTogglePago,
  onDelete,
}: Props) {
  // A aba volta para "Composição" a cada compra aberta porque o painel remonta
  // a gaveta por `key` — sem efeito de reset.
  const [aba, setAba] = useState<Aba>("composicao");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = loteTotal(lote);
  const pago = loteTotalPago(lote);
  const status = loteStatus(lote, hoje);
  const somaLinhas = itensTotal(lote.itens);
  const semCusto = itensSemCusto(lote.itens);
  const divergencia = lote.itens.length > 0 ? Math.abs(somaLinhas - total) : 0;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} role="presentation" />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={lote.titulo}>
        <div className={styles.drawerHead}>
          <div className={styles.drawerTop}>
            <div>
              <div className={styles.drawerCode}>{lote.codigo}</div>
              <h3 className={styles.drawerTitle}>{lote.titulo}</h3>
            </div>
            <button type="button" className={styles.closeX} onClick={onClose} aria-label="Fechar">
              ✕
            </button>
          </div>

          <div className={styles.drawerPills}>
            <span className={`${styles.pill} ${TOM_CLASSE[status.tom]}`}>
              <i />
              {status.label}
            </span>
            <span
              className={`${styles.tag} ${lote.origem === "salva" ? styles.tagLinked : ""}`}
            >
              {COMPRA_GASTO_ORIGEM_LABEL[lote.origem]}
            </span>
            <span className={styles.tag}>{COMPRA_GASTO_TIPO_LABEL[lote.tipo]}</span>
          </div>

          <div className={styles.drawerFacts}>
            <div className={styles.fact}>
              <span className={styles.factK}>Valor total</span>
              <span className={styles.factV}>{brl(total)}</span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factK}>Pago</span>
              <span className={styles.factV}>{pago > 0 ? brl(pago) : "—"}</span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factK}>Data da compra</span>
              <span className={styles.factV}>{dataBrCompleta(lote.dataCompra)}</span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factK}>Previsão chegada</span>
              <span className={styles.factV}>
                {lote.chegadaIni
                  ? `${dataBr(lote.chegadaIni)}${
                      lote.chegadaFim && lote.chegadaFim !== lote.chegadaIni
                        ? ` a ${dataBr(lote.chegadaFim)}`
                        : ""
                    }`
                  : "—"}
              </span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factK}>Chegada real</span>
              <span className={styles.factV}>{dataBr(lote.chegadaReal)}</span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factK}>No PDV</span>
              <span className={styles.factV}>{dataBr(lote.pdv)}</span>
            </div>
          </div>
        </div>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={aba === "composicao"}
            className={aba === "composicao" ? styles.tabActive : undefined}
            onClick={() => setAba("composicao")}
          >
            Composição
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={aba === "parcelas"}
            className={aba === "parcelas" ? styles.tabActive : undefined}
            onClick={() => setAba("parcelas")}
          >
            Parcelas ({lote.parcelas.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={aba === "detalhes"}
            className={aba === "detalhes" ? styles.tabActive : undefined}
            onClick={() => setAba("detalhes")}
          >
            Detalhes
          </button>
        </div>

        <div className={styles.drawerBody}>
          {aba === "composicao" && lote.itens.length === 0 && (
            <div className={styles.callout}>
              <strong>Lançada como valor único</strong>
              <span>
                Esta compra não tem itens detalhados — é{" "}
                {COMPRA_GASTO_TIPO_LABEL[lote.tipo].toLowerCase()}. Entra no comprometido pelo valor
                informado: <strong>{brl(lote.valorUnico ?? total)}</strong>.
              </span>
            </div>
          )}

          {aba === "composicao" && lote.itens.length > 0 && (
            <>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th className={styles.thNum}>Qtd</th>
                      <th className={styles.thNum}>Custo un.</th>
                      <th className={styles.thNum}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lote.itens.map((item, i) => (
                      <tr key={`${item.produto ?? "livre"}-${i}`}>
                        <td>
                          <span className={styles.itemDesc}>
                            <span className={styles.itemName}>
                              {item.descricao || "(sem descrição)"}
                              {!item.produto && <span className={styles.tag}>livre</span>}
                            </span>
                            <span className={styles.itemSub}>
                              {item.produto
                                ? `${item.produto}${
                                    item.corDescricao
                                      ? ` · ${item.corProduto ?? ""} ${item.corDescricao}`.trim()
                                      : item.corProduto
                                        ? ` · cor ${item.corProduto}`
                                        : ""
                                  }`
                                : "sem vínculo com produto"}
                            </span>
                          </span>
                        </td>
                        <td className={styles.num}>{item.qtd.toLocaleString("pt-BR")}</td>
                        <td className={styles.num}>
                          {item.custoUnitario > 0 ? money(item.custoUnitario) : "—"}
                        </td>
                        <td className={styles.num}>{money(itemTotal(item))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Soma das linhas</td>
                      <td />
                      <td />
                      <td className={styles.num}>{money(somaLinhas)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {semCusto > 0 && (
                <div className={`${styles.callout} ${styles.calloutWarn}`}>
                  <strong>
                    {semCusto} {semCusto > 1 ? "linhas sem custo" : "linha sem custo"}
                  </strong>
                  <span>
                    A soma das linhas está subestimada. Preencha o custo para o valor da compra
                    fechar — enquanto isso, o lote fica marcado como estimativa.
                  </span>
                </div>
              )}

              {divergencia > 0.5 && (
                <div className={styles.callout}>
                  <strong>Soma das linhas ≠ total das parcelas</strong>
                  <span>
                    Diferença de {brl(divergencia)}. O gasto do mês usa o total das parcelas — é o
                    dinheiro que sai de fato.
                  </span>
                </div>
              )}
            </>
          )}

          {aba === "parcelas" && (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Parcela</th>
                    <th>Vencimento</th>
                    <th className={styles.thNum}>Valor</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {lote.parcelas.map((p, i) => (
                    <tr key={`${p.vencimento}-${i}`}>
                      <td className={styles.parcelaNum}>
                        {i + 1}/{lote.parcelas.length}
                      </td>
                      <td className={styles.num} style={{ textAlign: "left" }}>
                        {dataBrCompleta(p.vencimento)}
                      </td>
                      <td className={styles.num}>{money(p.valor)}</td>
                      <td>
                        {podeEditar ? (
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              checked={p.pago}
                              disabled={salvando}
                              onChange={(e) => onTogglePago(i, e.target.checked)}
                            />
                            <span>
                              {p.pago
                                ? `pago${p.dataPagamento ? ` em ${dataBr(p.dataPagamento)}` : ""}`
                                : p.vencimento < hoje
                                  ? "vencido"
                                  : "a pagar"}
                            </span>
                          </label>
                        ) : (
                          <span
                            className={`${styles.pill} ${p.pago ? styles.pillGood : p.vencimento < hoje ? styles.pillCrit : styles.pillWarn}`}
                          >
                            <i />
                            {p.pago ? "Pago" : p.vencimento < hoje ? "Vencido" : "A pagar"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total</td>
                    <td className={styles.num}>{money(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {aba === "detalhes" && (
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div className={styles.fact}>
                <span className={styles.factK}>Origem do valor</span>
                <span className={styles.factText}>
                  {lote.origem === "salva"
                    ? `Compra Salva vinculada — ${lote.itens.length} itens. O valor veio de qtd × custo item por item.`
                    : lote.origem === "itens"
                      ? `Linhas digitadas nesta compra: ${lote.itens.filter((i) => i.produto).length} vinculadas a produto e ${lote.itens.filter((i) => !i.produto).length} livres.`
                      : "Valor único informado à mão. Sem itens, sem impacto em estoque."}
                </span>
              </div>
              <div className={styles.fact}>
                <span className={styles.factK}>Coleção</span>
                <span className={styles.factText}>{lote.colecao || "não informada"}</span>
              </div>
              <div className={styles.fact}>
                <span className={styles.factK}>Fornecedor</span>
                <span className={styles.factText}>{lote.fornecedor || "não informado"}</span>
              </div>
              {lote.estimado && (
                <div className={styles.fact}>
                  <span className={styles.factK}>Estimativa</span>
                  <span className={styles.factText}>
                    Marcada como estimativa: entra no comprometido, mas aparece hachurada no
                    gráfico para não se confundir com compra fechada.
                  </span>
                </div>
              )}
              <div className={styles.fact}>
                <span className={styles.factK}>Observação</span>
                <span className={styles.factText}>{lote.observacao || "—"}</span>
              </div>
              <div className={styles.fact}>
                <span className={styles.factK}>Registro</span>
                <span className={styles.factText}>
                  {lote.criadoPor ? `criada por ${lote.criadoPor}` : "criada no dashboard"} ·{" "}
                  {dataBrCompleta(lote.createdAt.slice(0, 10))}
                </span>
              </div>
            </div>
          )}
        </div>

        {podeEditar && (
          <div className={styles.drawerFoot}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm} ${styles.btnDanger}`}
              onClick={onDelete}
              disabled={salvando}
            >
              Excluir compra
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
