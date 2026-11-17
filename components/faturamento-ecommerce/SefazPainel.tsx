"use client";

import { useState } from "react";

import type { EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { NotaDetalhe } from "@/lib/faturamento-ecommerce/types";

import { useFatApi } from "./api";
import styles from "./FaturamentoEcommerce.module.css";

interface Etapa {
  etapa: string;
  ok: boolean;
  detalhe?: string;
}
interface Verificacao {
  linxStatus: number;
  linxLog: number;
  linxProtocolo: string;
  xmlGuardado: boolean;
  contabilizada: boolean;
  sefazCStat: string | null;
  sefazMotivo: string | null;
  sefazProtocolo: string | null;
  confere: boolean;
  chave: string;
  observacao: string;
}
interface ResultadoEnvio {
  situacao: "autorizada" | "rejeitada" | "denegada" | "pendente" | "erro";
  mensagem: string;
  cStat: string | null;
  xMotivo: string | null;
  protocolo: string | null;
  etapas: Etapa[];
  verificacao: Verificacao | null;
}

/** Consulta pública oficial (Portal Nacional da NF-e) — conferência independente pela chave. */
const PORTAL_NFE = "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=";

const podeEnviar = (status: number, log: number) => status === 1 || ([2, 3, 4].includes(status) && log === 99);

/**
 * Envio à SEFAZ e conferência de uma NF. O envio reproduz o "Envia NFe para Sefaz" do Linx
 * (mesmas procedures, mesmos registros); a conferência consulta a SEFAZ pela Fiscal Flow e
 * compara com o que o Linx gravou.
 */
export default function SefazPainel({
  empresa,
  nota,
  podeGravar,
  onAtualizado,
}: {
  empresa: EmpresaFat;
  nota: NotaDetalhe;
  podeGravar: boolean;
  onAtualizado: () => void;
}) {
  const { send } = useFatApi(empresa);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState<null | "enviar" | "consultar" | "aplicar">(null);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);
  const [verificacao, setVerificacao] = useState<Verificacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const alvo = { filial: nota.filial, nf: nota.nf, serie: nota.serie };

  const enviar = async () => {
    setConfirmando(false);
    setOcupado("enviar");
    setErro(null);
    setResultado(null);
    try {
      const r = await send<ResultadoEnvio>("/notas/enviar", "POST", alvo);
      setResultado(r);
      if (r.verificacao) setVerificacao(r.verificacao);
      onAtualizado();
    } catch (err) {
      setErro((err as Error).message);
      onAtualizado();
    } finally {
      setOcupado(null);
    }
  };

  const consultar = async (aplicar: boolean) => {
    setOcupado(aplicar ? "aplicar" : "consultar");
    setErro(null);
    try {
      setVerificacao(await send<Verificacao>("/notas/verificar", "POST", { ...alvo, aplicar }));
      if (aplicar) onAtualizado();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const copiarChave = async () => {
    try {
      await navigator.clipboard.writeText(nota.chave);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sem permissão de área de transferência */
    }
  };

  const enviavel = !nota.cancelada && nota.chave.length === 44 && podeEnviar(nota.status, nota.logStatus);
  const sefazAutorizouLinxNao =
    verificacao && verificacao.sefazCStat && ["100", "150"].includes(verificacao.sefazCStat) && ![5, 6].includes(verificacao.linxStatus);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>SEFAZ</h3>
        <div className={styles.acoes}>
          {podeGravar && enviavel && (
            <button type="button" className={styles.btnPerigo} onClick={() => setConfirmando(true)} disabled={ocupado !== null}>
              {ocupado === "enviar" ? "Enviando… (até 1 min)" : "Enviar para SEFAZ"}
            </button>
          )}
          {nota.chave.length === 44 && (
            <button type="button" className={styles.btn} onClick={() => consultar(false)} disabled={ocupado !== null}>
              {ocupado === "consultar" ? "Consultando…" : "Consultar na SEFAZ"}
            </button>
          )}
          {nota.chave.length === 44 && (
            <>
              <button type="button" className={`${styles.btnTexto} ${styles.btnMini}`} onClick={copiarChave}>
                {copiado ? "chave copiada ✓" : "copiar chave"}
              </button>
              <a className={`${styles.btnTexto} ${styles.btnMini}`} href={PORTAL_NFE} target="_blank" rel="noreferrer">
                portal da NF-e ↗
              </a>
            </>
          )}
        </div>
      </div>

      {confirmando && (
        <div className={styles.avisoBox}>
          <strong>
            Enviar a NF {nota.nf}/{nota.serie} ({nota.filial}) para a SEFAZ?
          </strong>{" "}
          É o mesmo envio do Monitor do Linx: o XML é gerado pelo Linx, assinado e transmitido pela Fiscal Flow. Se
          autorizada, a NF passa a valer e o Linx lança o contábil/contas a receber.
          <div className={styles.acoes} style={{ marginTop: 8 }}>
            <button type="button" className={styles.btnPerigo} onClick={enviar}>
              Sim, enviar
            </button>
            <button type="button" className={styles.btnTexto} onClick={() => setConfirmando(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {erro && <div className={styles.erroBox}>{erro}</div>}

      {resultado && (
        <div
          className={
            resultado.situacao === "autorizada"
              ? styles.okBox
              : resultado.situacao === "pendente"
                ? styles.avisoBox
                : styles.erroBox
          }
        >
          <strong>
            {resultado.situacao === "autorizada"
              ? `Autorizada — protocolo ${resultado.protocolo}`
              : resultado.situacao === "rejeitada"
                ? "Rejeitada pela SEFAZ"
                : resultado.situacao === "denegada"
                  ? "Uso denegado"
                  : resultado.situacao === "pendente"
                    ? "Sem confirmação ainda"
                    : "Não enviada"}
          </strong>{" "}
          {resultado.mensagem}
          <ul className={styles.lista}>
            {resultado.etapas.map((e, i) => (
              <li key={i}>
                {e.ok ? "✓" : "✗"} {e.etapa}
                {e.detalhe ? <span className={styles.muted}> — {e.detalhe}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {verificacao && (
        <div className={verificacao.confere ? styles.okBox : styles.avisoBox}>
          <strong>Conferência {verificacao.confere ? "OK" : "com divergência"}:</strong> {verificacao.observacao}
          <dl className={styles.kv} style={{ marginTop: 6 }}>
            <dt>SEFAZ agora</dt>
            <dd>
              {verificacao.sefazCStat ?? "—"} {verificacao.sefazMotivo ?? ""}{" "}
              {verificacao.sefazProtocolo ? `· protocolo ${verificacao.sefazProtocolo}` : ""}
            </dd>
            <dt>Linx</dt>
            <dd>
              status {verificacao.linxStatus}/{verificacao.linxLog}
              {verificacao.linxProtocolo ? ` · protocolo ${verificacao.linxProtocolo}` : ""} · XML{" "}
              {verificacao.xmlGuardado ? "guardado" : "não guardado"} · contábil {verificacao.contabilizada ? "lançado" : "não lançado"}
            </dd>
            <dt>Chave</dt>
            <dd className={styles.mono}>{verificacao.chave}</dd>
          </dl>
          {sefazAutorizouLinxNao && podeGravar && (
            <button
              type="button"
              className={`${styles.btnPrimario} ${styles.btnMini}`}
              onClick={() => consultar(true)}
              disabled={ocupado !== null}
            >
              {ocupado === "aplicar" ? "Gravando…" : "Gravar retorno da SEFAZ no Linx"}
            </button>
          )}
        </div>
      )}

      {!resultado && !verificacao && (
        <p className={styles.muted}>
          Depois de enviar, a conferência é automática: o dashboard relê o Linx e consulta a SEFAZ pela Fiscal Flow. Para
          uma conferência independente, copie a chave e consulte no portal da NF-e.
        </p>
      )}
    </div>
  );
}
