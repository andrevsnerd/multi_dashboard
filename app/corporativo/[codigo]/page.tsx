"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ClienteCorporativoDetalhe } from "@/lib/corporativo/types";
import styles from "../corporativo.module.css";

function fmtDoc(doc: string, isPJ: boolean): string {
  const d = (doc || "").replace(/\D/g, "");
  if (isPJ && d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (!isPJ && d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc;
}
function fmtCep(cep: string): string {
  const d = (cep || "").replace(/\D/g, "");
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, "$1-$2") : cep;
}
function fmtTelefone(ddd: string, tel: string): string {
  if (!ddd && !tel) return "";
  return `(${ddd || "--"}) ${tel || "—"}`;
}
function fmtMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtData(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR");
}
/** Cadastros antigos no Linx usam sequências de 9s/0s como "não informado" (ex.: RG_IE). */
function fmtRgIe(value: string): string {
  const v = (value || "").trim();
  if (!v || /^(9+|0+)$/.test(v)) return "";
  return v;
}

function View({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const empty = !value || !value.trim();
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={`${styles.viewValue} ${empty ? styles.viewValueEmpty : ""}`}>
        {empty ? "—" : value}
      </div>
      {hint && <span className={styles.viewHint}>{hint}</span>}
    </div>
  );
}

export default function DetalheClienteCorporativoPage() {
  const params = useParams<{ codigo: string }>();
  const codigo = params?.codigo ?? "";
  const [data, setData] = useState<ClienteCorporativoDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!codigo) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/corporativo/clientes/${codigo}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Cliente não encontrado.");
        setData(json.data as ClienteCorporativoDetalhe);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar cliente.");
      } finally {
        setLoading(false);
      }
    })();
  }, [codigo]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>Corporativo</div>
            <h1 className={styles.title}>
              {data ? data.nomeClifor : "Cliente"} {data && <span className={styles.pill}>{data.codigo}</span>}
            </h1>
            <p className={styles.subtitle}>
              {data ? `Como este cliente está cadastrado no Linx.` : "Carregando cadastro…"}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/corporativo" className={styles.linkBack}>← Voltar para a lista</Link>
          </div>
        </div>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}
        {loading && <div className={styles.card}><p className={styles.muted}>Carregando…</p></div>}

        {data && (
          <>
            <div className={styles.card}>
              <div className={styles.statGrid}>
                <div className={styles.statBox}>
                  <div className={styles.statLabel}>Código</div>
                  <div className={styles.statValue}>{data.codigo}</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statLabel}>Tipo pessoa</div>
                  <div className={styles.statValue}>{data.tipoPessoa === "PJ" ? "Jurídica" : "Física"}</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statLabel}>Cadastrado em</div>
                  <div className={styles.statValue}>{fmtData(data.cadastramento) || "—"}</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statLabel}>Situação</div>
                  <div className={styles.statValue}>
                    {data.inativo ? <span className={styles.pillNeutral}>Inativo</span> : <span className={styles.pill}>Ativo</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Identificação</h2>
              <div className={styles.grid}>
                <View label={data.tipoPessoa === "PJ" ? "Razão social" : "Nome completo"} value={data.razaoSocial} />
                <View label="Nome no sistema" value={data.nomeClifor} hint="NOME_CLIFOR — chave única do cadastro no Linx" />
                <View label={data.tipoPessoa === "PJ" ? "CNPJ" : "CPF"} value={fmtDoc(data.cpfCnpj, data.tipoPessoa === "PJ")} />
                <View label={data.tipoPessoa === "PJ" ? "Inscrição Estadual" : "RG"} value={fmtRgIe(data.rgIe)} hint={fmtRgIe(data.rgIe) ? undefined : "Não informado no cadastro original"} />
                <View label="Indica Tipo (fiscal)" value={data.indicadorFiscal} />
                {data.tipoPessoa === "PJ" && <View label="Tipo tributação" value={data.tipoTributacao} />}
                {data.tipoPessoa === "PJ" && <View label="Inscrição Municipal" value={data.inscricaoMunicipal} />}
                {data.tipoPessoa === "PJ" && <View label="SUFRAMA" value={data.suframa} />}
              </div>
            </div>

            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Endereço principal</h2>
              <div className={styles.grid}>
                <View label="CEP" value={fmtCep(data.endereco.cep)} />
                <View label="Endereço" value={`${data.endereco.endereco}${data.endereco.numero ? `, ${data.endereco.numero}` : ""}`} />
                <View label="Complemento" value={data.endereco.complemento ?? ""} />
                <View label="Bairro" value={data.endereco.bairro} />
                <View label="Cidade" value={data.endereco.cidade} />
                <View label="UF" value={data.endereco.uf} />
                <View label="Código IBGE" value={data.endereco.codMunicipioIbge} hint="Usado na emissão de NF-e" />
              </div>
            </div>

            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Contato</h2>
              <div className={styles.grid}>
                <View label="Telefone" value={fmtTelefone(data.ddd1, data.telefone1)} />
                {(data.ddd2 || data.telefone2) && <View label="Telefone 2" value={fmtTelefone(data.ddd2, data.telefone2)} />}
                <View label="E-mail" value={data.email} />
                <View label="E-mail NF-e" value={data.emailNfe} />
              </div>
            </div>

            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Cobrança e entrega</h2>
              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.col6}`}>
                  <span className={styles.label}>Cobrança</span>
                  <div className={styles.viewValue}>
                    {data.enderecoCobrancaIgual ? (
                      <span className={styles.pillNeutral}>Mesmo endereço principal</span>
                    ) : (
                      `${data.cobranca.endereco}, ${data.cobranca.numero} — ${data.cobranca.cidade}/${data.cobranca.uf}`
                    )}
                  </div>
                </div>
                <div className={`${styles.field} ${styles.col6}`}>
                  <span className={styles.label}>Entrega</span>
                  <div className={styles.viewValue}>
                    {data.enderecoEntregaIgual ? (
                      <span className={styles.pillNeutral}>Mesmo endereço principal</span>
                    ) : (
                      `${data.entrega.endereco}, ${data.entrega.numero} — ${data.entrega.cidade}/${data.entrega.uf}`
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Dados comerciais</h2>
              <p className={styles.sectionHint}>
                É a camada &ldquo;CLIENTES_ATACADO&rdquo; — controla como esse cliente compra: onde ele compra, em
                quanto tempo paga, com que preço, com quem manda a mercadoria e como o Linx classifica a relação.
              </p>
              <div className={styles.grid}>
                <View label="Filial" value={data.filial} hint="Onde o cliente está cadastrado / compra" />
                <View
                  label="Condição de pagamento"
                  value={data.condicaoPgto ? `${data.condicaoPgto} - ${data.condicaoPgtoDescricao}` : ""}
                  hint="Prazo/forma de pagamento das compras (ex.: 30 dias, cartão 3x)"
                />
                <View
                  label="Tabela de preços"
                  value={data.codigoTabPreco ? `${data.codigoTabPreco} - ${data.codigoTabPrecoDescricao}` : ""}
                  hint="Qual tabela de preço é usada quando ele compra"
                />
                <View label="Transportadora" value={data.transportadora} hint="Quem leva a mercadoria até ele" />
                <View label="Região" value={data.regiao} hint="Macro-região (derivada da UF)" />
                <View label="Tipo" value={data.tipo} hint="Classificação comercial (Atacado, Corporativo, Web…)" />
                <View label="Conceito" value={data.conceito} hint="Avaliação de relacionamento (começa 'Bom')" />
                <View label="Pontualidade" value={data.pontualidade} hint="Calculada pelo Linx pelo histórico de pagamento" />
                <View label="Limite de crédito" value={fmtMoeda(data.limiteCredito)} />
                <View label="Indicador de venda" value={data.indicadorVenda || "—"} hint="'V' = venda direta" />
                <View label="Matriz do cliente" value={data.matrizCliente} hint="Agrupamento comercial (normalmente = próprio nome)" />
                {data.observacao && (
                  <div className={`${styles.field} ${styles.col12}`}>
                    <span className={styles.label}>Observação de faturamento</span>
                    <div className={styles.viewValue}>{data.observacao}</div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
