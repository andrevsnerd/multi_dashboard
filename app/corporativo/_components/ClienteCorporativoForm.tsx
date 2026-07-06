"use client";

import type { OptionItem, TipoPessoa } from "@/lib/corporativo/types";
import styles from "../corporativo.module.css";
import { UF_REGIAO, type EnderecoFields, type FormState } from "./formTypes";

export interface ComercialOptions {
  condicoesPgto: OptionItem[];
  tabelasPreco: OptionItem[];
  transportadoras: OptionItem[];
  regioes: OptionItem[];
  conceitos: OptionItem[];
  pontualidades: OptionItem[];
  tipos: OptionItem[];
  filiais: OptionItem[];
  indicadoresFiscais: OptionItem[];
  tiposTributacao: OptionItem[];
}

interface ClienteCorporativoFormProps {
  form: FormState;
  /** Modo somente-leitura: desabilita todos os campos e esconde ações (buscar CNPJ/CEP). */
  readOnly?: boolean;
  options: ComercialOptions;

  // Handlers — usados apenas quando readOnly=false (cadastro).
  onTipoChange?: (tp: TipoPessoa) => void;
  setField?: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  setEnderecoField?: (bloco: "cobranca" | "entrega", key: keyof EnderecoFields, value: string) => void;
  onBuscarCnpj?: () => void;
  buscandoCnpj?: boolean;
  onBuscarCep?: (target: "principal" | "cobranca" | "entrega") => void;
  buscandoCep?: "principal" | "cobranca" | "entrega" | null;
}

export function ClienteCorporativoForm({
  form,
  readOnly = false,
  options,
  onTipoChange,
  setField,
  setEnderecoField,
  onBuscarCnpj,
  buscandoCnpj,
  onBuscarCep,
  buscandoCep,
}: ClienteCorporativoFormProps) {
  const isPJ = form.tipoPessoa === "PJ";
  const digitsDoc = form.cpfCnpj.replace(/\D/g, "");
  const docPlaceholder = isPJ ? "00.000.000/0000-00" : "000.000.000-00";
  const cnpjOk = digitsDoc.length === 14;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setField?.(key, value);

  return (
    <>
      {/* Identificação */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Identificação</h2>
        {!readOnly && (
          <p className={styles.sectionHint}>Pessoa Física ou Jurídica. No CNPJ, use “Buscar” para autopreencher.</p>
        )}
        <div className={styles.grid}>
          <div className={`${styles.field} ${styles.col4}`}>
            <span className={styles.label}>Tipo de pessoa</span>
            <div className={styles.toggleRow}>
              <button type="button" disabled={readOnly} onClick={() => onTipoChange?.("PJ")}
                className={`${styles.toggleBtn} ${isPJ ? styles.toggleBtnActive : ""}`}>Jurídica</button>
              <button type="button" disabled={readOnly} onClick={() => onTipoChange?.("PF")}
                className={`${styles.toggleBtn} ${!isPJ ? styles.toggleBtnActive : ""}`}>Física</button>
            </div>
          </div>

          <div className={`${styles.field} ${styles.col8}`}>
            <span className={styles.label}>{isPJ ? "CNPJ" : "CPF"} {!readOnly && <span className={styles.req}>*</span>}</span>
            <div className={styles.inputRow}>
              <input className={styles.input} value={form.cpfCnpj} placeholder={docPlaceholder} disabled={readOnly}
                inputMode="numeric" onChange={(e) => set("cpfCnpj", e.target.value)} />
              {!readOnly && isPJ && (
                <button type="button" className={styles.btn} disabled={!cnpjOk || buscandoCnpj} onClick={onBuscarCnpj}>
                  {buscandoCnpj ? "Buscando…" : "Buscar CNPJ"}
                </button>
              )}
            </div>
          </div>

          <div className={`${styles.field} ${styles.col8}`}>
            <span className={styles.label}>{isPJ ? "Razão social" : "Nome completo"} {!readOnly && <span className={styles.req}>*</span>}</span>
            <input className={styles.input} value={form.razaoSocial} maxLength={90} disabled={readOnly}
              onChange={(e) => set("razaoSocial", e.target.value)} />
          </div>

          <div className={`${styles.field} ${styles.col4}`}>
            <span className={styles.label}>Nome no sistema <span className={styles.opt}>(máx 25)</span></span>
            <input className={styles.input} value={form.nomeFantasia} maxLength={25} disabled={readOnly}
              placeholder={isPJ ? "Nome fantasia" : "(usa o nome)"}
              onChange={(e) => set("nomeFantasia", e.target.value)} />
          </div>

          <div className={`${styles.field} ${styles.col4}`}>
            <span className={styles.label}>{isPJ ? "Inscrição Estadual" : "RG"}</span>
            <input className={styles.input} value={form.isento ? "" : form.rgIe} maxLength={19}
              disabled={form.isento || readOnly} placeholder={form.isento ? "ISENTO" : ""}
              onChange={(e) => set("rgIe", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col2}`} style={{ justifyContent: "flex-end" }}>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={form.isento} disabled={readOnly}
                onChange={(e) => set("isento", e.target.checked)} />
              Isento
            </label>
          </div>

          <SelectField className={styles.col3} label="Indica Tipo (fiscal)" value={form.indicadorFiscal}
            options={options.indicadoresFiscais} disabled={readOnly} onChange={(v) => set("indicadorFiscal", v)} />

          {isPJ && (
            <>
              <SelectField className={styles.col3} label="Tipo tributação" value={form.tipoTributacao}
                options={options.tiposTributacao} disabled={readOnly} allowEmpty
                onChange={(v) => set("tipoTributacao", v)} />
              <div className={`${styles.field} ${styles.col3}`}>
                <span className={styles.label}>Inscrição Municipal <span className={styles.opt}>(opc.)</span></span>
                <input className={styles.input} value={form.inscricaoMunicipal} maxLength={15} disabled={readOnly}
                  onChange={(e) => set("inscricaoMunicipal", e.target.value)} />
              </div>
              <div className={`${styles.field} ${styles.col3}`}>
                <span className={styles.label}>SUFRAMA <span className={styles.opt}>(opc.)</span></span>
                <input className={styles.input} value={form.suframa} maxLength={9} disabled={readOnly}
                  onChange={(e) => set("suframa", e.target.value)} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Endereço */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Endereço principal</h2>
        {!readOnly && (
          <p className={styles.sectionHint}>Preencha o CEP e clique em “Buscar” para completar (traz o código IBGE p/ NF-e).</p>
        )}
        <div className={styles.grid}>
          <div className={`${styles.field} ${styles.col3}`}>
            <span className={styles.label}>CEP {!readOnly && <span className={styles.req}>*</span>}</span>
            <div className={styles.inputRow}>
              <input className={styles.input} value={form.cep} inputMode="numeric" maxLength={9} disabled={readOnly}
                onChange={(e) => set("cep", e.target.value)} onBlur={() => onBuscarCep?.("principal")} />
              {!readOnly && (
                <button type="button" className={styles.btn} disabled={buscandoCep === "principal"}
                  onClick={() => onBuscarCep?.("principal")}>
                  {buscandoCep === "principal" ? "…" : "Buscar"}
                </button>
              )}
            </div>
          </div>
          <div className={`${styles.field} ${styles.col7}`}>
            <span className={styles.label}>Endereço {!readOnly && <span className={styles.req}>*</span>}</span>
            <input className={styles.input} value={form.endereco} maxLength={90} disabled={readOnly}
              onChange={(e) => set("endereco", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col2}`}>
            <span className={styles.label}>Número</span>
            <input className={styles.input} value={form.numero} maxLength={10} disabled={readOnly}
              onChange={(e) => set("numero", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col4}`}>
            <span className={styles.label}>Complemento</span>
            <input className={styles.input} value={form.complemento} maxLength={60} disabled={readOnly}
              onChange={(e) => set("complemento", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col4}`}>
            <span className={styles.label}>Bairro</span>
            <input className={styles.input} value={form.bairro} maxLength={25} disabled={readOnly}
              onChange={(e) => set("bairro", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col3}`}>
            <span className={styles.label}>Cidade {!readOnly && <span className={styles.req}>*</span>}</span>
            <input className={styles.input} value={form.cidade} maxLength={35} disabled={readOnly}
              onChange={(e) => set("cidade", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col2}`}>
            <span className={styles.label}>UF {!readOnly && <span className={styles.req}>*</span>}</span>
            <input className={styles.input} value={form.uf} maxLength={2} disabled={readOnly}
              onChange={(e) => {
                const uf = e.target.value.toUpperCase();
                set("uf", uf);
                if (!readOnly) set("regiao", UF_REGIAO[uf] ?? form.regiao);
              }} />
          </div>
          <div className={`${styles.field} ${styles.col3}`}>
            <span className={styles.label}>Cód. IBGE {!readOnly && <span className={styles.req}>*</span>}</span>
            <input className={styles.input} value={form.codMunicipioIbge} maxLength={10} disabled={readOnly}
              onChange={(e) => set("codMunicipioIbge", e.target.value)} />
          </div>
        </div>
      </div>

      {/* Contato */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Contato</h2>
        <div className={styles.grid}>
          <div className={`${styles.field} ${styles.col2}`}>
            <span className={styles.label}>DDD {!readOnly && <span className={styles.req}>*</span>}</span>
            <input className={styles.input} value={form.ddd1} inputMode="numeric" maxLength={5} disabled={readOnly}
              onChange={(e) => set("ddd1", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col4}`}>
            <span className={styles.label}>Telefone {!readOnly && <span className={styles.req}>*</span>}</span>
            <input className={styles.input} value={form.telefone1} inputMode="numeric" maxLength={10} disabled={readOnly}
              onChange={(e) => set("telefone1", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col2}`}>
            <span className={styles.label}>DDD 2 <span className={styles.opt}>(opc.)</span></span>
            <input className={styles.input} value={form.ddd2} inputMode="numeric" maxLength={5} disabled={readOnly}
              onChange={(e) => set("ddd2", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col4}`}>
            <span className={styles.label}>Telefone 2 <span className={styles.opt}>(opc.)</span></span>
            <input className={styles.input} value={form.telefone2} inputMode="numeric" maxLength={10} disabled={readOnly}
              onChange={(e) => set("telefone2", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col5}`}>
            <span className={styles.label}>E-mail</span>
            <input className={styles.input} value={form.email} maxLength={100} type="email" disabled={readOnly}
              onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col5}`}>
            <span className={styles.label}>E-mail NF-e</span>
            <input className={styles.input} value={form.emailNfe} maxLength={100} type="email" disabled={readOnly}
              onChange={(e) => set("emailNfe", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col2}`}>
            <span className={styles.label}>Aniversário <span className={styles.opt}>(opc.)</span></span>
            <input className={styles.input} value={form.aniversario} type="date" disabled={readOnly}
              onChange={(e) => set("aniversario", e.target.value)} />
          </div>
        </div>
      </div>

      {/* Cobrança / Entrega */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Cobrança e entrega</h2>
        {!readOnly && (
          <p className={styles.sectionHint}>Por padrão espelham o endereço principal. Desmarque para informar endereços diferentes.</p>
        )}
        <div className={styles.grid}>
          <div className={`${styles.field} ${styles.col6}`}>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={form.mesmoEnderecoCobranca} disabled={readOnly}
                onChange={(e) => set("mesmoEnderecoCobranca", e.target.checked)} />
              Cobrança usa o endereço principal
            </label>
          </div>
          <div className={`${styles.field} ${styles.col6}`}>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={form.mesmoEnderecoEntrega} disabled={readOnly}
                onChange={(e) => set("mesmoEnderecoEntrega", e.target.checked)} />
              Entrega usa o endereço principal
            </label>
          </div>
        </div>

        {!form.mesmoEnderecoCobranca && (
          <EnderecoSubForm titulo="Endereço de cobrança" data={form.cobranca} readOnly={readOnly}
            onChange={(k, v) => setEnderecoField?.("cobranca", k, v)}
            onBuscar={() => onBuscarCep?.("cobranca")} buscando={buscandoCep === "cobranca"} />
        )}
        {!form.mesmoEnderecoEntrega && (
          <EnderecoSubForm titulo="Endereço de entrega" data={form.entrega} readOnly={readOnly}
            onChange={(k, v) => setEnderecoField?.("entrega", k, v)}
            onBuscar={() => onBuscarCep?.("entrega")} buscando={buscandoCep === "entrega"} />
        )}
      </div>

      {/* Comercial */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Dados comerciais</h2>
        {readOnly && (
          <p className={styles.sectionHint}>
            Camada &ldquo;CLIENTES_ATACADO&rdquo;: onde o cliente compra, prazo de pagamento, tabela de preço,
            transportadora e como o Linx classifica a relação comercial.
          </p>
        )}
        <div className={styles.grid}>
          <SelectField className={styles.col4} label="Filial" required={!readOnly} value={form.filial}
            options={options.filiais} disabled={readOnly} onChange={(v) => set("filial", v)} />
          <SelectField className={styles.col4} label="Condição de pagamento" value={form.condicaoPgto}
            options={options.condicoesPgto} disabled={readOnly} onChange={(v) => set("condicaoPgto", v)} />
          <SelectField className={styles.col4} label="Tabela de preços" value={form.codigoTabPreco}
            options={options.tabelasPreco} disabled={readOnly} onChange={(v) => set("codigoTabPreco", v)} />
          <SelectField className={styles.col4} label="Transportadora" value={form.transportadora}
            options={options.transportadoras} disabled={readOnly} onChange={(v) => set("transportadora", v)} />
          <SelectField className={styles.col4} label="Região" value={form.regiao}
            options={options.regioes} disabled={readOnly} onChange={(v) => set("regiao", v)} />
          <SelectField className={styles.col4} label="Tipo" value={form.tipo}
            options={options.tipos} disabled={readOnly} onChange={(v) => set("tipo", v)} />
          <SelectField className={styles.col4} label="Conceito" value={form.conceito}
            options={options.conceitos} disabled={readOnly} onChange={(v) => set("conceito", v)} />
          <SelectField className={styles.col4} label="Pontualidade" value={form.pontualidade}
            options={options.pontualidades} disabled={readOnly} onChange={(v) => set("pontualidade", v)} />
          <div className={`${styles.field} ${styles.col4}`}>
            <span className={styles.label}>Limite de crédito</span>
            <input className={styles.input} value={form.limiteCredito} inputMode="decimal" disabled={readOnly}
              onChange={(e) => set("limiteCredito", e.target.value)} />
          </div>
          <div className={`${styles.field} ${styles.col12}`}>
            <span className={styles.label}>Observação de faturamento <span className={styles.opt}>(opc.)</span></span>
            <textarea className={styles.textarea} value={form.observacao} maxLength={4000} disabled={readOnly}
              onChange={(e) => set("observacao", e.target.value)} />
          </div>
        </div>
      </div>
    </>
  );
}

function SelectField({
  label, value, options, onChange, className, required, disabled, allowEmpty,
}: {
  label: string;
  value: string;
  options: OptionItem[];
  onChange: (v: string) => void;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  allowEmpty?: boolean;
}) {
  const hasValue = options.some((o) => o.value === value);
  return (
    <div className={`${styles.field} ${className ?? ""}`}>
      <span className={styles.label}>{label} {required && <span className={styles.req}>*</span>}</span>
      <select className={styles.select} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {(allowEmpty || !hasValue) && <option value="">—</option>}
        {!hasValue && value && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function EnderecoSubForm({
  titulo, data, onChange, onBuscar, buscando, readOnly,
}: {
  titulo: string;
  data: EnderecoFields;
  onChange: (key: keyof EnderecoFields, value: string) => void;
  onBuscar: () => void;
  buscando: boolean;
  readOnly?: boolean;
}) {
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--b-300)" }}>
      <h3 className={styles.label} style={{ marginBottom: 12 }}>{titulo}</h3>
      <div className={styles.grid}>
        <div className={`${styles.field} ${styles.col3}`}>
          <span className={styles.label}>CEP</span>
          <div className={styles.inputRow}>
            <input className={styles.input} value={data.cep} inputMode="numeric" maxLength={9} disabled={readOnly}
              onChange={(e) => onChange("cep", e.target.value)} onBlur={onBuscar} />
            {!readOnly && (
              <button type="button" className={styles.btn} disabled={buscando} onClick={onBuscar}>
                {buscando ? "…" : "Buscar"}
              </button>
            )}
          </div>
        </div>
        <div className={`${styles.field} ${styles.col7}`}>
          <span className={styles.label}>Endereço</span>
          <input className={styles.input} value={data.endereco} maxLength={90} disabled={readOnly}
            onChange={(e) => onChange("endereco", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col2}`}>
          <span className={styles.label}>Número</span>
          <input className={styles.input} value={data.numero} maxLength={10} disabled={readOnly}
            onChange={(e) => onChange("numero", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col4}`}>
          <span className={styles.label}>Complemento</span>
          <input className={styles.input} value={data.complemento} maxLength={60} disabled={readOnly}
            onChange={(e) => onChange("complemento", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col4}`}>
          <span className={styles.label}>Bairro</span>
          <input className={styles.input} value={data.bairro} maxLength={25} disabled={readOnly}
            onChange={(e) => onChange("bairro", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col2}`}>
          <span className={styles.label}>Cidade</span>
          <input className={styles.input} value={data.cidade} maxLength={35} disabled={readOnly}
            onChange={(e) => onChange("cidade", e.target.value)} />
        </div>
        <div className={`${styles.field} ${styles.col2}`}>
          <span className={styles.label}>UF</span>
          <input className={styles.input} value={data.uf} maxLength={2} disabled={readOnly}
            onChange={(e) => onChange("uf", e.target.value.toUpperCase())} />
        </div>
      </div>
    </div>
  );
}
