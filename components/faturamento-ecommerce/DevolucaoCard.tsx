"use client";

import { useState, type FormEvent } from "react";

import type { EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { DevolucaoPreviewItem, EntradaDevolvivel, ImpostoInformado } from "@/lib/faturamento-ecommerce/types";

import { fmtBRL, fmtData, useFatApi } from "./api";
import styles from "./FaturamentoEcommerce.module.css";

/**
 * NF de devolução de compra (natureza tipo D: 117.11 / 150.01), como o form do Linx: parte de uma NF
 * de entrada do fornecedor, escolhe itens e quantidades (o saldo ainda não devolvido) e leva os
 * impostos da NF do fornecedor — o Linx não guarda o XML dele, então as alíquotas (e, se preciso,
 * o valor de cada item) são informadas aqui, como o operador digita no Linx.
 */
export interface DevolucaoTela {
  entrada: EntradaDevolvivel | null;
  /** Quantidade a devolver por item da entrada ("item|sub"). */
  qtdes: Record<string, number>;
  /** Alíquotas da NF do fornecedor por imposto (texto digitado). */
  taxas: Record<string, string>;
  /** Ajuste fino de um item fiscal (CODIGO_ITEM). */
  impostos: Record<string, ImpostoInformado[]>;
}

export const DEVOLUCAO_VAZIA: DevolucaoTela = { entrada: null, qtdes: {}, taxas: {}, impostos: {} };
export const chaveItemEntrada = (i: { itemImpressao: string; subItem: number }) => `${i.itemImpressao}|${i.subItem}`;

const IMPOSTOS_ALIQUOTA = [
  { id: "1", nome: "ICMS %" },
  { id: "2", nome: "IPI %" },
  { id: "5", nome: "PIS %" },
  { id: "6", nome: "COFINS %" },
  { id: "92", nome: "IBS %" },
  { id: "93", nome: "CBS %" },
];

const num = (v: string) => {
  const s = String(v).trim();
  const x = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(x) ? x : 0;
};

export default function DevolucaoCard({
  empresa,
  filial,
  valor,
  onChange,
  onEscolherFornecedor,
  previaItens,
}: {
  empresa: EmpresaFat;
  filial: string;
  valor: DevolucaoTela;
  onChange: (v: DevolucaoTela) => void;
  /** Carrega o fornecedor (cliente da NF) pelo código. */
  onEscolherFornecedor: (clifor: string) => Promise<void>;
  /** Itens fiscais com os impostos calculados na última conferência. */
  previaItens: DevolucaoPreviewItem[] | null;
}) {
  const api = useFatApi(empresa);
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<EntradaDevolvivel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    setErro(null);
    setBuscando(true);
    try {
      setLista(await api.get<EntradaDevolvivel[]>("/devolucoes", { q: busca.trim(), filial }));
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setBuscando(false);
    }
  };

  const escolher = async (en: EntradaDevolvivel) => {
    setErro(null);
    try {
      await onEscolherFornecedor(en.clifor);
      const qtdes: Record<string, number> = {};
      for (const i of en.itens) qtdes[chaveItemEntrada(i)] = Math.max(0, i.qtde - i.devolvida);
      onChange({ ...DEVOLUCAO_VAZIA, entrada: en, qtdes });
      setLista(null);
    } catch (err) {
      setErro((err as Error).message);
    }
  };

  const ajustarImposto = (codigo: string, base: ImpostoInformado[], id: number, campo: "base" | "taxa" | "valor", texto: string) => {
    const atual = valor.impostos[codigo] ?? base.map(({ id: i, base: b, taxa, valor: v }) => ({ id: i, base: b, taxa, valor: v }));
    const novo = atual.map((t) => {
      if (t.id !== id) return t;
      const x = { ...t, [campo]: num(texto) };
      // Mudou base ou alíquota: recalcula o valor (truncado, como a sugestão); valor digitado fica.
      if (campo !== "valor") x.valor = Math.floor(((x.base * x.taxa) / 100) * 100 + 1e-7) / 100;
      return x;
    });
    onChange({ ...valor, impostos: { ...valor.impostos, [codigo]: novo } });
  };

  const en = valor.entrada;
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>Devolução de compra — NF de entrada</span>
      </div>

      {!en && (
        <>
          <form className={styles.linhaBusca} onSubmit={buscar}>
            <input
              className={styles.input}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Fornecedor ou nº da NF de compra"
            />
            <button type="submit" className={styles.btn} disabled={buscando || busca.trim().length < 2}>
              {buscando ? "Buscando…" : "Buscar"}
            </button>
          </form>
          {erro && <div className={styles.erroBox}>{erro}</div>}
          {lista && lista.length === 0 && <p className={styles.muted}>Nenhuma NF de entrada com saldo a devolver em {filial}.</p>}
          {lista && lista.length > 0 && (
            <div className={styles.tabelaWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>NF</th>
                    <th>Emissão</th>
                    <th className={styles.num}>Valor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((x) => (
                    <tr key={`${x.fornecedor}|${x.nfEntrada}|${x.serieEntrada}`}>
                      <td>{x.fornecedor}</td>
                      <td className={styles.mono}>
                        {x.nfEntrada}/{x.serieEntrada}
                      </td>
                      <td>{fmtData(x.emissao)}</td>
                      <td className={styles.num}>{fmtBRL(x.valorTotal)}</td>
                      <td>
                        <button type="button" className={`${styles.btnPrimario} ${styles.btnMini}`} onClick={() => escolher(x)}>
                          Devolver desta NF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {en && (
        <>
          <p>
            <strong>{en.fornecedor}</strong> · NF {en.nfEntrada}/{en.serieEntrada} de {fmtData(en.emissao)}{" "}
            <button type="button" className={`${styles.btnTexto} ${styles.btnMini}`} onClick={() => onChange(DEVOLUCAO_VAZIA)}>
              trocar NF
            </button>
          </p>
          {erro && <div className={styles.erroBox}>{erro}</div>}
          <div className={styles.tabelaWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Produto</th>
                  <th className={styles.num}>Entrada</th>
                  <th className={styles.num}>Já devolvido</th>
                  <th className={styles.num}>Devolver</th>
                  <th className={styles.num}>Preço</th>
                  <th className={styles.num}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {en.itens.map((i) => {
                  const k = chaveItemEntrada(i);
                  const saldo = Math.max(0, i.qtde - i.devolvida);
                  const q = valor.qtdes[k] ?? 0;
                  return (
                    <tr key={k}>
                      <td className={styles.mono}>{i.itemImpressao}</td>
                      <td>
                        <span className={styles.mono}>
                          {i.produto} {i.cor}
                        </span>{" "}
                        {i.descricao}
                      </td>
                      <td className={styles.num}>{i.qtde}</td>
                      <td className={styles.num}>{i.devolvida}</td>
                      <td className={styles.num}>
                        <input
                          className={`${styles.input} ${styles.inputNum}`}
                          style={{ width: 70 }}
                          value={String(q)}
                          disabled={saldo === 0}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(saldo, Math.round(num(e.target.value))));
                            onChange({ ...valor, qtdes: { ...valor.qtdes, [k]: v }, impostos: {} });
                          }}
                        />
                      </td>
                      <td className={styles.num}>{i.preco.toLocaleString("pt-BR", { maximumFractionDigits: 5 })}</td>
                      <td className={styles.num}>{fmtBRL(Math.round(i.preco * q * 100) / 100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className={styles.label} style={{ marginTop: 12 }}>
            Alíquotas da NF do fornecedor (o Linx não guarda o XML dele — copie da DANFE de compra)
          </p>
          <div className={styles.grid}>
            {IMPOSTOS_ALIQUOTA.map((t) => (
              <label key={t.id} className={styles.campo}>
                <span className={styles.label}>{t.nome}</span>
                <input
                  className={`${styles.input} ${styles.inputNum}`}
                  value={valor.taxas[t.id] ?? ""}
                  placeholder="0"
                  onChange={(e) => onChange({ ...valor, taxas: { ...valor.taxas, [t.id]: e.target.value }, impostos: {} })}
                />
              </label>
            ))}
          </div>
          <p className={styles.muted}>
            Bases como o Linx grava: ICMS e IBS/CBS = item + frete da entrada; IPI = item; PIS/COFINS = base do ICMS +
            IPI. O IPI soma ao total da NF. Confira (Conferir NF) e, se a nota do fornecedor tiver 1 centavo diferente em
            algum item, ajuste abaixo.
          </p>

          {previaItens && previaItens.length > 0 && (
            <div className={styles.tabelaWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Item fiscal</th>
                    <th className={styles.num}>Valor</th>
                    <th>Imposto</th>
                    <th className={styles.num}>Base</th>
                    <th className={styles.num}>%</th>
                    <th className={styles.num}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {previaItens.flatMap((it) =>
                    it.impostos.map((t, k) => {
                      const ajustado = valor.impostos[it.codigoItem]?.find((x) => x.id === t.id);
                      const v = ajustado ?? t;
                      return (
                        <tr key={`${it.codigoItem}|${t.id}`}>
                          <td className={styles.mono}>{k === 0 ? it.codigoItem : ""}</td>
                          <td className={styles.num}>{k === 0 ? fmtBRL(it.valor) : ""}</td>
                          <td>{t.nome}</td>
                          {(["base", "taxa", "valor"] as const).map((campo) => (
                            <td key={campo} className={styles.num}>
                              <input
                                className={`${styles.input} ${styles.inputNum} ${ajustado ? styles.inputAlterado : ""}`}
                                style={{ width: 90 }}
                                defaultValue={String(v[campo]).replace(".", ",")}
                                key={`${campo}|${v[campo]}`}
                                onBlur={(e) => ajustarImposto(it.codigoItem, it.impostos, t.id, campo, e.target.value)}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
