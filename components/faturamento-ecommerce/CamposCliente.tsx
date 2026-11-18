"use client";

import { useState } from "react";

import type { EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { EnderecoFat, Opcao } from "@/lib/faturamento-ecommerce/types";

import { useFatApi } from "./api";
import styles from "./FaturamentoEcommerce.module.css";

/** Campos compartilhados pelos cadastros de cliente (pessoa física e PJ). */

export const ENDERECO_VAZIO: EnderecoFat = {
  cep: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  codMunicipioIbge: "",
};

// ── Endereço (compartilhado entre novo cadastro e atualização) ───────────────

export function CamposEndereco({
  empresa,
  endereco,
  onChange,
}: {
  empresa: EmpresaFat;
  endereco: EnderecoFat;
  onChange: (e: EnderecoFat) => void;
}) {
  const api = useFatApi(empresa);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [erroCep, setErroCep] = useState<string | null>(null);
  const set = (k: keyof EnderecoFat, v: string) => onChange({ ...endereco, [k]: v });

  const buscarCep = async () => {
    const cep = endereco.cep.replace(/\D/g, "");
    if (cep.length !== 8) {
      setErroCep("CEP precisa ter 8 dígitos.");
      return;
    }
    setBuscandoCep(true);
    setErroCep(null);
    try {
      const d = await api.get<{ endereco: string; bairro: string; cidade: string; uf: string; codMunicipioIbge: string }>(
        `/cep/${cep}`
      );
      onChange({
        ...endereco,
        cep,
        endereco: d.endereco ? d.endereco.toUpperCase() : endereco.endereco,
        bairro: d.bairro ? d.bairro.toUpperCase() : endereco.bairro,
        cidade: d.cidade.toUpperCase(),
        uf: d.uf.toUpperCase(),
        codMunicipioIbge: d.codMunicipioIbge,
      });
    } catch (err) {
      setErroCep((err as Error).message);
    } finally {
      setBuscandoCep(false);
    }
  };

  return (
    <>
      <div className={styles.grid}>
        <div className={styles.campo}>
          <span className={styles.label}>CEP *</span>
          <div className={styles.linhaBusca}>
            <input
              className={styles.input}
              value={endereco.cep}
              onChange={(e) => {
                const novo = e.target.value;
                // CEP novo invalida cidade/UF/IBGE do anterior (seria gravado o município errado).
                if (novo.replace(/\D/g, "") !== endereco.cep.replace(/\D/g, "")) {
                  onChange({ ...endereco, cep: novo, cidade: "", uf: "", codMunicipioIbge: "" });
                } else {
                  set("cep", novo);
                }
              }}
              onBlur={() => endereco.cep.replace(/\D/g, "").length === 8 && !endereco.codMunicipioIbge && buscarCep()}
              placeholder="00000-000"
            />
            <button type="button" className={`${styles.btn} ${styles.btnMini}`} onClick={buscarCep} disabled={buscandoCep}>
              {buscandoCep ? "…" : "Buscar"}
            </button>
          </div>
        </div>
        <Campo label="Endereço *" span={2} value={endereco.endereco} onChange={(v) => set("endereco", v)} />
        <Campo label="Número *" value={endereco.numero} onChange={(v) => set("numero", v)} />
        <Campo label="Complemento" span={2} value={endereco.complemento} onChange={(v) => set("complemento", v)} />
        <Campo label="Bairro *" value={endereco.bairro} onChange={(v) => set("bairro", v)} />
        <Campo label="Cidade (pelo CEP)" value={endereco.cidade} onChange={() => {}} readOnly />
        <Campo label="UF" value={endereco.uf} onChange={() => {}} readOnly />
        <Campo label="IBGE" value={endereco.codMunicipioIbge} onChange={() => {}} readOnly />
      </div>
      {erroCep && <div className={styles.erroBox}>{erroCep}</div>}
      <p className={styles.muted}>
        A cidade é gravada sem acento, como o Linx exige — vem do código IBGE do CEP. No site, a 1ª linha do endereço
        costuma ter “rua, número” e a 2ª o complemento/bairro.
      </p>
    </>
  );
}

export function Campo({
  label,
  value,
  onChange,
  span,
  readOnly,
  type,
  alterado,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  span?: 2 | 3;
  readOnly?: boolean;
  type?: string;
  alterado?: boolean;
  placeholder?: string;
}) {
  return (
    <label className={`${styles.campo} ${span === 2 ? styles.span2 : span === 3 ? styles.span3 : ""}`}>
      <span className={styles.label}>{label}</span>
      <input
        className={`${styles.input} ${alterado ? styles.inputAlterado : ""}`}
        value={value}
        type={type}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function Escolha({
  label,
  value,
  opcoes,
  onChange,
  padrao,
}: {
  label: string;
  value: string;
  opcoes: Opcao[];
  onChange: (v: string) => void;
  padrao?: string;
}) {
  const lista = opcoes.some((o) => o.value === value) || !value ? opcoes : [{ value, label: value }, ...opcoes];
  return (
    <label className={styles.campo}>
      <span className={styles.label}>{label}</span>
      <select
        className={`${styles.select} ${padrao !== undefined && value !== padrao ? styles.inputAlterado : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {lista.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
