"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import type { RegistroPublicoInput, TipoPessoa } from "@/lib/corporativo/types";
import { regiaoFromUf } from "@/lib/corporativo/regioes";
import corp from "../corporativo/corporativo.module.css";
import styles from "./cadastro.module.css";

interface CadastroState {
  tipoPessoa: TipoPessoa;
  razaoSocial: string;
  cpfCnpj: string;
  inscricaoEstadual: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  codMunicipioIbge: string;
  ddd1: string;
  telefone1: string;
  email: string;
  username: string;
  password: string;
  password2: string;
}

const initial: CadastroState = {
  tipoPessoa: "PJ",
  razaoSocial: "",
  cpfCnpj: "",
  inscricaoEstadual: "",
  cep: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  codMunicipioIbge: "",
  ddd1: "",
  telefone1: "",
  email: "",
  username: "",
  password: "",
  password2: "",
};

export default function CadastroPublicoPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState<CadastroState>(initial);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isPJ = form.tipoPessoa === "PJ";
  const digitsDoc = form.cpfCnpj.replace(/\D/g, "");

  const set = useCallback(<K extends keyof CadastroState>(key: K, value: CadastroState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  function trocarTipo(tp: TipoPessoa) {
    setForm((f) => ({ ...f, tipoPessoa: tp }));
  }

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
        cep: d.cep || f.cep,
        endereco: d.endereco || f.endereco,
        numero: d.numero || f.numero,
        complemento: d.complemento || f.complemento,
        bairro: d.bairro || f.bairro,
        cidade: d.cidade || f.cidade,
        uf: d.uf || f.uf,
        ddd1: d.ddd1 || f.ddd1,
        telefone1: d.telefone1 || f.telefone1,
        email: f.email || d.email || "",
      }));
      if (d.cep) await buscarCep(d.cep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar CNPJ.");
    } finally {
      setBuscandoCnpj(false);
    }
  }

  async function buscarCep(cepValue?: string) {
    const raw = (cepValue ?? form.cep).replace(/\D/g, "");
    if (raw.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res = await fetch(`/api/corporativo/cep/${raw}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "CEP não encontrado.");
      const d = json.data;
      setForm((f) => ({
        ...f,
        cep: raw,
        endereco: d.endereco || f.endereco,
        bairro: d.bairro || f.bairro,
        cidade: d.cidade || f.cidade,
        uf: d.uf || f.uf,
        codMunicipioIbge: d.codMunicipioIbge || f.codMunicipioIbge,
        ddd1: f.ddd1 || d.ddd || "",
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar CEP.");
    } finally {
      setBuscandoCep(false);
    }
  }

  function validar(): string | null {
    if (!form.razaoSocial.trim()) return isPJ ? "Informe a razão social." : "Informe o nome completo.";
    if (isPJ && digitsDoc.length !== 14) return "CNPJ deve ter 14 dígitos.";
    if (!isPJ && digitsDoc.length !== 11) return "CPF deve ter 11 dígitos.";
    if (isPJ && !form.inscricaoEstadual.trim())
      return "Informe a Inscrição Estadual. Se a empresa for isenta, digite ISENTO.";
    if (!form.cep.replace(/\D/g, "")) return "Informe o CEP.";
    if (!form.endereco.trim()) return "Informe o endereço.";
    if (!form.cidade.trim()) return "Informe a cidade.";
    if (!form.uf.trim()) return "Informe a UF.";
    if (!form.codMunicipioIbge.trim()) return "Confirme o CEP para preencher o código do município.";
    if (!form.ddd1.replace(/\D/g, "") || !form.telefone1.replace(/\D/g, "")) return "Informe DDD e telefone.";
    if (form.username.trim().length < 3) return "Escolha um usuário com ao menos 3 caracteres.";
    if (form.password.length < 6) return "A senha deve ter ao menos 6 caracteres.";
    if (form.password !== form.password2) return "As senhas não conferem.";
    return null;
  }

  async function enviar() {
    setError(null);
    const v = validar();
    if (v) {
      setError(v);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    try {
      const payload: RegistroPublicoInput = {
        tipoPessoa: form.tipoPessoa,
        razaoSocial: form.razaoSocial.trim(),
        cpfCnpj: digitsDoc,
        inscricaoEstadual: isPJ ? form.inscricaoEstadual.trim() : "",
        cep: form.cep,
        endereco: form.endereco.trim(),
        numero: form.numero.trim(),
        complemento: form.complemento.trim(),
        bairro: form.bairro.trim(),
        cidade: form.cidade.trim(),
        uf: form.uf.trim().toUpperCase(),
        codMunicipioIbge: form.codMunicipioIbge,
        ddd1: form.ddd1,
        telefone1: form.telefone1,
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
      };
      const res = await fetch("/api/corporativo/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao criar cadastro.");

      // Login automático → entra na loja (modo navegação até a aprovação liberar as compras).
      const result = await login(form.username.trim(), form.password);
      if (result.ok) {
        router.replace("/corporativo/loja");
        return;
      }
      // Se o auto-login falhar por algum motivo, mostra a tela de sucesso com link.
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar cadastro.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className={styles.wrap}>
        <div className={styles.inner}>
          <div className={corp.card}>
            <div className={styles.successWrap}>
              <div className={styles.successIcon}>✓</div>
              <h1 className={styles.successTitle}>Cadastro enviado!</h1>
              <p className={styles.successText}>
                Sua conta foi criada. Você já pode entrar e navegar pela loja. As compras serão
                liberadas assim que nossa equipe aprovar seu cadastro.
              </p>
              <div style={{ marginTop: 18 }}>
                <Link href="/login" className={`${corp.btn} ${corp.btnPrimary}`}>
                  Entrar
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const regiaoPreview = form.uf ? regiaoFromUf(form.uf) : "";

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <div className={styles.brandLogo}>S</div>
          <h1 className={styles.brandTitle}>Criar conta — Loja Corporativa</h1>
          <p className={styles.brandSub}>Cadastro de cliente atacado. Leva menos de 2 minutos.</p>
        </div>

        {error && <div className={`${corp.alert} ${corp.alertError}`}>{error}</div>}

        {/* Identificação */}
        <div className={corp.card}>
          <h2 className={corp.sectionTitle}>Quem é você?</h2>
          <div className={corp.grid}>
            <div className={`${corp.field} ${corp.col12}`}>
              <span className={corp.label}>Tipo de cadastro</span>
              <div className={corp.toggleRow}>
                <button type="button" onClick={() => trocarTipo("PJ")}
                  className={`${corp.toggleBtn} ${isPJ ? corp.toggleBtnActive : ""}`}>Empresa (CNPJ)</button>
                <button type="button" onClick={() => trocarTipo("PF")}
                  className={`${corp.toggleBtn} ${!isPJ ? corp.toggleBtnActive : ""}`}>Pessoa Física (CPF)</button>
              </div>
            </div>

            <div className={`${corp.field} ${corp.col8}`}>
              <span className={corp.label}>{isPJ ? "CNPJ" : "CPF"} <span className={corp.req}>*</span></span>
              <div className={corp.inputRow}>
                <input className={corp.input} value={form.cpfCnpj} inputMode="numeric"
                  placeholder={isPJ ? "00.000.000/0000-00" : "000.000.000-00"}
                  onChange={(e) => set("cpfCnpj", e.target.value)} />
                {isPJ && (
                  <button type="button" className={corp.btn} disabled={digitsDoc.length !== 14 || buscandoCnpj}
                    onClick={buscarCnpj}>
                    {buscandoCnpj ? "Buscando…" : "Buscar"}
                  </button>
                )}
              </div>
              {isPJ && <span className={styles.hintInline}>Use “Buscar” para preencher os dados da empresa automaticamente.</span>}
            </div>

            <div className={`${corp.field} ${corp.col4}`}>
              <span className={corp.label}>{isPJ ? "Inscrição Estadual" : " "} {isPJ && <span className={corp.req}>*</span>}</span>
              {isPJ ? (
                <input className={corp.input} value={form.inscricaoEstadual} maxLength={19}
                  placeholder="IE ou ISENTO" onChange={(e) => set("inscricaoEstadual", e.target.value)} />
              ) : (
                <div className={styles.hintInline} style={{ paddingTop: 10 }}>Pessoa física é sempre isenta.</div>
              )}
            </div>

            <div className={`${corp.field} ${corp.col12}`}>
              <span className={corp.label}>{isPJ ? "Razão social" : "Nome completo"} <span className={corp.req}>*</span></span>
              <input className={corp.input} value={form.razaoSocial} maxLength={90}
                onChange={(e) => set("razaoSocial", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className={corp.card}>
          <h2 className={corp.sectionTitle}>Endereço</h2>
          <p className={corp.sectionHint}>Informe o CEP e clique em “Buscar” para completar automaticamente.</p>
          <div className={corp.grid}>
            <div className={`${corp.field} ${corp.col4}`}>
              <span className={corp.label}>CEP <span className={corp.req}>*</span></span>
              <div className={corp.inputRow}>
                <input className={corp.input} value={form.cep} inputMode="numeric" maxLength={9}
                  onChange={(e) => set("cep", e.target.value)} onBlur={() => buscarCep()} />
                <button type="button" className={corp.btn} disabled={buscandoCep} onClick={() => buscarCep()}>
                  {buscandoCep ? "…" : "Buscar"}
                </button>
              </div>
            </div>
            <div className={`${corp.field} ${corp.col6}`}>
              <span className={corp.label}>Endereço <span className={corp.req}>*</span></span>
              <input className={corp.input} value={form.endereco} maxLength={90}
                onChange={(e) => set("endereco", e.target.value)} />
            </div>
            <div className={`${corp.field} ${corp.col2}`}>
              <span className={corp.label}>Número</span>
              <input className={corp.input} value={form.numero} maxLength={10}
                onChange={(e) => set("numero", e.target.value)} />
            </div>
            <div className={`${corp.field} ${corp.col4}`}>
              <span className={corp.label}>Complemento</span>
              <input className={corp.input} value={form.complemento} maxLength={60}
                onChange={(e) => set("complemento", e.target.value)} />
            </div>
            <div className={`${corp.field} ${corp.col4}`}>
              <span className={corp.label}>Bairro</span>
              <input className={corp.input} value={form.bairro} maxLength={25}
                onChange={(e) => set("bairro", e.target.value)} />
            </div>
            <div className={`${corp.field} ${corp.col3}`}>
              <span className={corp.label}>Cidade <span className={corp.req}>*</span></span>
              <input className={corp.input} value={form.cidade} maxLength={35}
                onChange={(e) => set("cidade", e.target.value)} />
            </div>
            <div className={corp.field} style={{ gridColumn: "span 2" }}>
              <span className={corp.label}>UF</span>
              <input className={corp.input} value={form.uf} maxLength={2}
                onChange={(e) => set("uf", e.target.value.toUpperCase())} />
            </div>
          </div>
          {regiaoPreview && <span className={styles.hintInline}>Região identificada: {regiaoPreview}.</span>}
        </div>

        {/* Contato */}
        <div className={corp.card}>
          <h2 className={corp.sectionTitle}>Contato</h2>
          <div className={corp.grid}>
            <div className={`${corp.field} ${corp.col2}`}>
              <span className={corp.label}>DDD <span className={corp.req}>*</span></span>
              <input className={corp.input} value={form.ddd1} inputMode="numeric" maxLength={3}
                onChange={(e) => set("ddd1", e.target.value)} />
            </div>
            <div className={`${corp.field} ${corp.col4}`}>
              <span className={corp.label}>Telefone / WhatsApp <span className={corp.req}>*</span></span>
              <input className={corp.input} value={form.telefone1} inputMode="numeric" maxLength={10}
                onChange={(e) => set("telefone1", e.target.value)} />
            </div>
            <div className={`${corp.field} ${corp.col6}`}>
              <span className={corp.label}>E-mail</span>
              <input className={corp.input} value={form.email} type="email" maxLength={100}
                onChange={(e) => set("email", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Pagamento (informativo) */}
        <div className={corp.card}>
          <h2 className={corp.sectionTitle}>Forma de pagamento</h2>
          <div className={styles.payCard}>
            <span className={styles.payIcon}>🧾</span>
            <div>
              <div className={styles.payTitle}>BOLETO (45 DIAS)</div>
              <div className={styles.payValue}>Condição padrão para clientes atacado.</div>
            </div>
          </div>
        </div>

        {/* Acesso */}
        <div className={corp.card}>
          <h2 className={corp.sectionTitle}>Seu acesso</h2>
          <p className={corp.sectionHint}>Você usará estes dados para entrar na loja.</p>
          <div className={corp.grid}>
            <div className={`${corp.field} ${corp.col12}`}>
              <span className={corp.label}>Usuário <span className={corp.req}>*</span></span>
              <input className={corp.input} value={form.username} autoComplete="username" maxLength={40}
                onChange={(e) => set("username", e.target.value)} />
            </div>
            <div className={`${corp.field} ${corp.col6}`}>
              <span className={corp.label}>Senha <span className={corp.req}>*</span></span>
              <input className={corp.input} value={form.password} type="password" autoComplete="new-password"
                onChange={(e) => set("password", e.target.value)} />
            </div>
            <div className={`${corp.field} ${corp.col6}`}>
              <span className={corp.label}>Confirmar senha <span className={corp.req}>*</span></span>
              <input className={corp.input} value={form.password2} type="password" autoComplete="new-password"
                onChange={(e) => set("password2", e.target.value)} />
            </div>
          </div>
        </div>

        <div className={styles.submitBar}>
          <button type="button" className={styles.submitBtn} disabled={saving} onClick={enviar}>
            {saving ? "Enviando…" : "Criar minha conta"}
          </button>
          <p className={styles.terms}>
            Já tem conta? <Link href="/login" className={styles.loginLink}>Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
