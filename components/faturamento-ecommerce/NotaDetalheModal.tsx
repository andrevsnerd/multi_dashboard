"use client";

import { useEffect, useState } from "react";

import type { EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { NotaDetalhe, NotaListItem } from "@/lib/faturamento-ecommerce/types";

import { fmtBRL, fmtData, fmtDataHora, fmtDoc, useFatApi } from "./api";
import styles from "./FaturamentoEcommerce.module.css";

/** Detalhe de uma NF (cabeçalho, itens, status da NF-e) com download do XML autorizado. */
export default function NotaDetalheModal({
  empresa,
  nota,
  onFechar,
}: {
  empresa: EmpresaFat;
  nota: NotaListItem;
  onFechar: () => void;
}) {
  const { get, username } = useFatApi(empresa);
  const [d, setD] = useState<NotaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    let vivo = true;
    get<NotaDetalhe>("/notas/detalhe", { filial: nota.filial, nf: nota.nf, serie: nota.serie })
      .then((x) => vivo && setD(x))
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [get, nota.filial, nota.nf, nota.serie]);

  const baixarXml = async () => {
    if (!d) return;
    setBaixando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/faturamento-ecommerce/notas/xml?empresa=${empresa}&chave=${d.chave}`, {
        headers: { "x-auth-username": username },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Erro ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${d.chave}-procNFe.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" onClick={onFechar}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            NF {nota.nf}/{nota.serie} — {nota.filial}
          </h2>
          <button type="button" className={styles.btnTexto} onClick={onFechar}>
            fechar ✕
          </button>
        </div>
        {erro && <div className={styles.erroBox}>{erro}</div>}
        {!d && !erro && <div className={styles.vazio}>Carregando…</div>}
        {d && (
          <>
            <div className={styles.acoes}>
              <span className={`${styles.badge} ${styles[`badge_${d.tom}`]}`}>{d.statusLabel}</span>
              {d.cancelada && <span className={`${styles.badge} ${styles.badge_neutro}`}>Nota cancelada</span>}
              {d.temXml && (
                <button type="button" className={`${styles.btn} ${styles.btnMini}`} onClick={baixarXml} disabled={baixando}>
                  {baixando ? "Baixando…" : "Baixar XML"}
                </button>
              )}
            </div>
            {d.mensagem && d.status !== 5 && d.status !== 6 && (
              <div className={styles.erroBox}>Último retorno do envio: {d.mensagem}</div>
            )}
            {d.status === 1 && (
              <div className={styles.avisoBox}>
                NF ainda não enviada. No Linx: Monitor de Controle da NF-e → selecione a NF {d.nf} → Envia NFe para Sefaz.
              </div>
            )}
            <div className={styles.duasColunas}>
              <dl className={styles.kv}>
                <dt>Emissão</dt>
                <dd>{fmtData(d.emissao)}</dd>
                <dt>Cliente</dt>
                <dd>
                  {d.cliente} — {fmtDoc(d.cpfCnpj)}
                  <br />
                  {d.cidade}/{d.uf}
                </dd>
                <dt>Natureza</dt>
                <dd>{d.natureza}</dd>
                <dt>OBS</dt>
                <dd>{d.obs || "—"}</dd>
                <dt>Chave</dt>
                <dd className={styles.mono}>{d.chave || "—"}</dd>
                <dt>Protocolo</dt>
                <dd>
                  {d.protocolo || "—"} {d.dataAutorizacao ? `(${fmtDataHora(d.dataAutorizacao)})` : ""}
                </dd>
              </dl>
              <dl className={styles.kv}>
                <dt>Produtos</dt>
                <dd>{fmtBRL(d.subtotal)}</dd>
                <dt>Desconto</dt>
                <dd>{fmtBRL(d.desconto)}</dd>
                <dt>Frete / Seguro</dt>
                <dd>
                  {fmtBRL(d.frete)} / {fmtBRL(d.seguro)}
                </dd>
                <dt>Total</dt>
                <dd>
                  <strong>{fmtBRL(d.valor)}</strong> ({d.qtde} peça(s))
                </dd>
                <dt>Pagamento / frete</dt>
                <dd>
                  cond. {d.condicaoPgto} · info {d.infoPgto} · tipo frete {d.tipoFrete}
                </dd>
                <dt>Transporte</dt>
                <dd>
                  {d.transportadora} · {d.volumes} {d.tipoVolume} · {d.pesoLiquido}/{d.pesoBruto} kg
                </dd>
              </dl>
            </div>
            <div className={styles.tabelaWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Descrição</th>
                    <th className={styles.num}>Qtde</th>
                    <th className={styles.num}>Preço</th>
                    <th className={styles.num}>Valor</th>
                    <th>CFOP</th>
                  </tr>
                </thead>
                <tbody>
                  {d.itens.map((i, k) => (
                    <tr key={k}>
                      <td className={styles.mono}>
                        {i.produto} {i.cor}
                      </td>
                      <td>{i.descricao}</td>
                      <td className={styles.num}>{i.qtde}</td>
                      <td className={styles.num}>{fmtBRL(i.preco)}</td>
                      <td className={styles.num}>{fmtBRL(i.valor)}</td>
                      <td className={styles.mono}>{i.cfop}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
