"use client";

import { useEffect, useState } from "react";

import {
  INDICADORES_FISCAIS,
  PADROES,
  PERFIL_PJ_PADRAO,
  PERFIS_CLIENTE_PJ,
  TIPOS_TRIBUTACAO,
  perfilDoTipo,
  regiaoDaUf,
  type EmpresaFat,
  type PerfilClientePj,
} from "@/lib/faturamento-ecommerce/config";
import type {
  ClientePjFatInput,
  CnpjConsulta,
  EnderecoFat,
  FatLookups,
  Opcao,
} from "@/lib/faturamento-ecommerce/types";

import { ApiErro, useFatApi } from "./api";
import { Campo, CamposEndereco, ENDERECO_VAZIO, Escolha } from "./CamposCliente";
import styles from "./FaturamentoEcommerce.module.css";

/**
 * Cadastro de cliente PJ (CNPJ) — separado do cadastro de pessoa física do site.
 * Perfil WEB (padrão: empresa que comprou no site) ou CORPORATIVO: o perfil aplica o
 * conjunto inteiro (tipo, conta, tabela, transportadora + indicador de venda e agrupamento,
 * que não aparecem). Trocar o Tipo para WEB/CORPORATIVO troca o perfil junto.
 * Grava via /api/faturamento-ecommerce/clientes-pj.
 */

export interface ClientePjInicial {
  cnpj: string;
  razaoSocial: string;
  email: string;
  ddd: string;
  telefone: string;
  endereco: EnderecoFat;
  /** Modo já escolhido antes (ex.: veio do cadastro de pessoa física). */
  perfil?: PerfilClientePj;
}

const soDigitos = (s: string) => String(s ?? "").replace(/\D/g, "");

export default function ClientePjForm({
  empresa,
  lookups,
  inicial,
  origem,
  onCancelar,
  onCriado,
  onUsarExistente,
}: {
  empresa: EmpresaFat;
  lookups: FatLookups;
  inicial: ClientePjInicial | null;
  origem: string | null;
  onCancelar: () => void;
  onCriado: (codigo: string) => void;
  onUsarExistente: (codigo: string) => void;
}) {
  const api = useFatApi(empresa);
  const padrao = PADROES[empresa].clientePj;

  // Identificação
  const [cnpj, setCnpj] = useState(inicial?.cnpj ?? "");
  const [razao, setRazao] = useState(inicial?.razaoSocial ?? "");
  const [fantasia, setFantasia] = useState("");
  const [isento, setIsento] = useState(true);
  const [ie, setIe] = useState("");
  const perfilInicial: PerfilClientePj = inicial?.perfil ?? PERFIL_PJ_PADRAO;
  const [indicador, setIndicador] = useState(String(PERFIS_CLIENTE_PJ[perfilInicial].indicadorFiscal));
  const [tributacao, setTributacao] = useState("");
  const [im, setIm] = useState("");
  const [suframa, setSuframa] = useState("");
  // Endereços e contato
  const [endereco, setEndereco] = useState<EnderecoFat>(inicial?.endereco ?? ENDERECO_VAZIO);
  const [cobrancaIgual, setCobrancaIgual] = useState(true);
  const [cobranca, setCobranca] = useState<EnderecoFat>(ENDERECO_VAZIO);
  const [entregaIgual, setEntregaIgual] = useState(true);
  const [entrega, setEntrega] = useState<EnderecoFat>(ENDERECO_VAZIO);
  const [ddd, setDdd] = useState(inicial?.ddd ?? "");
  const [telefone, setTelefone] = useState(inicial?.telefone ?? "");
  const [ddd2, setDdd2] = useState("");
  const [telefone2, setTelefone2] = useState("");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [emailNfe, setEmailNfe] = useState("");
  // Comercial — tipo, conta, tabela e transportadora começam no perfil
  const [perfil, setPerfil] = useState<PerfilClientePj>(perfilInicial);
  const perfilDef = PERFIS_CLIENTE_PJ[perfil];
  /** Filial extra (Matriz) que fatura contribuinte, se a empresa tiver uma. */
  const matrizDaEmpresa = lookups.filiaisNota.find((f) => f.extra)?.filial ?? null;
  const [filial, setFilial] = useState(padrao.filial);
  const [tipo, setTipo] = useState(PERFIS_CLIENTE_PJ[perfilInicial].tipo);
  const [conceito, setConceito] = useState(padrao.conceito);
  const [pontualidade, setPontualidade] = useState(padrao.pontualidade);
  const [transportadora, setTransportadora] = useState(PERFIS_CLIENTE_PJ[perfilInicial].transportadora);
  const [condicao, setCondicao] = useState(padrao.condicaoPgto);
  const [tabela, setTabela] = useState(PERFIS_CLIENTE_PJ[perfilInicial].codigoTabPreco);
  const [conta, setConta] = useState(PERFIS_CLIENTE_PJ[perfilInicial].contaContabil);

  /** Troca o perfil inteiro — nunca fica metade WEB, metade corporativo. */
  const aplicarPerfil = (p: PerfilClientePj) => {
    const d = PERFIS_CLIENTE_PJ[p];
    setPerfil(p);
    setTipo(d.tipo);
    setConta(d.contaContabil);
    setTabela(d.codigoTabPreco);
    setTransportadora(d.transportadora);
    // Ponto de partida do perfil: WEB 8 (fatura pelas pernas), CORPORATIVO 1 (fatura pela Matriz).
    setIndicador(String(d.indicadorFiscal));
  };

  const mudarTipo = (v: string) => {
    const p = perfilDoTipo(v);
    if (p && p !== perfil) aplicarPerfil(p);
    else setTipo(v);
  };
  const [regiaoManual, setRegiaoManual] = useState<string | null>(null);
  const [representante, setRepresentante] = useState(padrao.representante);
  const [limite, setLimite] = useState("0");
  const [observacao, setObservacao] = useState("");

  const [contas, setContas] = useState<Opcao[]>([]);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [situacao, setSituacao] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [duplicados, setDuplicados] = useState<{ codigo: string; nome: string; filial: string }[] | null>(null);

  const regiao = regiaoManual ?? regiaoDaUf(endereco.uf);
  const cnpjDigitos = soDigitos(cnpj);
  const nomeLinx = (fantasia.trim() || razao.trim()).toUpperCase().slice(0, 25);

  // Plano de contas (só o cadastro PJ usa a lista). Depende de api.get (memorizado),
  // não de `api` — esse objeto é novo a cada render e faria a busca rodar sem parar.
  const apiGet = api.get;
  useEffect(() => {
    let vivo = true;
    apiGet<{ contasContabeis: Opcao[] }>("/clientes-pj")
      .then((d) => vivo && setContas(d.contasContabeis))
      .catch(() => {
        /* sem a lista, o campo continua com o padrão */
      });
    return () => {
      vivo = false;
    };
  }, [apiGet]);

  const buscarCnpj = async () => {
    if (cnpjDigitos.length !== 14) return;
    setBuscandoCnpj(true);
    setErro(null);
    setSituacao(null);
    try {
      const d = await api.get<CnpjConsulta>(`/cnpj/${cnpjDigitos}`);
      setSituacao(d.situacao || null);
      setRazao(d.razaoSocial || razao);
      setFantasia((d.nomeFantasia || fantasia).slice(0, 25));
      if (d.ddd) setDdd(d.ddd);
      if (d.telefone) setTelefone(d.telefone);
      if (d.email && !email) setEmail(d.email.toLowerCase());
      let novo: EnderecoFat = {
        ...endereco,
        cep: d.cep || endereco.cep,
        endereco: (d.endereco || endereco.endereco).toUpperCase(),
        numero: (d.numero || endereco.numero).toUpperCase(),
        complemento: (d.complemento || endereco.complemento).toUpperCase(),
        bairro: (d.bairro || endereco.bairro).toUpperCase(),
      };
      // A Receita não traz o IBGE: completa pelo CEP (cidade sem acento, como o Linx exige).
      if (d.cep.length === 8) {
        try {
          const c = await api.get<{ endereco: string; bairro: string; cidade: string; uf: string; codMunicipioIbge: string }>(
            `/cep/${d.cep}`
          );
          novo = {
            ...novo,
            endereco: novo.endereco || c.endereco.toUpperCase(),
            bairro: novo.bairro || c.bairro.toUpperCase(),
            cidade: c.cidade.toUpperCase(),
            uf: c.uf.toUpperCase(),
            codMunicipioIbge: c.codMunicipioIbge,
          };
        } catch {
          novo = { ...novo, cidade: "", uf: "", codMunicipioIbge: "" };
        }
      }
      setEndereco(novo);
      setRegiaoManual(null);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setBuscandoCnpj(false);
    }
  };

  const salvar = async (forcar = false) => {
    setSalvando(true);
    setErro(null);
    try {
      const cliente: ClientePjFatInput = {
        perfil,
        cnpj,
        razaoSocial: razao,
        nomeFantasia: fantasia,
        inscricaoEstadual: isento ? "" : ie,
        indicadorFiscal: indicador,
        tipoTributacao: tributacao,
        inscricaoMunicipal: im,
        suframa,
        endereco,
        cobranca: cobrancaIgual ? null : cobranca,
        entrega: entregaIgual ? null : entrega,
        ddd,
        telefone,
        ddd2,
        telefone2,
        email,
        emailNfe,
        filial,
        tipo,
        conceito,
        pontualidade,
        transportadora,
        condicaoPgto: condicao,
        codigoTabPreco: tabela,
        contaContabil: conta,
        regiao,
        representante,
        limiteCredito: Number(limite.replace(",", ".")) || 0,
        observacao,
        forcar,
      };
      const r = await api.send<{ codigo: string }>("/clientes-pj", "POST", {
        cliente: cliente as unknown as Record<string, unknown>,
      });
      onCriado(r.codigo);
    } catch (err) {
      if (err instanceof ApiErro && err.status === 409) {
        setDuplicados((err.corpo.existentes as { codigo: string; nome: string; filial: string }[]) ?? []);
      } else {
        setErro((err as Error).message);
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Cadastrar PJ (CNPJ)</h2>
        <span className={styles.muted}>Próximo código: {lookups.proximoCodigoCliente || "—"}</span>
      </div>
      <p className={styles.muted}>
        Cadastro de empresa (CNPJ). Pessoa física continua no cadastro de pessoa física.
      </p>

      <div className={styles.campo}>
        <span className={styles.label}>Perfil do cliente</span>
        <div className={styles.tabs} role="radiogroup" aria-label="Perfil do cliente">
          {(Object.keys(PERFIS_CLIENTE_PJ) as PerfilClientePj[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={perfil === p}
              className={`${styles.tab} ${perfil === p ? styles.tabAtiva : ""}`}
              onClick={() => aplicarPerfil(p)}
              title={PERFIS_CLIENTE_PJ[p].descricao}
            >
              {PERFIS_CLIENTE_PJ[p].rotulo}
            </button>
          ))}
        </div>
        <span className={styles.muted}>
          <strong>{perfilDef.descricao}.</strong> Grava tipo {perfilDef.tipo} · conta {perfilDef.contaContabil} · tabela{" "}
          {perfilDef.codigoTabPreco} · {perfilDef.transportadora} · indicador de venda {perfilDef.indicadorVenda || "vazio"} ·
          agrupamento {perfilDef.agrupamentoItens}.
        </span>
      </div>
      {origem && (
        <div className={styles.infoBox}>
          Preenchido com os dados do {origem}. Use “Buscar CNPJ” para trazer razão social e endereço da Receita.
        </div>
      )}

      <h3 className={styles.cardTitle}>Identificação</h3>
      <div className={styles.grid}>
        <div className={styles.campo}>
          <span className={styles.label}>CNPJ *</span>
          <div className={styles.linhaBusca}>
            <input
              className={styles.input}
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
            />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnMini}`}
              onClick={buscarCnpj}
              disabled={buscandoCnpj || cnpjDigitos.length !== 14}
            >
              {buscandoCnpj ? "…" : "Buscar CNPJ"}
            </button>
          </div>
        </div>
        <Campo label="Razão social *" span={2} value={razao} onChange={setRazao} />
        <Campo label="Nome no Linx (máx. 25)" value={fantasia} onChange={(v) => setFantasia(v.slice(0, 25))} placeholder="nome fantasia" />
        <Campo
          label="Inscrição estadual"
          value={isento ? "ISENTO" : ie}
          onChange={setIe}
          readOnly={isento}
          alterado={!isento}
        />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={isento}
            onChange={(e) => {
              // Com IE a empresa é contribuinte (1); sem IE, volta ao do perfil. Dá para trocar depois.
              setIsento(e.target.checked);
              setIndicador(e.target.checked ? String(perfilDef.indicadorFiscal) : "1");
            }}
          />
          Isento de IE
        </label>
        <Escolha
          label="Indica tipo (fiscal)"
          value={indicador}
          opcoes={INDICADORES_FISCAIS}
          onChange={setIndicador}
          padrao={String(perfilDef.indicadorFiscal)}
        />
        <Escolha
          label="Tipo de tributação"
          value={tributacao}
          opcoes={[{ value: "", label: "—" }, ...TIPOS_TRIBUTACAO]}
          onChange={setTributacao}
        />
        <Campo label="Inscrição municipal (opc.)" value={im} onChange={setIm} />
        <Campo label="SUFRAMA (opc.)" value={suframa} onChange={setSuframa} />
      </div>
      {situacao && situacao.toUpperCase() !== "ATIVA" && (
        <div className={styles.avisoBox}>
          Situação na Receita: <strong>{situacao}</strong>. Confira antes de cadastrar — a SEFAZ pode recusar NF para CNPJ
          irregular.
        </div>
      )}
      {indicador === "1" || indicador === "16" ? (
        matrizDaEmpresa ? (
          <p className={styles.muted}>
            Indicador {indicador} (contribuinte): a NF deste cliente sai pela <strong>{matrizDaEmpresa}</strong> (natureza{" "}
            100.05), como os corporativos no Linx — as filiais do e-commerce não
            têm exceção fiscal de venda para contribuinte e bloqueiam.
          </p>
        ) : (
          <div className={styles.avisoBox}>
            <strong>Indicador {indicador} (contribuinte):</strong> a {PADROES[empresa].nome} não tem exceção fiscal de venda
            para contribuinte no Linx — a NF deste cliente vai ficar <strong>bloqueada</strong> na prévia até o fiscal
            cadastrar a exceção. Empresa que compra para uso próprio vai como 8 - Não Contribuinte.
          </div>
        )
      ) : (
        <p className={styles.muted}>
          8 - Não Contribuinte: empresa comprando para uso próprio — fatura pelas filiais do e-commerce, como quase todas as
          NFs do site para CNPJ
          {matrizDaEmpresa ? ` (pela ${matrizDaEmpresa} só dentro de SP: fora de SP tem DIFAL)` : ""}. Se a empresa tem IE e
          compra para revender, desmarque “Isento” e informe a IE.
        </p>
      )}
      {!fantasia.trim() && razao.trim().length > 25 && (
        <p className={styles.muted}>
          O Linx guarda o nome curto com 25 letras: <strong>{nomeLinx}</strong> (a razão social completa fica guardada).
        </p>
      )}

      <h3 className={styles.cardTitle}>Endereço principal</h3>
      <CamposEndereco empresa={empresa} endereco={endereco} onChange={setEndereco} />

      <h3 className={styles.cardTitle}>Contato</h3>
      <div className={styles.grid}>
        <Campo label="DDD" value={ddd} onChange={setDdd} placeholder="11" />
        <Campo label="Telefone" value={telefone} onChange={setTelefone} />
        <Campo label="DDD 2 (opc.)" value={ddd2} onChange={setDdd2} />
        <Campo label="Telefone 2 (opc.)" value={telefone2} onChange={setTelefone2} />
        <Campo label="E-mail" span={2} value={email} onChange={setEmail} type="email" />
        <Campo label="E-mail NF-e (vazio = o mesmo)" span={2} value={emailNfe} onChange={setEmailNfe} type="email" />
      </div>

      <h3 className={styles.cardTitle}>Cobrança e entrega</h3>
      <div className={styles.grid}>
        <label className={styles.check}>
          <input type="checkbox" checked={cobrancaIgual} onChange={(e) => setCobrancaIgual(e.target.checked)} />
          Cobrança usa o endereço principal
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={entregaIgual} onChange={(e) => setEntregaIgual(e.target.checked)} />
          Entrega usa o endereço principal
        </label>
      </div>
      {!cobrancaIgual && (
        <>
          <p className={styles.label}>Endereço de cobrança</p>
          <CamposEndereco empresa={empresa} endereco={cobranca} onChange={setCobranca} />
        </>
      )}
      {!entregaIgual && (
        <>
          <p className={styles.label}>Endereço de entrega</p>
          <CamposEndereco empresa={empresa} endereco={entrega} onChange={setEntrega} />
        </>
      )}

      <h3 className={styles.cardTitle}>Dados comerciais (padrão do perfil {perfilDef.rotulo} — pode alterar)</h3>
      <div className={styles.grid}>
        <Escolha label="Filial" value={filial} opcoes={lookups.filiaisCliente} onChange={setFilial} padrao={padrao.filial} />
        <Escolha label="Tipo" value={tipo} opcoes={lookups.tiposCliente} onChange={mudarTipo} padrao={perfilDef.tipo} />
        <Escolha label="Conceito" value={conceito} opcoes={lookups.conceitos} onChange={setConceito} padrao={padrao.conceito} />
        <Escolha
          label="Pontualidade"
          value={pontualidade}
          opcoes={lookups.pontualidades}
          onChange={setPontualidade}
          padrao={padrao.pontualidade}
        />
        <Escolha
          label="Transportadora (cadastro)"
          value={transportadora}
          opcoes={lookups.transportadoras}
          onChange={setTransportadora}
          padrao={perfilDef.transportadora}
        />
        <Escolha
          label="Condição de pagamento"
          value={condicao}
          opcoes={lookups.condicoesPgto}
          onChange={setCondicao}
          padrao={padrao.condicaoPgto}
        />
        <Escolha label="Tabela de preço" value={tabela} opcoes={lookups.tabelasPreco} onChange={setTabela} padrao={perfilDef.codigoTabPreco} />
        <Escolha label="Região" value={regiao} opcoes={lookups.regioes} onChange={setRegiaoManual} />
        <Escolha
          label="Representante"
          value={representante}
          opcoes={lookups.representantes}
          onChange={setRepresentante}
          padrao={padrao.representante}
        />
        <Escolha label="Conta contábil" value={conta} opcoes={contas} onChange={setConta} padrao={perfilDef.contaContabil} />
        <Campo label="Limite de crédito" value={limite} onChange={setLimite} alterado={limite !== "0"} />
      </div>
      <label className={styles.campo}>
        <span className={styles.label}>Observação de faturamento (opc.)</span>
        <textarea className={styles.textarea} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </label>

      {duplicados && (
        <div className={styles.avisoBox}>
          <strong>Este CNPJ já tem cadastro no Linx.</strong> Use o existente sempre que for a mesma empresa:
          <ul className={styles.lista}>
            {duplicados.map((d) => (
              <li key={d.codigo}>
                {d.codigo} — {d.nome} <span className={styles.muted}>({d.filial || "sem filial"})</span>{" "}
                <button type="button" className={`${styles.btnTexto} ${styles.btnMini}`} onClick={() => onUsarExistente(d.codigo)}>
                  usar este
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={`${styles.btn} ${styles.btnMini}`} onClick={() => salvar(true)} disabled={salvando}>
            Cadastrar outro mesmo assim
          </button>
        </div>
      )}
      {erro && <div className={styles.erroBox}>{erro}</div>}

      <div className={styles.acoes}>
        <button
          type="button"
          className={styles.btnPrimario}
          onClick={() => salvar(false)}
          disabled={salvando || cnpjDigitos.length !== 14}
        >
          {salvando ? "Gravando no Linx…" : `Cadastrar PJ ${perfilDef.rotulo} no Linx`}
        </button>
        <button type="button" className={styles.btnTexto} onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
