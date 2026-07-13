"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import type { CorporativoLookups, RegistroPendente, TipoPessoa } from "@/lib/corporativo/types";
import { ClienteCorporativoForm } from "../../_components/ClienteCorporativoForm";
import {
  formStateToInput,
  inputToFormState,
  UF_REGIAO,
  type EnderecoFields,
  type FormState,
} from "../../_components/formTypes";
import styles from "../../corporativo.module.css";

const EMPTY_OPTIONS: CorporativoLookups = {
  condicoesPgto: [], tabelasPreco: [], transportadoras: [], regioes: [], conceitos: [],
  pontualidades: [], tipos: [], tiposTributacao: [], indicadoresFiscais: [], filiais: [],
  proximoCodigoPreview: "",
};

export default function AprovarCadastroPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const { user } = useAuth();

  const [registro, setRegistro] = useState<RegistroPendente | null>(null);
  const [lookups, setLookups] = useState<CorporativoLookups | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState<"principal" | "cobranca" | "entrega" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const authHeader = useCallback(
    (): HeadersInit => (user?.username ? { "x-auth-username": user.username } : {}),
    [user?.username]
  );

  useEffect(() => {
    if (!id || !user?.username) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [rReg, rLk] = await Promise.all([
          fetch(`/api/corporativo/registro/${id}`, { headers: authHeader() }),
          fetch(`/api/corporativo/lookups`),
        ]);
        const jReg = await rReg.json();
        if (!rReg.ok) throw new Error(jReg.error || "Cadastro não encontrado.");
        const jLk = await rLk.json();
        const reg = jReg.data as RegistroPendente;
        setRegistro(reg);
        setLookups(jLk.data as CorporativoLookups);
        setForm(inputToFormState(reg.payload));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar cadastro.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, user?.username, authHeader]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }, []);
  const setEnd = useCallback(
    (bloco: "cobranca" | "entrega", key: keyof EnderecoFields, value: string) => {
      setForm((f) => (f ? { ...f, [bloco]: { ...f[bloco], [key]: value } } : f));
    },
    []
  );

  function trocarTipo(tp: TipoPessoa) {
    setForm((f) =>
      f ? { ...f, tipoPessoa: tp, indicadorFiscal: tp === "PJ" ? "1" : "8", isento: tp === "PF" ? true : f.isento } : f
    );
  }

  async function buscarCnpj() {
    if (!form) return;
    const digits = form.cpfCnpj.replace(/\D/g, "");
    if (digits.length !== 14) return;
    setBuscandoCnpj(true);
    setError(null);
    try {
      const res = await fetch(`/api/corporativo/cnpj/${digits}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "CNPJ não encontrado.");
      const d = json.data;
      setForm((f) =>
        f
          ? {
              ...f,
              razaoSocial: d.razaoSocial || f.razaoSocial,
              cep: d.cep || f.cep,
              endereco: d.endereco || f.endereco,
              numero: d.numero || f.numero,
              bairro: d.bairro || f.bairro,
              cidade: d.cidade || f.cidade,
              uf: d.uf || f.uf,
              regiao: d.uf && UF_REGIAO[d.uf] ? UF_REGIAO[d.uf] : f.regiao,
              ddd1: d.ddd1 || f.ddd1,
              telefone1: d.telefone1 || f.telefone1,
            }
          : f
      );
      if (d.cep) await buscarCep("principal", d.cep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar CNPJ.");
    } finally {
      setBuscandoCnpj(false);
    }
  }

  async function buscarCep(target: "principal" | "cobranca" | "entrega", cepValue?: string) {
    if (!form) return;
    const raw = (cepValue ?? (target === "principal" ? form.cep : form[target].cep)).replace(/\D/g, "");
    if (raw.length !== 8) return;
    setBuscandoCep(target);
    try {
      const res = await fetch(`/api/corporativo/cep/${raw}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "CEP não encontrado.");
      const d = json.data;
      setForm((f) => {
        if (!f) return f;
        if (target === "principal") {
          return {
            ...f,
            cep: raw,
            endereco: d.endereco || f.endereco,
            bairro: d.bairro || f.bairro,
            cidade: d.cidade || f.cidade,
            uf: d.uf || f.uf,
            regiao: d.uf && UF_REGIAO[d.uf] ? UF_REGIAO[d.uf] : f.regiao,
            codMunicipioIbge: d.codMunicipioIbge || f.codMunicipioIbge,
          };
        }
        return {
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
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar CEP.");
    } finally {
      setBuscandoCep(null);
    }
  }

  async function aprovar() {
    if (!form) return;
    setError(null);
    setSaving(true);
    try {
      const payload = formStateToInput(form);
      const res = await fetch(`/api/corporativo/registro/${id}/aprovar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao aprovar.");
      setOkMsg(`Cliente cadastrado no Linx com o código ${json.data.codigo}. Compras liberadas.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao aprovar.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  async function rejeitar() {
    const motivo = window.prompt("Motivo da rejeição (opcional):") ?? "";
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/corporativo/registro/${id}/rejeitar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ motivo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao rejeitar.");
      router.push("/corporativo/aprovacoes");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao rejeitar.");
      setSaving(false);
    }
  }

  const jaResolvido = registro && registro.status !== "pendente";

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>Corporativo</div>
            <h1 className={styles.title}>
              Revisar cadastro {registro && <span className={styles.pill}>{registro.tipoPessoa}</span>}
            </h1>
            <p className={styles.subtitle}>
              Confira e ajuste os dados. Ao aprovar, o cliente é criado no Linx e as compras liberam.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/corporativo/aprovacoes" className={styles.linkBack}>← Voltar</Link>
          </div>
        </div>

        {okMsg && <div className={`${styles.alert} ${styles.alertOk}`}>{okMsg}</div>}
        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}
        {registro && registro.avisos.length > 0 && !okMsg && (
          <div className={`${styles.alert} ${styles.alertWarn}`}>
            Confira estes itens padronizados: {registro.avisos.join(" ")}
          </div>
        )}
        {jaResolvido && !okMsg && (
          <div className={`${styles.alert} ${styles.alertWarn}`}>
            Este cadastro já foi {registro?.status}
            {registro?.clienteCodigo ? ` (código ${registro.clienteCodigo})` : ""}.
          </div>
        )}

        {loading || !form ? (
          <div className={styles.card}><p className={styles.muted}>Carregando…</p></div>
        ) : (
          <>
            <ClienteCorporativoForm
              form={form}
              options={lookups ?? EMPTY_OPTIONS}
              readOnly={Boolean(okMsg) || Boolean(jaResolvido)}
              onTipoChange={trocarTipo}
              setField={set}
              setEnderecoField={setEnd}
              onBuscarCnpj={buscarCnpj}
              buscandoCnpj={buscandoCnpj}
              onBuscarCep={buscarCep}
              buscandoCep={buscandoCep}
            />

            {!okMsg && !jaResolvido && (
              <div className={styles.footerBar}>
                <div className={styles.muted}>
                  Usuário do sistema: <strong>{registro?.username}</strong>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className={styles.btn} disabled={saving} onClick={rejeitar}>
                    Rejeitar
                  </button>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving} onClick={aprovar}>
                    {saving ? "Aprovando…" : "Aprovar e cadastrar no Linx"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
