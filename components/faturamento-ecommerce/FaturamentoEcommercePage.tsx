"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import { canAccessCompany } from "@/lib/auth/permissions";
import { EMPRESAS_FAT, PADROES, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { ClienteFatDetalhe, FatLookups, PedidoShopifyImport } from "@/lib/faturamento-ecommerce/types";

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
  const { user } = useAuth();
  // Quem fatura as duas empresas troca daqui; quem só tem uma vê só a etiqueta dela.
  const empresasDoUsuario = EMPRESAS_FAT.filter((e) => canAccessCompany(user, e));
  const [aba, setAba] = useState<Aba>("clientes");
  const [lookups, setLookups] = useState<FatLookups | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteFatDetalhe | null>(null);
  const [pedido, setPedido] = useState<PedidoShopifyImport | null>(null);

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

  /** Pedido importado na aba Clientes: o cliente é escolhido/cadastrado lá. */
  const pedidoImportado = (p: PedidoShopifyImport) => {
    setPedido(p);
    setCliente(null);
  };

  /**
   * Pedido importado direto na aba Faturamento: se o CPF bate com um único cadastro
   * (preferindo o da própria empresa) e o endereço é o mesmo, já seleciona o cliente;
   * senão manda para a aba Clientes escolher, atualizar o endereço ou cadastrar.
   */
  const importarNoFaturamento = async (nome: string) => {
    const p = await get<PedidoShopifyImport>("/shopify/pedido", { nome, filial: lookups?.filialNotaPadrao });
    setPedido(p);
    const fortes = p.candidatos.filter((c) => c.forte);
    const daEmpresa = fortes.filter((c) => c.filial === padrao.cliente.filial);
    const escolhido = daEmpresa.length === 1 ? daEmpresa[0] : fortes.length === 1 ? fortes[0] : null;
    if (escolhido && !escolhido.enderecoDifere) {
      setCliente(await get<ClienteFatDetalhe>(`/clientes/${escolhido.codigo}`));
      return;
    }
    setCliente(null);
    setAba("clientes");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const descartarPedido = () => setPedido(null);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Faturamento E-commerce</h1>
          <p className={styles.subtitle}>
            Cadastro do cliente, NF de produto acabado no Linx e acompanhamento da NF-e.
          </p>
        </div>
        {empresasDoUsuario.length > 1 ? (
          <div className={styles.empresaSwitch} role="group" aria-label="Empresa que vai faturar">
            {empresasDoUsuario.map((e) =>
              e === empresa ? (
                <span key={e} className={`${styles.empresaTag} ${styles.empresaTagAtiva}`} aria-current="page">
                  {PADROES[e].nome}
                </span>
              ) : (
                <Link key={e} href={`/${e}/faturamento-ecommerce`} className={styles.empresaTag}>
                  {PADROES[e].nome}
                </Link>
              )
            )}
          </div>
        ) : (
          <span className={styles.empresaTag}>{padrao.nome}</span>
        )}
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
            <ClientesAba
              empresa={empresa}
              lookups={lookups}
              podeGravar={podeGravar}
              onUsarCliente={usarCliente}
              pedido={pedido}
              onPedidoImportado={pedidoImportado}
              onDescartarPedido={descartarPedido}
            />
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
              pedido={pedido}
              onImportarPedido={importarNoFaturamento}
              onDescartarPedido={descartarPedido}
              onNotaGravada={() => setPedido(null)}
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
