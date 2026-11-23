"use client";

import { useState, type FormEvent } from "react";

import type { EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { MaterialFatOpcao } from "@/lib/faturamento-ecommerce/types";

import { fmtBRL, useFatApi } from "./api";
import styles from "./FaturamentoEcommerce.module.css";

/**
 * NF de material (remessa p/ industrialização 130.01, simples remessa de material…), como o Linx
 * grava: itens avulsos do cadastro de materiais (código, NCM, unidade), quantidade com casas
 * (metros/quilos), preço e a descrição da NF — que o operador costuma completar (ex. "COD 040272").
 * Não mexe em estoque: as NFs reais não têm saída de material ligada.
 */
export interface MaterialTela {
  chave: string;
  material: string;
  descricao: string;
  unidade: string;
  qtde: string;
  preco: string;
}

const num = (v: string) => {
  const s = String(v).trim();
  const x = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(x) ? x : 0;
};
export const materialNum = num;

export default function MateriaisCard({
  empresa,
  itens,
  setItens,
}: {
  empresa: EmpresaFat;
  itens: MaterialTela[];
  setItens: (f: (prev: MaterialTela[]) => MaterialTela[]) => void;
}) {
  const api = useFatApi(empresa);
  const [termo, setTermo] = useState("");
  const [opcoes, setOpcoes] = useState<MaterialFatOpcao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    setErro(null);
    try {
      setOpcoes(await api.get<MaterialFatOpcao[]>("/materiais", { q: termo.trim() }));
    } catch (err) {
      setErro((err as Error).message);
    }
  };

  const incluir = (m: MaterialFatOpcao) => {
    setItens((prev) => [
      ...prev,
      { chave: `${m.material}|${Date.now()}`, material: m.material, descricao: m.descricao, unidade: m.unidade, qtde: "1", preco: "0" },
    ]);
    setOpcoes(null);
    setTermo("");
  };

  const alterar = (chave: string, campo: "descricao" | "qtde" | "preco", valor: string) =>
    setItens((prev) => prev.map((i) => (i.chave === chave ? { ...i, [campo]: valor } : i)));

  const subtotal = itens.reduce((s, i) => s + Math.round(num(i.qtde) * num(i.preco) * 100) / 100, 0);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>Materiais (item avulso — não mexe em estoque)</span>
      </div>
      <form className={styles.linhaBusca} onSubmit={buscar}>
        <input className={styles.input} value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Código ou descrição do material" />
        <button type="submit" className={styles.btn} disabled={termo.trim().length < 2}>
          Buscar
        </button>
      </form>
      {erro && <div className={styles.erroBox}>{erro}</div>}
      {opcoes && opcoes.length === 0 && <p className={styles.muted}>Nenhum material ativo encontrado.</p>}
      {opcoes && opcoes.length > 0 && (
        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <tbody>
              {opcoes.map((m) => (
                <tr key={m.material} className={styles.trClick} onClick={() => incluir(m)}>
                  <td className={styles.mono}>{m.material}</td>
                  <td>{m.descricao}</td>
                  <td>{m.unidade}</td>
                  <td className={styles.mono}>{m.ncm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Material</th>
              <th>Descrição na NF</th>
              <th>Un.</th>
              <th className={styles.num}>Qtde</th>
              <th className={styles.num}>Preço unit.</th>
              <th className={styles.num}>Valor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.vazio}>
                  Nenhum material. Busque pelo código (ex. P11AC00290) ou pela descrição.
                </td>
              </tr>
            )}
            {itens.map((i) => (
              <tr key={i.chave}>
                <td className={styles.mono}>{i.material}</td>
                <td>
                  <input
                    className={styles.input}
                    maxLength={80}
                    value={i.descricao}
                    onChange={(e) => alterar(i.chave, "descricao", e.target.value)}
                  />
                </td>
                <td>{i.unidade}</td>
                <td className={styles.num}>
                  <input
                    className={`${styles.input} ${styles.inputNum}`}
                    style={{ width: 90 }}
                    value={i.qtde}
                    onChange={(e) => alterar(i.chave, "qtde", e.target.value)}
                  />
                </td>
                <td className={styles.num}>
                  <input
                    className={`${styles.input} ${styles.inputNum}`}
                    style={{ width: 100 }}
                    value={i.preco}
                    onChange={(e) => alterar(i.chave, "preco", e.target.value)}
                  />
                </td>
                <td className={styles.num}>{fmtBRL(Math.round(num(i.qtde) * num(i.preco) * 100) / 100)}</td>
                <td>
                  <button
                    type="button"
                    className={`${styles.btnTexto} ${styles.btnMini}`}
                    onClick={() => setItens((prev) => prev.filter((x) => x.chave !== i.chave))}
                  >
                    remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {itens.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5} className={styles.num}>
                  <strong>Subtotal</strong>
                </td>
                <td className={styles.num}>
                  <strong>{fmtBRL(subtotal)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
