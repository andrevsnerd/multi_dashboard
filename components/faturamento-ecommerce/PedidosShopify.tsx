"use client";

import { useState, type FormEvent } from "react";

import type { EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { ClienteFatDetalhe, PedidoShopifyImport, PedidoShopifyResumo } from "@/lib/faturamento-ecommerce/types";

import { fmtBRL, fmtDataHora, fmtDoc, useFatApi } from "./api";
import styles from "./FaturamentoEcommerce.module.css";

const notasTxt = (notas: { nf: string; filial: string; provavel?: boolean }[]) =>
  notas.map((n) => `${n.nf}${n.provavel ? " (provável)" : ""}`).join(", ");

/** Lista de pedidos pagos do Shopify da empresa, com as NFs já emitidas. */
export function PedidosShopifyCard({
  empresa,
  filialNota,
  onImportado,
}: {
  empresa: EmpresaFat;
  /** Filial emissora (estoque mostrado nos itens importados). */
  filialNota: string;
  onImportado: (p: PedidoShopifyImport) => void;
}) {
  const { get } = useFatApi(empresa);
  const [aberto, setAberto] = useState(true);
  const [busca, setBusca] = useState("");
  const [dias, setDias] = useState("7");
  const [soSemNf, setSoSemNf] = useState(true);
  const [lista, setLista] = useState<PedidoShopifyResumo[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async (e?: FormEvent) => {
    e?.preventDefault();
    setCarregando(true);
    setErro(null);
    try {
      setLista(await get<PedidoShopifyResumo[]>("/shopify/pedidos", { busca, dias }));
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  const importar = async (nome: string) => {
    setImportando(nome);
    setErro(null);
    try {
      onImportado(await get<PedidoShopifyImport>("/shopify/pedido", { nome, filial: filialNota }));
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setImportando(null);
    }
  };

  const visiveis = (lista ?? []).filter((p) => !soSemNf || p.notas.length === 0);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Importar pedido do Shopify</h2>
        <button type="button" className={styles.btnTexto} onClick={() => setAberto((v) => !v)}>
          {aberto ? "recolher" : "abrir"}
        </button>
      </div>
      {aberto && (
        <>
          <form className={styles.linhaBusca} onSubmit={carregar}>
            <input
              className={styles.input}
              placeholder="nº do pedido (#1711) ou nome do cliente — vazio = últimos pedidos pagos"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <select className={styles.select} style={{ width: 130, flex: "0 0 130px" }} value={dias} onChange={(e) => setDias(e.target.value)}>
              <option value="3">3 dias</option>
              <option value="7">7 dias</option>
              <option value="15">15 dias</option>
              <option value="30">30 dias</option>
            </select>
            <label className={styles.check}>
              <input type="checkbox" checked={soSemNf} onChange={(e) => setSoSemNf(e.target.checked)} />
              só sem NF
            </label>
            <button type="submit" className={styles.btn} disabled={carregando}>
              {carregando ? "Carregando…" : "Listar pedidos"}
            </button>
          </form>
          {erro && <div className={styles.erroBox}>{erro}</div>}
          {lista && (
            <div className={styles.tabelaWrap} style={{ maxHeight: 340, overflowY: "auto" }}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Destino</th>
                    <th className={styles.num}>Peças</th>
                    <th className={styles.num}>Total</th>
                    <th>NF no Linx</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visiveis.length === 0 && (
                    <tr>
                      <td colSpan={8} className={styles.vazio}>
                        {soSemNf && lista.length > 0 ? "Todos os pedidos listados já têm NF." : "Nenhum pedido pago encontrado."}
                      </td>
                    </tr>
                  )}
                  {visiveis.map((p) => (
                    <tr key={p.nome}>
                      <td className={styles.mono}>{p.nome}</td>
                      <td>{new Date(p.criadoEm).toLocaleString("pt-BR")}</td>
                      <td>
                        {p.cliente}
                        <div className={styles.muted}>{p.pagamento}</div>
                      </td>
                      <td>
                        {p.cidade}/{p.uf}
                      </td>
                      <td className={styles.num}>{p.pecas}</td>
                      <td className={styles.num}>{fmtBRL(p.total)}</td>
                      <td>
                        {p.notas.length ? (
                          <span className={`${styles.badge} ${styles.badge_ok}`}>{notasTxt(p.notas)}</span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badge_alerta}`}>sem NF</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnMini}`}
                          onClick={() => importar(p.nome)}
                          disabled={importando !== null}
                        >
                          {importando === p.nome ? "Importando…" : "Importar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.muted}>
            “NF no Linx” vem do nº do pedido na OBS da NF; “provável” = NF do mesmo CPF com o mesmo valor (NF antiga sem o nº
            na OBS).
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Pedido importado: dados do cliente vindos do Shopify e os cadastros parecidos no
 * Linx. Daqui o usuário usa um cadastro existente (podendo atualizar o endereço com o
 * do pedido) ou cadastra um novo já preenchido — e avança para o faturamento.
 */
export function ImportacaoClienteCard({
  empresa,
  pedido,
  podeGravar,
  onAvancar,
  onCadastrarNovo,
  onDescartar,
}: {
  empresa: EmpresaFat;
  pedido: PedidoShopifyImport;
  podeGravar: boolean;
  onAvancar: (c: ClienteFatDetalhe) => void;
  onCadastrarNovo: () => void;
  onDescartar: () => void;
}) {
  const api = useFatApi(empresa);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const c = pedido.cliente;
  const e = c.endereco;

  const usar = async (codigo: string, atualizar: boolean) => {
    setOcupado(codigo);
    setErro(null);
    try {
      const detalhe = atualizar
        ? await api.send<ClienteFatDetalhe>(`/clientes/${codigo}`, "PATCH", {
            endereco: c.endereco,
            ddd: c.ddd,
            telefone: c.telefone,
            email: c.email,
            emailNfe: c.email,
            regiao: c.regiao,
          })
        : await api.get<ClienteFatDetalhe>(`/clientes/${codigo}`);
      onAvancar(detalhe);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          Pedido {pedido.nome} — {c.razaoSocial}
        </h2>
        <button type="button" className={styles.btnTexto} onClick={onDescartar}>
          descartar importação
        </button>
      </div>
      {pedido.notas.length > 0 && (
        <div className={styles.avisoBox}>
          <strong>Este pedido já tem NF no Linx: {notasTxt(pedido.notas)}.</strong> Confira antes de faturar de novo.
        </div>
      )}
      <div className={styles.duasColunas}>
        <dl className={styles.kv}>
          <dt>Pedido</dt>
          <dd>
            {fmtDataHora(pedido.criadoEm)} · {pedido.pagamento} · total {fmtBRL(pedido.totalShopify)}
          </dd>
          <dt>CPF/CNPJ</dt>
          <dd>{c.cpfCnpj ? fmtDoc(c.cpfCnpj) : <span className={`${styles.badge} ${styles.badge_erro}`}>não veio no pedido</span>}</dd>
          <dt>E-mail / tel.</dt>
          <dd>
            {c.email || "—"} · ({c.ddd}) {c.telefone}
          </dd>
        </dl>
        <dl className={styles.kv}>
          <dt>No site</dt>
          <dd className={styles.muted}>{c.enderecoOriginal}</dd>
          <dt>Para o Linx</dt>
          <dd>
            {e.endereco}, {e.numero}
            {e.complemento ? ` — ${e.complemento}` : ""} · {e.bairro} · {e.cidade}/{e.uf} · CEP {e.cep}
            {!e.codMunicipioIbge && <div className={`${styles.badge} ${styles.badge_erro}`}>CEP sem município IBGE — confira no cadastro</div>}
          </dd>
        </dl>
      </div>

      <h3 className={styles.cardTitle}>Clientes parecidos no Linx</h3>
      {pedido.candidatos.length === 0 ? (
        <div className={styles.infoBox}>Nenhum cliente com este CPF ou nome parecido — é cliente novo.</div>
      ) : (
        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>CPF</th>
                <th>Endereço no Linx</th>
                <th>Filial</th>
                <th>Por quê</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pedido.candidatos.map((k) => (
                <tr key={k.codigo}>
                  <td className={styles.mono}>{k.codigo}</td>
                  <td>
                    {k.razaoSocial}
                    {k.nomeClifor !== k.razaoSocial.slice(0, 25) && <div className={styles.muted}>Linx: {k.nomeClifor}</div>}
                  </td>
                  <td className={styles.mono}>{fmtDoc(k.cpfCnpj)}</td>
                  <td>
                    CEP {k.cep}, nº {k.numero} · {k.cidade}/{k.uf}
                    {k.enderecoDifere && <div className={`${styles.badge} ${styles.badge_alerta}`}>endereço diferente do pedido</div>}
                  </td>
                  <td>{k.filial}</td>
                  <td>
                    <span className={`${styles.badge} ${k.forte ? styles.badge_ok : styles.badge_neutro}`}>{k.motivo}</span>
                  </td>
                  <td>
                    <div className={styles.acoes}>
                      <button
                        type="button"
                        className={`${styles.btnPrimario} ${styles.btnMini}`}
                        onClick={() => usar(k.codigo, false)}
                        disabled={ocupado !== null}
                      >
                        Usar e avançar →
                      </button>
                      {podeGravar && k.enderecoDifere && (
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnMini}`}
                          onClick={() => usar(k.codigo, true)}
                          disabled={ocupado !== null || !e.codMunicipioIbge}
                          title="Grava o endereço/contato do pedido neste cadastro (as 3 vias) e avança"
                        >
                          Atualizar endereço e avançar →
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {erro && <div className={styles.erroBox}>{erro}</div>}
      {podeGravar && (
        <div className={styles.acoes}>
          <button type="button" className={pedido.candidatos.some((k) => k.forte) ? styles.btn : styles.btnPrimario} onClick={onCadastrarNovo}>
            Cadastrar cliente novo com os dados do pedido
          </button>
          {pedido.candidatos.some((k) => k.forte) && (
            <span className={styles.muted}>Já existe cadastro com este CPF — prefira usar o existente.</span>
          )}
        </div>
      )}
    </div>
  );
}
