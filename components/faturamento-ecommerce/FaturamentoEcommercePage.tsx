"use client";

import { useEffect, useState } from "react";

import { PADROES, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { ClienteFatDetalhe, FatLookups } from "@/lib/faturamento-ecommerce/types";

import { useFatApi } from "./api";
import ClientesAba from "./ClientesAba";
import FaturamentoAba from "./FaturamentoAba";
import MonitorAba from "./MonitorAba";
import styles from "./FaturamentoEcommerce.module.css";

type Aba = "clientes" | "faturamento" | "monitor";

/**
 * Faturamento E-commerce — 3 abas:
 *  Clientes     encontra ou cadastra o cliente do site no Linx
 *  Faturamento  grava a NF (produto acabado) ou encontra uma NF já feita
 *  Monitor      acompanha o status da NF-e (o envio à SEFAZ continua no Monitor do Linx)
 * NERD e Scarf Me são independentes: cada página usa só os padrões e filiais da sua empresa.
 */
export default function FaturamentoEcommercePage({ empresa }: { empresa: EmpresaFat }) {
  const { get, username } = useFatApi(empresa);
  const [aba, setAba] = useState<Aba>("clientes");
  const [lookups, setLookups] = useState<FatLookups | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteFatDetalhe | null>(null);

  useEffect(() => {
    if (!username) return;
    let vivo = true;
    get<FatLookups>("/lookups")
      .then((d) => {
        if (vivo) setLookups(d);
      })
      .catch((e: Error) => {
        if (vivo) setErro(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [get, username]);

  const padrao = PADROES[empresa];
  const podeGravar = Boolean(lookups?.podeGravar);

  const usarCliente = (c: ClienteFatDetalhe) => {
    setCliente(c);
    setAba("faturamento");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Faturamento E-commerce</h1>
          <p className={styles.subtitle}>
            Cadastro do cliente, NF de produto acabado no Linx e acompanhamento da NF-e.
          </p>
        </div>
        <span className={styles.empresaTag}>{padrao.nome}</span>
      </div>

      <div className={styles.tabs} role="tablist">
        {(
          [
            ["clientes", "1. Clientes"],
            ["faturamento", "2. Faturamento"],
            ["monitor", "3. Monitor NF-e"],
          ] as [Aba, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={aba === k}
            className={`${styles.tab} ${aba === k ? styles.tabAtiva : ""}`}
            onClick={() => setAba(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {erro && <div className={styles.erroBox}>Não foi possível carregar as tabelas do Linx: {erro}</div>}
      {lookups && !podeGravar && (
        <div className={styles.infoBox}>Acesso somente leitura: você consulta, mas não grava no Linx.</div>
      )}

      {lookups ? (
        <>
          <div hidden={aba !== "clientes"}>
            <ClientesAba empresa={empresa} lookups={lookups} podeGravar={podeGravar} onUsarCliente={usarCliente} />
          </div>
          <div hidden={aba !== "faturamento"}>
            <FaturamentoAba
              empresa={empresa}
              lookups={lookups}
              podeGravar={podeGravar}
              cliente={cliente}
              onTrocarCliente={setCliente}
              onIrParaClientes={() => setAba("clientes")}
              onIrParaMonitor={() => setAba("monitor")}
            />
          </div>
          <div hidden={aba !== "monitor"}>
            <MonitorAba empresa={empresa} lookups={lookups} ativo={aba === "monitor"} />
          </div>
        </>
      ) : (
        !erro && <div className={styles.vazio}>Carregando tabelas do Linx…</div>
      )}
    </div>
  );
}
