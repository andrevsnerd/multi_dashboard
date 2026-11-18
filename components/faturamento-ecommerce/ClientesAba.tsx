"use client";

import { useState, type FormEvent } from "react";

import { PADROES, regiaoDaUf, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type {
  ClienteFatDetalhe,
  ClienteFatInput,
  ClienteFatListItem,
  EnderecoFat,
  FatLookups,
  PedidoShopifyImport,
} from "@/lib/faturamento-ecommerce/types";

import { ApiErro, fmtData, fmtDoc, useFatApi } from "./api";
import { Campo, CamposEndereco, ENDERECO_VAZIO, Escolha } from "./CamposCliente";
import ClientePjForm, { type ClientePjInicial } from "./ClientePjForm";
import { ImportacaoClienteCard, PedidosShopifyCard } from "./PedidosShopify";
import styles from "./FaturamentoEcommerce.module.css";

interface Props {
  empresa: EmpresaFat;
  lookups: FatLookups;
  podeGravar: boolean;
  /** Avança para a aba Faturamento já com este cliente. */
  onUsarCliente: (c: ClienteFatDetalhe) => void;
  /** Pedido do Shopify importado (dados do cliente + itens para a NF). */
  pedido: PedidoShopifyImport | null;
  onPedidoImportado: (p: PedidoShopifyImport) => void;
  onDescartarPedido: () => void;
}

type Modo = "busca" | "novo" | "novoPj" | "endereco";

const soDigitos = (s: string | undefined) => String(s ?? "").replace(/\D/g, "");

/** Dados já digitados (ou vindos do pedido) levados para o cadastro PJ. */
function inicialPjDe(c: ClienteFatInput): ClientePjInicial {
  return {
    cnpj: c.cpfCnpj,
    razaoSocial: c.razaoSocial,
    email: c.email ?? "",
    ddd: c.ddd ?? "",
    telefone: c.telefone ?? "",
    endereco: c.endereco,
  };
}

export default function ClientesAba({
  empresa,
  lookups,
  podeGravar,
  onUsarCliente,
  pedido,
  onPedidoImportado,
  onDescartarPedido,
}: Props) {
  const api = useFatApi(empresa);
  const [modo, setModo] = useState<Modo>("busca");
  const [termo, setTermo] = useState("");
  const [todos, setTodos] = useState(false);
  const [resultados, setResultados] = useState<ClienteFatListItem[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<ClienteFatDetalhe | null>(null);
  const [recemCadastrado, setRecemCadastrado] = useState<string | null>(null);
  /** Cadastro novo pré-preenchido com os dados do pedido do Shopify. */
  const [inicialNovo, setInicialNovo] = useState<ClienteFatInput | null>(null);
  /** Cadastro PJ pré-preenchido (pedido do Shopify com CNPJ ou vindo do form de pessoa física). */
  const [inicialPj, setInicialPj] = useState<{ dados: ClientePjInicial; origem: string | null } | null>(null);
  const [avancando, setAvancando] = useState<string | null>(null);

  const abrirPj = (dados: ClientePjInicial | null, origem: string | null) => {
    setInicialPj(dados ? { dados, origem } : null);
    setModo("novoPj");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Carrega o cadastro completo e vai direto para o faturamento. */
  const avancar = async (codigo: string) => {
    setAvancando(codigo);
    setErro(null);
    try {
      onUsarCliente(await api.get<ClienteFatDetalhe>(`/clientes/${codigo}`));
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setAvancando(null);
    }
  };

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!termo.trim()) return;
    setCarregando(true);
    setErro(null);
    try {
      setResultados(await api.get<ClienteFatListItem[]>("/clientes", { q: termo, todos: todos ? "1" : undefined }));
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  const abrir = async (codigo: string) => {
    setErro(null);
    setRecemCadastrado(null);
    try {
      setSelecionado(await api.get<ClienteFatDetalhe>(`/clientes/${codigo}`));
      setModo("busca");
    } catch (err) {
      setErro((err as Error).message);
    }
  };

  return (
    <div className={styles.wrapper}>
      {modo === "busca" && (
        <PedidosShopifyCard
          empresa={empresa}
          filialNota={lookups.filialNotaPadrao}
          onImportado={(p) => {
            onPedidoImportado(p);
            setSelecionado(null);
          }}
        />
      )}

      {modo === "busca" && pedido && (
        <ImportacaoClienteCard
          key={pedido.nome}
          empresa={empresa}
          pedido={pedido}
          podeGravar={podeGravar}
          onAvancar={onUsarCliente}
          onDescartar={onDescartarPedido}
          onCadastrarNovo={() => {
            // Pedido com CNPJ vai para o cadastro PJ; com CPF, para o de pessoa física.
            if (soDigitos(pedido.cliente.cpfCnpj).length === 14) {
              abrirPj(inicialPjDe(pedido.cliente), `pedido ${pedido.nome} do Shopify`);
              return;
            }
            setInicialNovo({ ...pedido.cliente });
            setModo("novo");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}

      {modo === "busca" && (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Encontrar cliente</h2>
            {podeGravar && (
              <div className={styles.acoes}>
                <button
                  type="button"
                  className={styles.btnPrimario}
                  onClick={() => {
                    setInicialNovo(null);
                    setModo("novo");
                  }}
                >
                  + Cadastrar pessoa física (CPF)
                </button>
                <button type="button" className={styles.btn} onClick={() => abrirPj(null, null)}>
                  + Cadastrar PJ (CNPJ)
                </button>
              </div>
            )}
          </div>
          <form className={styles.linhaBusca} onSubmit={buscar}>
            <input
              className={styles.input}
              placeholder="CPF/CNPJ, código do cliente ou nome"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              autoFocus
            />
            <label className={styles.check}>
              <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
              incluir clientes de outras empresas
            </label>
            <button type="submit" className={styles.btn} disabled={carregando || !termo.trim()}>
              {carregando ? "Buscando…" : "Buscar"}
            </button>
          </form>
          <p className={styles.muted}>
            Busque sempre pelo CPF primeiro: o Linx tem clientes cadastrados mais de uma vez. Por padrão aparecem os
            clientes da {PADROES[empresa].nome} (cadastro na filial {PADROES[empresa].cliente.filial} ou com NF dela).
          </p>
          {erro && <div className={styles.erroBox}>{erro}</div>}
          {resultados && (
            <div className={styles.tabelaWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Nome</th>
                    <th>CPF/CNPJ</th>
                    <th>Cidade</th>
                    <th>Filial do cadastro</th>
                    <th>Cadastro</th>
                    <th>Última NF</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {resultados.length === 0 && (
                    <tr>
                      <td colSpan={8} className={styles.vazio}>
                        Nenhum cliente encontrado.{" "}
                        {!todos && "Tente marcar “incluir clientes de outras empresas”."}
                      </td>
                    </tr>
                  )}
                  {resultados.map((c) => (
                    <tr
                      key={c.codigo}
                      className={`${styles.trClick} ${selecionado?.codigo === c.codigo ? styles.trSel : ""}`}
                      onClick={() => abrir(c.codigo)}
                    >
                      <td className={styles.mono}>{c.codigo}</td>
                      <td>
                        {c.razaoSocial}
                        {c.nomeClifor.trim() !== c.razaoSocial.slice(0, 25).trim() && (
                          <div className={styles.muted}>Linx: “{c.nomeClifor}”</div>
                        )}
                      </td>
                      <td className={styles.mono}>{fmtDoc(c.cpfCnpj)}</td>
                      <td>
                        {c.cidade}/{c.uf}
                      </td>
                      <td>{c.filial}</td>
                      <td>{fmtData(c.cadastramento)}</td>
                      <td>
                        {c.ultimaNf ? (
                          <>
                            {c.ultimaNf} <span className={styles.muted}>{fmtData(c.ultimaNfEmissao)}</span>
                            <div className={styles.muted}>{c.ultimaNfFilial}</div>
                          </>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.btnPrimario} ${styles.btnMini}`}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void avancar(c.codigo);
                          }}
                          disabled={avancando !== null}
                        >
                          {avancando === c.codigo ? "…" : "Avançar →"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modo === "busca" && selecionado && recemCadastrado === selecionado.codigo && (
        <div className={styles.okBox}>
          <strong>Cliente {selecionado.codigo} cadastrado no Linx.</strong>
          <div className={styles.acoes}>
            <button type="button" className={styles.btnPrimario} onClick={() => onUsarCliente(selecionado)}>
              Avançar para faturamento →
            </button>
          </div>
        </div>
      )}

      {modo === "busca" && selecionado && (
        <ClienteDetalheCard
          cliente={selecionado}
          podeGravar={podeGravar}
          onUsar={() => onUsarCliente(selecionado)}
          onAtualizarEndereco={() => setModo("endereco")}
        />
      )}

      {modo === "novo" && (
        <NovoClienteForm
          key={inicialNovo ? `pedido-${pedido?.nome ?? ""}` : "manual"}
          empresa={empresa}
          lookups={lookups}
          inicial={inicialNovo}
          origem={inicialNovo && pedido ? `pedido ${pedido.nome} do Shopify` : null}
          onCancelar={() => setModo("busca")}
          onCriado={async (codigo) => {
            await abrir(codigo);
            setRecemCadastrado(codigo);
          }}
          onUsarExistente={abrir}
          onAbrirPj={(dados) => abrirPj(dados, "cadastro de pessoa física")}
        />
      )}

      {modo === "novoPj" && (
        <ClientePjForm
          key={inicialPj ? `pj-${inicialPj.origem ?? ""}-${inicialPj.dados.cnpj}` : "pj-manual"}
          empresa={empresa}
          lookups={lookups}
          inicial={inicialPj?.dados ?? null}
          origem={inicialPj?.origem ?? null}
          onCancelar={() => setModo("busca")}
          onCriado={async (codigo) => {
            await abrir(codigo);
            setRecemCadastrado(codigo);
          }}
          onUsarExistente={abrir}
        />
      )}

      {modo === "endereco" && selecionado && (
        <AtualizarEnderecoForm
          empresa={empresa}
          lookups={lookups}
          cliente={selecionado}
          onCancelar={() => setModo("busca")}
          onSalvo={(c) => {
            setSelecionado(c);
            setModo("busca");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </div>
  );
}

// ── Detalhe ─────────────────────────────────────────────────────────────────

function ClienteDetalheCard({
  cliente,
  podeGravar,
  onUsar,
  onAtualizarEndereco,
}: {
  cliente: ClienteFatDetalhe;
  podeGravar: boolean;
  onUsar: () => void;
  onAtualizarEndereco: () => void;
}) {
  const e = cliente.endereco;
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          Cliente {cliente.codigo} — {cliente.razaoSocial}
        </h2>
        <div className={styles.acoes}>
          {podeGravar && (
            <button type="button" className={styles.btn} onClick={onAtualizarEndereco}>
              Atualizar endereço / contato
            </button>
          )}
          <button type="button" className={styles.btnPrimario} onClick={onUsar}>
            Avançar para faturamento →
          </button>
        </div>
      </div>
      {cliente.enderecoEntregaDiferente && (
        <div className={styles.avisoBox}>
          O endereço de entrega deste cadastro é diferente do principal. Confira antes de faturar.
        </div>
      )}
      <div className={styles.duasColunas}>
        <dl className={styles.kv}>
          <dt>Nome no Linx</dt>
          <dd className={styles.mono}>{cliente.nomeClifor}</dd>
          <dt>CPF/CNPJ</dt>
          <dd>{fmtDoc(cliente.cpfCnpj)}</dd>
          <dt>Insc. Est. / RG</dt>
          <dd>{cliente.rgIe || "—"}</dd>
          <dt>Endereço</dt>
          <dd>
            {e.endereco}, {e.numero}
            {e.complemento ? ` — ${e.complemento}` : ""}
            <br />
            {e.bairro} — {e.cidade}/{e.uf} — CEP {e.cep} (IBGE {e.codMunicipioIbge || "—"})
          </dd>
          <dt>Telefone</dt>
          <dd>
            {cliente.ddd} {cliente.telefone}
          </dd>
          <dt>E-mail / NF-e</dt>
          <dd>
            {cliente.email || "—"}
            {cliente.emailNfe && cliente.emailNfe !== cliente.email ? ` / ${cliente.emailNfe}` : ""}
          </dd>
        </dl>
        <dl className={styles.kv}>
          <dt>Filial</dt>
          <dd>{cliente.filial}</dd>
          <dt>Tipo / Conceito</dt>
          <dd>
            {cliente.tipo} / {cliente.conceito}
          </dd>
          <dt>Região</dt>
          <dd>{cliente.regiao}</dd>
          <dt>Cond. pagamento</dt>
          <dd>{cliente.condicaoPgto}</dd>
          <dt>Tabela de preço</dt>
          <dd>{cliente.codigoTabPreco}</dd>
          <dt>Transportadora</dt>
          <dd>{cliente.transportadora}</dd>
          <dt>Representante</dt>
          <dd>{cliente.representante || "—"}</dd>
          <dt>Cadastrado em</dt>
          <dd>{fmtData(cliente.cadastramento)}</dd>
        </dl>
      </div>
    </div>
  );
}


// ── Novo cadastro ───────────────────────────────────────────────────────────

function NovoClienteForm({
  empresa,
  lookups,
  inicial,
  origem,
  onCancelar,
  onCriado,
  onUsarExistente,
  onAbrirPj,
}: {
  empresa: EmpresaFat;
  lookups: FatLookups;
  inicial: ClienteFatInput | null;
  origem: string | null;
  onCancelar: () => void;
  onCriado: (codigo: string) => void;
  onUsarExistente: (codigo: string) => void;
  /** CNPJ digitado aqui: leva os dados para o cadastro PJ. */
  onAbrirPj: (dados: ClientePjInicial) => void;
}) {
  const api = useFatApi(empresa);
  const padrao = PADROES[empresa].cliente;
  const [nome, setNome] = useState(inicial?.razaoSocial ?? "");
  const [cpf, setCpf] = useState(inicial?.cpfCnpj ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [ddd, setDdd] = useState(inicial?.ddd ?? "");
  const [telefone, setTelefone] = useState(inicial?.telefone ?? "");
  const [endereco, setEndereco] = useState<EnderecoFat>(inicial?.endereco ?? ENDERECO_VAZIO);
  const [filial, setFilial] = useState(padrao.filial);
  const [tipo, setTipo] = useState(padrao.tipo);
  const [conceito, setConceito] = useState(padrao.conceito);
  const [pontualidade, setPontualidade] = useState(padrao.pontualidade);
  const [transportadora, setTransportadora] = useState(padrao.transportadora);
  const [condicao, setCondicao] = useState(padrao.condicaoPgto);
  const [tabela, setTabela] = useState(padrao.codigoTabPreco);
  const [conta, setConta] = useState(padrao.contaContabil);
  const [regiaoManual, setRegiaoManual] = useState<string | null>(null);
  const [representante, setRepresentante] = useState(padrao.representante);
  const [rgIe, setRgIe] = useState(padrao.rgIe);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [duplicados, setDuplicados] = useState<{ codigo: string; nome: string; filial: string }[] | null>(null);

  const regiao = regiaoManual ?? regiaoDaUf(endereco.uf);
  const nomeLinx = nome.trim().toUpperCase().slice(0, 25);
  // CNPJ não entra por aqui: o cadastro PJ tem IE, indicador fiscal e padrões próprios.
  const ehCnpj = soDigitos(cpf).length === 14;

  const salvar = async (forcar = false) => {
    if (ehCnpj) return;
    setSalvando(true);
    setErro(null);
    try {
      const cliente: ClienteFatInput = {
        razaoSocial: nome,
        cpfCnpj: cpf,
        rgIe,
        endereco,
        ddd,
        telefone,
        email,
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
        forcar,
      };
      const r = await api.send<{ codigo: string }>("/clientes", "POST", { cliente: cliente as unknown as Record<string, unknown> });
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
        <h2 className={styles.cardTitle}>Cadastrar cliente</h2>
        <span className={styles.muted}>Próximo código: {lookups.proximoCodigoCliente || "—"}</span>
      </div>
      {origem && (
        <div className={styles.infoBox}>
          Preenchido com os dados do {origem}. Confira nome, número e complemento antes de cadastrar.
        </div>
      )}

      <div className={styles.grid}>
        <Campo label="Nome completo *" span={2} value={nome} onChange={setNome} placeholder="como no pedido do site" />
        <Campo label="CPF *" value={cpf} onChange={setCpf} />
        <Campo label="E-mail (também p/ NF-e)" span={2} value={email} onChange={setEmail} type="email" />
        <Campo label="DDD" value={ddd} onChange={setDdd} placeholder="11" />
        <Campo label="Telefone" value={telefone} onChange={setTelefone} />
      </div>
      {ehCnpj && (
        <div className={styles.avisoBox}>
          <strong>Isto é um CNPJ.</strong> Empresa se cadastra pelo cadastro PJ, que tem inscrição estadual, indicador
          fiscal e os padrões do corporativo.
          <div className={styles.acoes}>
            <button
              type="button"
              className={`${styles.btnPrimario} ${styles.btnMini}`}
              onClick={() => onAbrirPj({ cnpj: cpf, razaoSocial: nome, email, ddd, telefone, endereco })}
            >
              Abrir cadastro PJ com estes dados →
            </button>
          </div>
        </div>
      )}
      {nome.trim().length > 25 && (
        <p className={styles.muted}>
          O Linx guarda o nome curto com 25 letras: <strong>{nomeLinx}</strong> (o nome completo vai na razão social).
        </p>
      )}

      <CamposEndereco empresa={empresa} endereco={endereco} onChange={setEndereco} />

      <h3 className={styles.cardTitle}>Padrões do cadastro (pode alterar)</h3>
      <div className={styles.grid}>
        <Escolha label="Filial" value={filial} opcoes={lookups.filiaisCliente} onChange={setFilial} padrao={padrao.filial} />
        <Escolha label="Tipo" value={tipo} opcoes={lookups.tiposCliente} onChange={setTipo} padrao={padrao.tipo} />
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
          padrao={padrao.transportadora}
        />
        <Escolha
          label="Condição de pagamento"
          value={condicao}
          opcoes={lookups.condicoesPgto}
          onChange={setCondicao}
          padrao={padrao.condicaoPgto}
        />
        <Escolha label="Tabela de preço" value={tabela} opcoes={lookups.tabelasPreco} onChange={setTabela} padrao={padrao.codigoTabPreco} />
        <Escolha label="Região" value={regiao} opcoes={lookups.regioes} onChange={setRegiaoManual} />
        <Escolha
          label="Representante"
          value={representante}
          opcoes={lookups.representantes}
          onChange={setRepresentante}
          padrao={padrao.representante}
        />
        <Campo label="Conta contábil" value={conta} onChange={setConta} alterado={conta !== padrao.contaContabil} />
        <Campo label="Insc. Est. / RG" value={rgIe} onChange={setRgIe} alterado={rgIe !== padrao.rgIe} />
      </div>

      {duplicados && (
        <div className={styles.avisoBox}>
          <strong>Este CPF/CNPJ já tem cadastro no Linx.</strong> Use o existente sempre que for a mesma pessoa:
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
            É outra pessoa — cadastrar mesmo assim
          </button>
        </div>
      )}
      {erro && <div className={styles.erroBox}>{erro}</div>}

      <div className={styles.acoes}>
        <button type="button" className={styles.btnPrimario} onClick={() => salvar(false)} disabled={salvando || ehCnpj}>
          {salvando ? "Gravando no Linx…" : "Cadastrar no Linx"}
        </button>
        <button type="button" className={styles.btnTexto} onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Atualizar endereço / contato ─────────────────────────────────────────────

function AtualizarEnderecoForm({
  empresa,
  lookups,
  cliente,
  onCancelar,
  onSalvo,
}: {
  empresa: EmpresaFat;
  lookups: FatLookups;
  cliente: ClienteFatDetalhe;
  onCancelar: () => void;
  onSalvo: (c: ClienteFatDetalhe) => void;
}) {
  const api = useFatApi(empresa);
  const [endereco, setEndereco] = useState<EnderecoFat>(cliente.endereco);
  const [ddd, setDdd] = useState(cliente.ddd.replace(/^0+/, ""));
  const [telefone, setTelefone] = useState(cliente.telefone);
  const [email, setEmail] = useState(cliente.email);
  const [regiaoManual, setRegiaoManual] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const regiao = regiaoManual ?? regiaoDaUf(endereco.uf);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      onSalvo(
        await api.send<ClienteFatDetalhe>(`/clientes/${cliente.codigo}`, "PATCH", {
          endereco,
          ddd,
          telefone,
          email,
          emailNfe: email,
          regiao,
        })
      );
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>
        Atualizar endereço — {cliente.codigo} {cliente.razaoSocial}
      </h2>
      <p className={styles.muted}>Grava o mesmo endereço como principal, cobrança e entrega (padrão do e-commerce).</p>
      <CamposEndereco empresa={empresa} endereco={endereco} onChange={setEndereco} />
      <div className={styles.grid}>
        <Campo label="DDD" value={ddd} onChange={setDdd} />
        <Campo label="Telefone" value={telefone} onChange={setTelefone} />
        <Campo label="E-mail (também p/ NF-e)" span={2} value={email} onChange={setEmail} />
        <Escolha label="Região" value={regiao} opcoes={lookups.regioes} onChange={setRegiaoManual} />
      </div>
      {erro && <div className={styles.erroBox}>{erro}</div>}
      <div className={styles.acoes}>
        <button type="button" className={styles.btnPrimario} onClick={salvar} disabled={salvando}>
          {salvando ? "Gravando…" : "Salvar no Linx"}
        </button>
        <button type="button" className={styles.btnTexto} onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
