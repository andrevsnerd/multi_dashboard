"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ClienteCorporativoCriado, CorporativoLookups, TipoPessoa } from "@/lib/corporativo/types";
import { ClienteCorporativoForm } from "../_components/ClienteCorporativoForm";
import { initialForm, pickOption, UF_REGIAO, type EnderecoFields, type FormState } from "../_components/formTypes";
import styles from "../corporativo.module.css";

export default function NovoClienteCorporativoPage() {
  const [lookups, setLookups] = useState<CorporativoLookups | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState<"principal" | "cobranca" | "entrega" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [criado, setCriado] = useState<ClienteCorporativoCriado | null>(null);

  const isPJ = form.tipoPessoa === "PJ";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/corporativo/lookups");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erro ao carregar formulário.");
        const lk: CorporativoLookups = json.data;
        setLookups(lk);
        setForm((f) => ({
          ...f,
          condicaoPgto: pickOption(lk.condicoesPgto, ["01"]),
          codigoTabPreco: pickOption(lk.tabelasPreco, ["01"]),
          transportadora: pickOption(lk.transportadoras, ["NOSSO CARRO", "CARRO PROPRIO", "CORREIOS - SEDEX"]),
          conceito: pickOption(lk.conceitos, ["BOM"]),
          tipo: pickOption(lk.tipos, ["CORPORATIVO", "ATACADO"]),
          pontualidade: pickOption(lk.pontualidades, ["INDEFINIDO"]),
          filial: pickOption(lk.filiais, ["SCARF ME - MATRIZ"]),
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar formulário.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const setEnd = useCallback(
    (bloco: "cobranca" | "entrega", key: keyof EnderecoFields, value: string) => {
      setForm((f) => ({ ...f, [bloco]: { ...f[bloco], [key]: value } }));
    },
    []
  );

  function trocarTipo(tp: TipoPessoa) {
    setForm((f) => ({
      ...f,
      tipoPessoa: tp,
      indicadorFiscal: tp === "PJ" ? "1" : "8",
      isento: tp === "PF" ? true : f.isento,
    }));
  }

  const digitsDoc = form.cpfCnpj.replace(/\D/g, "");

  async function buscarCnpj() {
    if (digitsDoc.length !== 14) return;
    setBuscandoCnpj(true);
    setError(null);
    try {
      const res = await fetch(`/api/corporativo/cnpj/${digitsDoc}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "CNPJ não encontrado.");
      const d = json.data;
      setForm((f) => ({
        ...f,
        razaoSocial: d.razaoSocial || f.razaoSocial,
        nomeFantasia: d.nomeFantasia || f.nomeFantasia,
        cep: d.cep || f.cep,
        endereco: d.endereco || f.endereco,
        numero: d.numero || f.numero,
        complemento: d.complemento || f.complemento,
        bairro: d.bairro || f.bairro,
        cidade: d.cidade || f.cidade,
        uf: d.uf || f.uf,
        regiao: d.uf && UF_REGIAO[d.uf] ? UF_REGIAO[d.uf] : f.regiao,
        ddd1: d.ddd1 || f.ddd1,
        telefone1: d.telefone1 || f.telefone1,
        email: d.email || f.email,
        emailNfe: f.emailNfe || d.email || "",
      }));
      if (d.cep) await buscarCep("principal", d.cep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar CNPJ.");
    } finally {
      setBuscandoCnpj(false);
    }
  }

  async function buscarCep(target: "principal" | "cobranca" | "entrega", cepValue?: string) {
    const raw = (cepValue ?? (target === "principal" ? form.cep : form[target].cep)).replace(/\D/g, "");
    if (raw.length !== 8) return;
    setBuscandoCep(target);
    try {
      const res = await fetch(`/api/corporativo/cep/${raw}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "CEP não encontrado.");
      const d = json.data;
      if (target === "principal") {
        setForm((f) => ({
          ...f,
          cep: raw,
          endereco: d.endereco || f.endereco,
          bairro: d.bairro || f.bairro,
          cidade: d.cidade || f.cidade,
          uf: d.uf || f.uf,
          regiao: d.uf && UF_REGIAO[d.uf] ? UF_REGIAO[d.uf] : f.regiao,
          codMunicipioIbge: d.codMunicipioIbge || f.codMunicipioIbge,
          ddd1: f.ddd1 || d.ddd || "",
        }));
      } else {
        setForm((f) => ({
          ...f,
          [target]: {
            ...f[target],
            cep: raw,
            endereco: d.endereco || f[target].endereco,
            bairro: d.bairro || f[target].bairro,
            cidade: d.cidade || f[target].cidade,
            uf: d.uf || f[target].uf,
            codMunicipioIbge: d.codMunicipioIbge || f[target].codMunicipioIbge,
          },
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar CEP.");
    } finally {
      setBuscandoCep(null);
    }
  }

  function validar(): string | null {
    if (!form.razaoSocial.trim()) return isPJ ? "Informe a razão social." : "Informe o nome completo.";
    if (isPJ && digitsDoc.length !== 14) return "CNPJ deve ter 14 dígitos.";
    if (!isPJ && digitsDoc.length !== 11) return "CPF deve ter 11 dígitos.";
    if (!form.cep.replace(/\D/g, "")) return "Informe o CEP.";
    if (!form.endereco.trim()) return "Informe o endereço.";
    if (!form.cidade.trim()) return "Informe a cidade.";
    if (!form.uf.trim()) return "Informe a UF.";
    if (!form.codMunicipioIbge.trim()) return "Código IBGE ausente — busque pelo CEP para preenchê-lo.";
    if (!form.ddd1.replace(/\D/g, "") || !form.telefone1.replace(/\D/g, "")) return "Informe DDD e telefone.";
    if (!form.filial) return "Selecione a filial.";
    return null;
  }

  function buildPayload(forcar: boolean) {
    return {
      tipoPessoa: form.tipoPessoa,
      razaoSocial: form.razaoSocial,
      nomeFantasia: form.nomeFantasia,
      cpfCnpj: digitsDoc,
      rgIe: form.isento && !isPJ ? "ISENTO" : form.rgIe,
      inscricaoMunicipal: form.inscricaoMunicipal,
      tipoTributacao: isPJ ? form.tipoTributacao : "",
      indicadorFiscal: Number(form.indicadorFiscal),
      suframa: form.suframa,
      cep: form.cep, endereco: form.endereco, numero: form.numero, complemento: form.complemento,
      bairro: form.bairro, cidade: form.cidade, uf: form.uf, codMunicipioIbge: form.codMunicipioIbge,
      pais: "BRASIL",
      ddd1: form.ddd1, telefone1: form.telefone1, ddd2: form.ddd2, telefone2: form.telefone2,
      email: form.email, emailNfe: form.emailNfe, aniversario: form.aniversario,
      mesmoEnderecoCobranca: form.mesmoEnderecoCobranca,
      mesmoEnderecoEntrega: form.mesmoEnderecoEntrega,
      cobranca: { ...form.cobranca, pais: "BRASIL" },
      entrega: { ...form.entrega, pais: "BRASIL" },
      filial: form.filial, condicaoPgto: form.condicaoPgto, codigoTabPreco: form.codigoTabPreco,
      transportadora: form.transportadora, regiao: form.regiao, conceito: form.conceito,
      tipo: form.tipo, pontualidade: form.pontualidade,
      limiteCredito: Number(form.limiteCredito) || 0,
      indicadorVenda: form.indicadorVenda, matrizCliente: form.matrizCliente, observacao: form.observacao,
      forcar,
    };
  }

  async function salvar(forcar = false) {
    setError(null);
    setWarn(null);
    const v = validar();
    if (v) {
      setError(v);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/corporativo/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(forcar)),
      });
      const json = await res.json();
      if (res.status === 409 && json.error === "duplicado") {
        setWarn(
          `${json.message} Deseja cadastrar mesmo assim? Clique em "Cadastrar mesmo assim".`
        );
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error(json.error || "Erro ao cadastrar.");
      setCriado(json.data as ClienteCorporativoCriado);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao cadastrar.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  function novoCadastro() {
    setCriado(null);
    setWarn(null);
    setError(null);
    setForm((f) => ({
      ...initialForm,
      tipoPessoa: f.tipoPessoa,
      indicadorFiscal: f.indicadorFiscal,
      condicaoPgto: f.condicaoPgto,
      codigoTabPreco: f.codigoTabPreco,
      transportadora: f.transportadora,
      conceito: f.conceito,
      tipo: f.tipo,
      pontualidade: f.pontualidade,
      filial: f.filial,
    }));
  }

  if (criado) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.card}>
            <div className={styles.successBox}>
              <div className={styles.eyebrow}>Cliente cadastrado no Linx</div>
              <div className={styles.successCode}>{criado.codigo}</div>
              <p className={styles.subtitle}>
                {criado.nomeClifor} — {criado.razaoSocial}
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={novoCadastro}>
                  Cadastrar outro
                </button>
                <Link href={`/corporativo/${criado.codigo}`} className={styles.btn}>
                  Ver cadastro completo
                </Link>
                <Link href="/corporativo" className={styles.btn}>
                  Ver lista de clientes
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>Corporativo</div>
            <h1 className={styles.title}>Novo cliente corporativo</h1>
            <p className={styles.subtitle}>Cadastro gravado diretamente no Linx (atacado).</p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/corporativo" className={styles.linkBack}>← Voltar para a lista</Link>
          </div>
        </div>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}
        {warn && <div className={`${styles.alert} ${styles.alertWarn}`}>{warn}</div>}

        {loading ? (
          <div className={styles.card}><p className={styles.muted}>Carregando formulário…</p></div>
        ) : (
          <>
            <ClienteCorporativoForm
              form={form}
              options={lookups ?? EMPTY_OPTIONS}
              onTipoChange={trocarTipo}
              setField={set}
              setEnderecoField={setEnd}
              onBuscarCnpj={buscarCnpj}
              buscandoCnpj={buscandoCnpj}
              onBuscarCep={buscarCep}
              buscandoCep={buscandoCep}
            />

            <div className={styles.footerBar}>
              <div className={styles.codePreview}>
                Próximo código: <strong>{lookups?.proximoCodigoPreview || "—"}</strong>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {warn ? (
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                    onClick={() => salvar(true)}>
                    {saving ? "Cadastrando…" : "Cadastrar mesmo assim"}
                  </button>
                ) : (
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                    onClick={() => salvar(false)}>
                    {saving ? "Cadastrando…" : "Cadastrar cliente"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const EMPTY_OPTIONS: CorporativoLookups = {
  condicoesPgto: [], tabelasPreco: [], transportadoras: [], regioes: [], conceitos: [],
  pontualidades: [], tipos: [], tiposTributacao: [], indicadoresFiscais: [], filiais: [],
  proximoCodigoPreview: "",
};
