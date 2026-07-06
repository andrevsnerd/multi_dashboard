"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ClienteCorporativoCriado,
  CorporativoLookups,
  OptionItem,
  TipoPessoa,
} from "@/lib/corporativo/types";
import styles from "../corporativo.module.css";

/** UF → macro-região (para preencher REGIAO automaticamente). */
const UF_REGIAO: Record<string, string> = {
  AC: "NORTE", AP: "NORTE", AM: "NORTE", PA: "NORTE", RO: "NORTE", RR: "NORTE", TO: "NORTE",
  AL: "NORDESTE", BA: "NORDESTE", CE: "NORDESTE", MA: "NORDESTE", PB: "NORDESTE", PE: "NORDESTE", PI: "NORDESTE", RN: "NORDESTE", SE: "NORDESTE",
  DF: "CENTRO OESTE", GO: "CENTRO OESTE", MT: "CENTRO OESTE", MS: "CENTRO OESTE",
  ES: "SUDESTE", MG: "SUDESTE", RJ: "SUDESTE", SP: "SUDESTE",
  PR: "SUL", RS: "SUL", SC: "SUL",
};

type EnderecoFields = {
  cep: string; endereco: string; numero: string; complemento: string;
  bairro: string; cidade: string; uf: string; codMunicipioIbge: string;
};

const emptyEndereco: EnderecoFields = {
  cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", codMunicipioIbge: "",
};

interface FormState extends EnderecoFields {
  tipoPessoa: TipoPessoa;
  razaoSocial: string;
  nomeFantasia: string;
  cpfCnpj: string;
  rgIe: string;
  isento: boolean;
  inscricaoMunicipal: string;
  tipoTributacao: string;
  indicadorFiscal: string;
  suframa: string;
  ddd1: string; telefone1: string; ddd2: string; telefone2: string;
  email: string; emailNfe: string; aniversario: string;
  mesmoEnderecoCobranca: boolean;
  mesmoEnderecoEntrega: boolean;
  cobranca: EnderecoFields;
  entrega: EnderecoFields;
  filial: string; condicaoPgto: string; codigoTabPreco: string;
  transportadora: string; regiao: string; conceito: string; tipo: string; pontualidade: string;
  limiteCredito: string; indicadorVenda: string; matrizCliente: string; observacao: string;
}

const initialForm: FormState = {
  ...emptyEndereco,
  tipoPessoa: "PJ",
  razaoSocial: "", nomeFantasia: "", cpfCnpj: "", rgIe: "", isento: true,
  inscricaoMunicipal: "", tipoTributacao: "", indicadorFiscal: "1", suframa: "",
  ddd1: "", telefone1: "", ddd2: "", telefone2: "",
  email: "", emailNfe: "", aniversario: "",
  mesmoEnderecoCobranca: true, mesmoEnderecoEntrega: true,
  cobranca: { ...emptyEndereco }, entrega: { ...emptyEndereco },
  filial: "", condicaoPgto: "", codigoTabPreco: "", transportadora: "", regiao: "",
  conceito: "", tipo: "", pontualidade: "INDEFINIDO",
  limiteCredito: "0", indicadorVenda: "", matrizCliente: "", observacao: "",
};

function pick(options: OptionItem[], prefer: string[]): string {
  for (const p of prefer) {
    const hit = options.find((o) => o.value.toUpperCase() === p.toUpperCase());
    if (hit) return hit.value;
  }
  return options[0]?.value ?? "";
}

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
          condicaoPgto: pick(lk.condicoesPgto, ["01"]),
          codigoTabPreco: pick(lk.tabelasPreco, ["01"]),
          transportadora: pick(lk.transportadoras, ["NOSSO CARRO", "CARRO PROPRIO", "CORREIOS - SEDEX"]),
          conceito: pick(lk.conceitos, ["BOM"]),
          tipo: pick(lk.tipos, ["CORPORATIVO", "ATACADO"]),
          pontualidade: pick(lk.pontualidades, ["INDEFINIDO"]),
          filial: pick(lk.filiais, ["SCARF ME - MATRIZ"]),
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

  // Troca de tipo pessoa: ajusta indicador fiscal e limpa doc.
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

  const docPlaceholder = isPJ ? "00.000.000/0000-00" : "000.000.000-00";
  const cnpjOk = digitsDoc.length === 14;

  const selectOptions = useMemo(() => lookups, [lookups]);

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
            {/* Identificação */}
            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Identificação</h2>
              <p className={styles.sectionHint}>Pessoa Física ou Jurídica. No CNPJ, use “Buscar” para autopreencher.</p>
              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.col4}`}>
                  <span className={styles.label}>Tipo de pessoa</span>
                  <div className={styles.toggleRow}>
                    <button type="button" onClick={() => trocarTipo("PJ")}
                      className={`${styles.toggleBtn} ${isPJ ? styles.toggleBtnActive : ""}`}>Jurídica</button>
                    <button type="button" onClick={() => trocarTipo("PF")}
                      className={`${styles.toggleBtn} ${!isPJ ? styles.toggleBtnActive : ""}`}>Física</button>
                  </div>
                </div>

                <div className={`${styles.field} ${styles.col8}`}>
                  <span className={styles.label}>{isPJ ? "CNPJ" : "CPF"} <span className={styles.req}>*</span></span>
                  <div className={styles.inputRow}>
                    <input className={styles.input} value={form.cpfCnpj} placeholder={docPlaceholder}
                      inputMode="numeric"
                      onChange={(e) => set("cpfCnpj", e.target.value)} />
                    {isPJ && (
                      <button type="button" className={`${styles.btn}`} disabled={!cnpjOk || buscandoCnpj}
                        onClick={buscarCnpj}>
                        {buscandoCnpj ? "Buscando…" : "Buscar CNPJ"}
                      </button>
                    )}
                  </div>
                </div>

                <div className={`${styles.field} ${styles.col8}`}>
                  <span className={styles.label}>{isPJ ? "Razão social" : "Nome completo"} <span className={styles.req}>*</span></span>
                  <input className={styles.input} value={form.razaoSocial} maxLength={90}
                    onChange={(e) => set("razaoSocial", e.target.value)} />
                </div>

                <div className={`${styles.field} ${styles.col4}`}>
                  <span className={styles.label}>Nome no sistema <span className={styles.opt}>(máx 25)</span></span>
                  <input className={styles.input} value={form.nomeFantasia} maxLength={25}
                    placeholder={isPJ ? "Nome fantasia" : "(usa o nome)"}
                    onChange={(e) => set("nomeFantasia", e.target.value)} />
                </div>

                <div className={`${styles.field} ${styles.col4}`}>
                  <span className={styles.label}>{isPJ ? "Inscrição Estadual" : "RG"}</span>
                  <input className={styles.input} value={form.isento ? "" : form.rgIe} maxLength={19}
                    disabled={form.isento} placeholder={form.isento ? "ISENTO" : ""}
                    onChange={(e) => set("rgIe", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col2}`} style={{ justifyContent: "flex-end" }}>
                  <label className={styles.checkboxRow}>
                    <input type="checkbox" checked={form.isento} onChange={(e) => set("isento", e.target.checked)} />
                    Isento
                  </label>
                </div>

                <div className={`${styles.field} ${styles.col3}`}>
                  <span className={styles.label}>Indica Tipo (fiscal)</span>
                  <select className={styles.select} value={form.indicadorFiscal}
                    onChange={(e) => set("indicadorFiscal", e.target.value)}>
                    {selectOptions?.indicadoresFiscais.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {isPJ && (
                  <>
                    <div className={`${styles.field} ${styles.col3}`}>
                      <span className={styles.label}>Tipo tributação</span>
                      <select className={styles.select} value={form.tipoTributacao}
                        onChange={(e) => set("tipoTributacao", e.target.value)}>
                        <option value="">—</option>
                        {selectOptions?.tiposTributacao.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className={`${styles.field} ${styles.col3}`}>
                      <span className={styles.label}>Inscrição Municipal <span className={styles.opt}>(opc.)</span></span>
                      <input className={styles.input} value={form.inscricaoMunicipal} maxLength={15}
                        onChange={(e) => set("inscricaoMunicipal", e.target.value)} />
                    </div>
                    <div className={`${styles.field} ${styles.col3}`}>
                      <span className={styles.label}>SUFRAMA <span className={styles.opt}>(opc.)</span></span>
                      <input className={styles.input} value={form.suframa} maxLength={9}
                        onChange={(e) => set("suframa", e.target.value)} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Endereço */}
            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Endereço principal</h2>
              <p className={styles.sectionHint}>Preencha o CEP e clique em “Buscar” para completar (traz o código IBGE p/ NF-e).</p>
              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.col3}`}>
                  <span className={styles.label}>CEP <span className={styles.req}>*</span></span>
                  <div className={styles.inputRow}>
                    <input className={styles.input} value={form.cep} inputMode="numeric" maxLength={9}
                      onChange={(e) => set("cep", e.target.value)}
                      onBlur={() => buscarCep("principal")} />
                    <button type="button" className={styles.btn} disabled={buscandoCep === "principal"}
                      onClick={() => buscarCep("principal")}>
                      {buscandoCep === "principal" ? "…" : "Buscar"}
                    </button>
                  </div>
                </div>
                <div className={`${styles.field} ${styles.col7}`}>
                  <span className={styles.label}>Endereço <span className={styles.req}>*</span></span>
                  <input className={styles.input} value={form.endereco} maxLength={90}
                    onChange={(e) => set("endereco", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col2}`}>
                  <span className={styles.label}>Número</span>
                  <input className={styles.input} value={form.numero} maxLength={10}
                    onChange={(e) => set("numero", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col4}`}>
                  <span className={styles.label}>Complemento</span>
                  <input className={styles.input} value={form.complemento} maxLength={60}
                    onChange={(e) => set("complemento", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col4}`}>
                  <span className={styles.label}>Bairro</span>
                  <input className={styles.input} value={form.bairro} maxLength={25}
                    onChange={(e) => set("bairro", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col3}`}>
                  <span className={styles.label}>Cidade <span className={styles.req}>*</span></span>
                  <input className={styles.input} value={form.cidade} maxLength={35}
                    onChange={(e) => set("cidade", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col2}`}>
                  <span className={styles.label}>UF <span className={styles.req}>*</span></span>
                  <input className={styles.input} value={form.uf} maxLength={2}
                    onChange={(e) => {
                      const uf = e.target.value.toUpperCase();
                      setForm((f) => ({ ...f, uf, regiao: UF_REGIAO[uf] ?? f.regiao }));
                    }} />
                </div>
                <div className={`${styles.field} ${styles.col3}`}>
                  <span className={styles.label}>Cód. IBGE <span className={styles.req}>*</span></span>
                  <input className={styles.input} value={form.codMunicipioIbge} maxLength={10}
                    onChange={(e) => set("codMunicipioIbge", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Contato */}
            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Contato</h2>
              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.col2}`}>
                  <span className={styles.label}>DDD <span className={styles.req}>*</span></span>
                  <input className={styles.input} value={form.ddd1} inputMode="numeric" maxLength={5}
                    onChange={(e) => set("ddd1", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col4}`}>
                  <span className={styles.label}>Telefone <span className={styles.req}>*</span></span>
                  <input className={styles.input} value={form.telefone1} inputMode="numeric" maxLength={10}
                    onChange={(e) => set("telefone1", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col2}`}>
                  <span className={styles.label}>DDD 2 <span className={styles.opt}>(opc.)</span></span>
                  <input className={styles.input} value={form.ddd2} inputMode="numeric" maxLength={5}
                    onChange={(e) => set("ddd2", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col4}`}>
                  <span className={styles.label}>Telefone 2 <span className={styles.opt}>(opc.)</span></span>
                  <input className={styles.input} value={form.telefone2} inputMode="numeric" maxLength={10}
                    onChange={(e) => set("telefone2", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col5}`}>
                  <span className={styles.label}>E-mail</span>
                  <input className={styles.input} value={form.email} maxLength={100} type="email"
                    onChange={(e) => set("email", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col5}`}>
                  <span className={styles.label}>E-mail NF-e</span>
                  <input className={styles.input} value={form.emailNfe} maxLength={100} type="email"
                    onChange={(e) => set("emailNfe", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col2}`}>
                  <span className={styles.label}>Aniversário <span className={styles.opt}>(opc.)</span></span>
                  <input className={styles.input} value={form.aniversario} type="date"
                    onChange={(e) => set("aniversario", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Cobrança / Entrega */}
            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Cobrança e entrega</h2>
              <p className={styles.sectionHint}>Por padrão espelham o endereço principal. Desmarque para informar endereços diferentes.</p>
              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.col6}`}>
                  <label className={styles.checkboxRow}>
                    <input type="checkbox" checked={form.mesmoEnderecoCobranca}
                      onChange={(e) => set("mesmoEnderecoCobranca", e.target.checked)} />
                    Cobrança usa o endereço principal
                  </label>
                </div>
                <div className={`${styles.field} ${styles.col6}`}>
                  <label className={styles.checkboxRow}>
                    <input type="checkbox" checked={form.mesmoEnderecoEntrega}
                      onChange={(e) => set("mesmoEnderecoEntrega", e.target.checked)} />
                    Entrega usa o endereço principal
                  </label>
                </div>
              </div>

              {!form.mesmoEnderecoCobranca && (
                <EnderecoSubForm titulo="Endereço de cobrança" bloco="cobranca" data={form.cobranca}
                  onChange={(k, v) => setEnd("cobranca", k, v)}
                  onBuscar={() => buscarCep("cobranca")} buscando={buscandoCep === "cobranca"} />
              )}
              {!form.mesmoEnderecoEntrega && (
                <EnderecoSubForm titulo="Endereço de entrega" bloco="entrega" data={form.entrega}
                  onChange={(k, v) => setEnd("entrega", k, v)}
                  onBuscar={() => buscarCep("entrega")} buscando={buscandoCep === "entrega"} />
              )}
            </div>

            {/* Comercial */}
            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Dados comerciais</h2>
              <div className={styles.grid}>
                <SelectField className={styles.col4} label="Filial" required value={form.filial}
                  options={selectOptions?.filiais ?? []} onChange={(v) => set("filial", v)} />
                <SelectField className={styles.col4} label="Condição de pagamento" value={form.condicaoPgto}
                  options={selectOptions?.condicoesPgto ?? []} onChange={(v) => set("condicaoPgto", v)} />
                <SelectField className={styles.col4} label="Tabela de preços" value={form.codigoTabPreco}
                  options={selectOptions?.tabelasPreco ?? []} onChange={(v) => set("codigoTabPreco", v)} />
                <SelectField className={styles.col4} label="Transportadora" value={form.transportadora}
                  options={selectOptions?.transportadoras ?? []} onChange={(v) => set("transportadora", v)} />
                <SelectField className={styles.col4} label="Região" value={form.regiao}
                  options={selectOptions?.regioes ?? []} onChange={(v) => set("regiao", v)} />
                <SelectField className={styles.col4} label="Tipo" value={form.tipo}
                  options={selectOptions?.tipos ?? []} onChange={(v) => set("tipo", v)} />
                <SelectField className={styles.col4} label="Conceito" value={form.conceito}
                  options={selectOptions?.conceitos ?? []} onChange={(v) => set("conceito", v)} />
                <SelectField className={styles.col4} label="Pontualidade" value={form.pontualidade}
                  options={selectOptions?.pontualidades ?? []} onChange={(v) => set("pontualidade", v)} />
                <div className={`${styles.field} ${styles.col4}`}>
                  <span className={styles.label}>Limite de crédito</span>
                  <input className={styles.input} value={form.limiteCredito} inputMode="decimal"
                    onChange={(e) => set("limiteCredito", e.target.value)} />
                </div>
                <div className={`${styles.field} ${styles.col12}`}>
                  <span className={styles.label}>Observação de faturamento <span className={styles.opt}>(opc.)</span></span>
                  <textarea className={styles.textarea} value={form.observacao} maxLength={4000}
                    onChange={(e) => set("observacao", e.target.value)} />
                </div>
              </div>
            </div>

            <div className={styles.footerBar}>
              <div className={styles.codePreview}>
                Próximo código: <strong>{selectOptions?.proximoCodigoPreview || "—"}</strong>
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

function SelectField({
  label, value, options, onChange, className, required,
}: {
  label: string;
  value: string;
  options: OptionItem[];
  onChange: (v: string) => void;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`${styles.field} ${className ?? ""}`}>
      <span className={styles.label}>{label} {required && <span className={styles.req}>*</span>}</span>
      <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {!options.some((o) => o.value === value) && <option value="">—</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function EnderecoSubForm({
  titulo, data, onChange, onBuscar, buscando,
}: {
  titulo: string;
  bloco: "cobranca" | "entrega";
  data: EnderecoFields;
  onChange: (key: keyof EnderecoFields, value: string) => void;
  onBuscar: () => void;
  buscando: boolean;
}) {
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--b-300)" }}>
      <h3 className={styles.label} style={{ marginBottom: 12 }}>{titulo}</h3>
      <div className={styles.grid}>
        <div className={`${styles.field} ${styles.col3}`}>
          <span className={styles.label}>CEP</span>
          <div className={styles.inputRow}>
            <input className={styles.input} value={data.cep} inputMode="numeric" maxLength={9}
              onChange={(e) => onChange("cep", e.target.value)} onBlur={onBuscar} />
            <button type="button" className={styles.btn} disabled={buscando} onClick={onBuscar}>
              {buscando ? "…" : "Buscar"}
            </button>
          </div>
        </div>
        <div className={`${styles.field} ${styles.col7}`}>
          <span className={styles.label}>Endereço</span>
          <input className={styles.input} value={data.endereco} maxLength={90}
            onChange={(e) => onChange("endereco", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col2}`}>
          <span className={styles.label}>Número</span>
          <input className={styles.input} value={data.numero} maxLength={10}
            onChange={(e) => onChange("numero", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col4}`}>
          <span className={styles.label}>Complemento</span>
          <input className={styles.input} value={data.complemento} maxLength={60}
            onChange={(e) => onChange("complemento", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col4}`}>
          <span className={styles.label}>Bairro</span>
          <input className={styles.input} value={data.bairro} maxLength={25}
            onChange={(e) => onChange("bairro", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col2}`}>
          <span className={styles.label}>Cidade</span>
          <input className={styles.input} value={data.cidade} maxLength={35}
            onChange={(e) => onChange("cidade", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col2}`}>
          <span className={styles.label}>UF</span>
          <input className={styles.input} value={data.uf} maxLength={2}
            onChange={(e) => onChange("uf", e.target.value.toUpperCase())} />
        </div>
      </div>
    </div>
  );
}
