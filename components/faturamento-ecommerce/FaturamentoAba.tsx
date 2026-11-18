"use client";

import { useMemo, useState, type FormEvent } from "react";

import { PADROES, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type {
  ClienteFatDetalhe,
  FatLookups,
  NotaCriada,
  NotaInput,
  NotaListItem,
  NotaPreview,
  PedidoShopifyImport,
  ProdutoFatOpcao,
} from "@/lib/faturamento-ecommerce/types";

import { dataLocal, fmtBRL, fmtData, fmtDoc, useFatApi } from "./api";
import NotaDetalheModal from "./NotaDetalheModal";
import styles from "./FaturamentoEcommerce.module.css";

interface Props {
  empresa: EmpresaFat;
  lookups: FatLookups;
  podeGravar: boolean;
  cliente: ClienteFatDetalhe | null;
  onTrocarCliente: (c: ClienteFatDetalhe | null) => void;
  onIrParaClientes: () => void;
  onIrParaMonitor: () => void;
  /** Pedido do Shopify importado: itens, desconto, frete e OBS já preenchidos. */
  pedido: PedidoShopifyImport | null;
  onImportarPedido: (nome: string) => Promise<void>;
  onDescartarPedido: () => void;
  onNotaGravada: () => void;
}

export default function FaturamentoAba(props: Props) {
  const [sub, setSub] = useState<"nova" | "buscar">("nova");
  return (
    <div className={styles.wrapper}>
      <div className={styles.subtabs}>
        <button
          type="button"
          className={`${styles.subtab} ${sub === "nova" ? styles.subtabAtiva : ""}`}
          onClick={() => setSub("nova")}
        >
          Nova NF
        </button>
        <button
          type="button"
          className={`${styles.subtab} ${sub === "buscar" ? styles.subtabAtiva : ""}`}
          onClick={() => setSub("buscar")}
        >
          Encontrar NF
        </button>
      </div>
      <div hidden={sub !== "nova"}>
        <NovaNota key={props.pedido?.nome ?? "manual"} {...props} />
      </div>
      <div hidden={sub !== "buscar"}>
        <BuscarNotas empresa={props.empresa} lookups={props.lookups} />
      </div>
    </div>
  );
}

// ── Nova NF ─────────────────────────────────────────────────────────────────

interface ItemTela {
  chave: string;
  produto: string;
  descricao: string;
  cor: string;
  descCor: string;
  tamanho: number;
  tamanhoLabel: string;
  qtde: number;
  preco: number;
  estoque: number | null;
}

/** "1.234,56" e "1234,56" → vírgula decimal; "198.00" → ponto decimal. */
const n = (v: string) => {
  const s = String(v).trim();
  const x = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(x) ? x : 0;
};
const numTxt = (v: number) => (Number.isFinite(v) ? String(v).replace(".", ",") : "");

function NovaNota({
  empresa,
  lookups,
  podeGravar,
  cliente,
  onTrocarCliente,
  onIrParaClientes,
  onIrParaMonitor,
  pedido,
  onImportarPedido,
  onDescartarPedido,
  onNotaGravada,
}: Props) {
  const api = useFatApi(empresa);
  const padrao = PADROES[empresa].nota;

  const [filial, setFilialEscolhida] = useState(lookups.filialNotaPadrao);
  const filialInfo = lookups.filiaisNota.find((f) => f.filial === filial) ?? null;
  const ufFilial = filialInfo?.uf ?? "SP";
  const [naturezaManual, setNaturezaManual] = useState<string | null>(null);
  // Trocar de filial volta a natureza para a automática (a Matriz usa outras naturezas).
  const setFilial = (f: string) => {
    setFilialEscolhida(f);
    setNaturezaManual(null);
  };
  const [condicao, setCondicao] = useState(padrao.condicaoPgto);
  const [tipoFrete, setTipoFrete] = useState(padrao.tipoFrete);
  const [transp, setTransp] = useState(padrao.transportadora);
  const [redesp, setRedesp] = useState(padrao.transpRedespacho);
  const [frete, setFrete] = useState(pedido ? numTxt(pedido.frete) : "0");
  const [seguro, setSeguro] = useState("0");
  // Do Shopify o desconto vem em R$ (soma dos descontos dos itens), como o operador digita no Linx.
  const [descModo, setDescModo] = useState<"percentual" | "valor">(pedido ? "valor" : "percentual");
  const [desc, setDesc] = useState(pedido ? numTxt(pedido.descontoItens) : "0");
  const [pesoLiq, setPesoLiq] = useState(numTxt(padrao.pesoLiquido));
  const [pesoBruto, setPesoBruto] = useState(numTxt(padrao.pesoBruto));
  const [volumes, setVolumes] = useState(String(padrao.volumes));
  const [tipoVolume, setTipoVolume] = useState(padrao.tipoVolume);
  const [infoPgto, setInfoPgto] = useState(padrao.infoPgto);
  const [obs, setObs] = useState(pedido ? pedido.nome : "#");
  const [itens, setItens] = useState<ItemTela[]>(() =>
    (pedido?.itens ?? []).map((i) => ({
      chave: `${i.produto}|${i.cor}|${i.tamanho}`,
      produto: i.produto,
      descricao: i.descricao,
      cor: i.cor,
      descCor: i.descCor,
      tamanho: i.tamanho,
      tamanhoLabel: i.tamanhoLabel,
      qtde: i.qtde,
      preco: i.preco,
      estoque: i.estoque,
    }))
  );
  const [pedidoBusca, setPedidoBusca] = useState("");
  const [importando, setImportando] = useState(false);
  const [confirmarDup, setConfirmarDup] = useState(false);

  const [codigoCliente, setCodigoCliente] = useState("");
  const [erroCliente, setErroCliente] = useState<string | null>(null);

  const [previa, setPrevia] = useState<NotaPreview | null>(null);
  const [previaAssinatura, setPreviaAssinatura] = useState("");
  const [processando, setProcessando] = useState<null | "previa" | "simular" | "gravar">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [simulacaoFeita, setSimulacao] = useState<(NotaCriada & { assinatura: string }) | null>(null);
  const [gravada, setGravada] = useState<NotaCriada | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviarGravada, setEnviarGravada] = useState(false);

  // Natureza automática pela filial (e-commerce 100.02/100.022; Matriz 100.05, ou 100.08 para
  // cliente revendedor — indicador 16) e pela UF do cliente.
  const natDentro = filialInfo?.naturezaDentroUf ?? padrao.naturezaDentroUf;
  const natFora = filialInfo?.naturezaForaUf ?? padrao.naturezaForaUf;
  const naturezaAuto =
    filialInfo?.naturezaRevenda && cliente?.indicadorFiscal === "16"
      ? filialInfo.naturezaRevenda
      : cliente && cliente.endereco.uf && cliente.endereco.uf !== ufFilial
        ? natFora
        : natDentro;
  const natureza = naturezaManual ?? naturezaAuto;

  const nota: NotaInput = useMemo(
    () => ({
      empresa,
      filial,
      natureza,
      clienteCodigo: cliente?.codigo ?? "",
      condicaoPgto: condicao,
      tipoFrete,
      transportadora: transp,
      transpRedespacho: redesp,
      frete: n(frete),
      seguro: n(seguro),
      descontoModo: descModo,
      descontoPercentual: descModo === "percentual" ? n(desc) : 0,
      descontoValor: descModo === "valor" ? n(desc) : 0,
      pesoLiquido: n(pesoLiq),
      pesoBruto: n(pesoBruto),
      volumes: Math.round(n(volumes)),
      tipoVolume,
      infoPgto,
      obs: obs === "#" ? "" : obs,
      itens: itens.map((i) => ({ produto: i.produto, cor: i.cor, tamanho: i.tamanho, qtde: i.qtde, preco: i.preco })),
      confirmarDuplicidade: confirmarDup,
    }),
    [empresa, filial, natureza, cliente, condicao, tipoFrete, transp, redesp, frete, seguro, descModo, desc, pesoLiq, pesoBruto, volumes, tipoVolume, infoPgto, obs, itens, confirmarDup]
  );
  const assinatura = JSON.stringify(nota);
  const previaValida = previa !== null && previaAssinatura === assinatura;
  // Qualquer mudança no formulário invalida a simulação anterior.
  const simulacao = simulacaoFeita?.assinatura === assinatura ? simulacaoFeita : null;

  const carregarCliente = async (e?: FormEvent) => {
    e?.preventDefault();
    setErroCliente(null);
    try {
      onTrocarCliente(await api.get<ClienteFatDetalhe>(`/clientes/${codigoCliente.replace(/\D/g, "")}`));
      setNaturezaManual(null);
    } catch (err) {
      setErroCliente((err as Error).message);
    }
  };

  const conferir = async () => {
    setProcessando("previa");
    setErro(null);
    try {
      const p = await api.send<NotaPreview>("/notas/previa", "POST", { nota });
      setPrevia(p);
      setPreviaAssinatura(assinatura);
    } catch (err) {
      setErro((err as Error).message);
      setPrevia(null);
    } finally {
      setProcessando(null);
    }
  };

  const gravar = async (simular: boolean) => {
    setProcessando(simular ? "simular" : "gravar");
    setErro(null);
    setConfirmando(false);
    try {
      const r = await api.send<NotaCriada>("/notas", "POST", { nota, simular });
      if (simular) setSimulacao({ ...r, assinatura });
      else {
        setGravada(r);
        setPrevia(null);
        setItens([]);
        setObs("#");
        setFrete("0");
        setDesc("0");
        setConfirmarDup(false);
        onTrocarCliente(null);
        onNotaGravada();
      }
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setProcessando(null);
    }
  };

  return (
    <div className={styles.wrapper}>
      {gravada && (
        <div className={styles.okBox}>
          <strong>
            NF {gravada.nf} série {gravada.serie} gravada na filial {gravada.filial} — {fmtBRL(gravada.total)}.
          </strong>
          <div className={styles.mono}>Chave: {gravada.chave}</div>
          <div>
            Próximo passo: enviar para a SEFAZ (aqui, ou no Monitor de NF-e do Linx).
          </div>
          <div className={styles.acoes}>
            {podeGravar && (
              <button type="button" className={`${styles.btnPerigo} ${styles.btnMini}`} onClick={() => setEnviarGravada(true)}>
                Enviar para SEFAZ agora
              </button>
            )}
            <button type="button" className={`${styles.btn} ${styles.btnMini}`} onClick={onIrParaMonitor}>
              Ver no Monitor NF-e
            </button>
            <button type="button" className={`${styles.btnTexto} ${styles.btnMini}`} onClick={() => setGravada(null)}>
              fechar
            </button>
          </div>
        </div>
      )}

      {/* Pedido importado */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Pedido do Shopify</h2>
          {pedido && (
            <button type="button" className={styles.btnTexto} onClick={onDescartarPedido}>
              descartar e faturar manual
            </button>
          )}
        </div>
        {pedido ? (
          <>
            <div className={styles.clienteResumo}>
              <span>
                <strong>{pedido.nome}</strong> — {pedido.cliente.razaoSocial}
              </span>
              <span>{new Date(pedido.criadoEm).toLocaleString("pt-BR")}</span>
              <span>{pedido.pagamento}</span>
              <span>
                Shopify: produtos {fmtBRL(pedido.subtotalShopify + pedido.descontoItens)} − desc. {fmtBRL(pedido.descontoItens)} +
                frete {fmtBRL(pedido.frete)} = <strong>{fmtBRL(pedido.totalShopify)}</strong>
              </span>
            </div>
            {pedido.notas.length > 0 && (
              <div className={styles.avisoBox}>
                Este pedido já tem NF no Linx: {pedido.notas.map((x) => `${x.nf}${x.provavel ? " (provável)" : ""}`).join(", ")}.
              </div>
            )}
            {pedido.naoMapeados.length > 0 && (
              <div className={styles.avisoBox}>
                <strong>Itens do pedido que não entraram na NF</strong> (inclua manualmente se forem produto do Linx; o desconto
                acima só soma os itens que entraram):
                <ul className={styles.lista}>
                  {pedido.naoMapeados.map((x, k) => (
                    <li key={k}>
                      {x.qtde}× {x.titulo} {x.sku ? `(SKU ${x.sku})` : ""} — {fmtBRL(x.preco)} — {x.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pedido.itens.some((i) => !i.brinde && i.precoLinx !== null && Math.abs((i.precoLinx ?? 0) - i.preco) > 0.009) && (
              <div className={styles.avisoBox}>
                <strong>Preço do site diferente da tabela 01 do Linx</strong> — a NF vai com o preço do site (o que o cliente
                pagou); altere no item se for o caso:
                <ul className={styles.lista}>
                  {pedido.itens
                    .filter((i) => !i.brinde && i.precoLinx !== null && Math.abs((i.precoLinx ?? 0) - i.preco) > 0.009)
                    .map((i) => (
                      <li key={`${i.produto}|${i.cor}|${i.tamanho}`}>
                        {i.produto} {i.descCor}: site {fmtBRL(i.preco)} · Linx {fmtBRL(i.precoLinx)}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {pedido.itens.some((i) => i.brinde) && (
              <div className={styles.infoBox}>
                Brinde (preço zero no site) entra na NF a R$ 0,01, como o Linx faz:{" "}
                {pedido.itens.filter((i) => i.brinde).map((i) => `${i.produto} ${i.descCor}`).join(", ")}.
              </div>
            )}
            {pedido.itens.some((i) => i.origem.startsWith("lote anterior")) && (
              <div className={styles.infoBox}>
                Código sem estoque trocado pelo lote anterior da mesma peça:{" "}
                {pedido.itens.filter((i) => i.origem.startsWith("lote anterior")).map((i) => `${i.tituloShopify} → ${i.produto} ${i.cor}`).join("; ")}.
              </div>
            )}
            {pedido.itens.some((i) => i.conferir && !i.origem.startsWith("lote anterior")) && (
              <div className={styles.avisoBox}>
                Vínculo só sugerido no mapeamento:{" "}
                {pedido.itens
                  .filter((i) => i.conferir && !i.origem.startsWith("lote anterior"))
                  .map((i) => `${i.tituloShopify} → ${i.produto} ${i.cor}`)
                  .join("; ")}
                .
                Confira.
              </div>
            )}
            {cliente && pedido.cliente.cpfCnpj && cliente.cpfCnpj !== pedido.cliente.cpfCnpj && (
              <div className={styles.erroBox}>
                O cliente selecionado ({fmtDoc(cliente.cpfCnpj)}) não tem o CPF do pedido ({fmtDoc(pedido.cliente.cpfCnpj)}).
              </div>
            )}
          </>
        ) : (
          <form
            className={styles.linhaBusca}
            onSubmit={async (ev) => {
              ev.preventDefault();
              setImportando(true);
              setErro(null);
              try {
                await onImportarPedido(pedidoBusca);
              } catch (err) {
                setErro((err as Error).message);
              } finally {
                setImportando(false);
              }
            }}
          >
            <input
              className={styles.input}
              placeholder="nº do pedido do site para importar (ex.: #1711) — ou monte a NF manualmente abaixo"
              value={pedidoBusca}
              onChange={(e) => setPedidoBusca(e.target.value)}
            />
            <button type="submit" className={styles.btn} disabled={importando || !pedidoBusca.trim()}>
              {importando ? "Importando…" : "Importar pedido"}
            </button>
          </form>
        )}
      </div>

      {/* Cliente */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Cliente</h2>
          <button type="button" className={styles.btnTexto} onClick={onIrParaClientes}>
            buscar / cadastrar na aba Clientes
          </button>
        </div>
        {cliente ? (
          <div className={styles.clienteResumo}>
            <span>
              <strong>{cliente.codigo}</strong> — {cliente.razaoSocial}
            </span>
            <span>{fmtDoc(cliente.cpfCnpj)}</span>
            <span>
              {cliente.endereco.cidade}/{cliente.endereco.uf}
            </span>
            <span className={styles.muted}>Linx: {cliente.nomeClifor}</span>
            <button type="button" className={`${styles.btnTexto} ${styles.btnMini}`} onClick={() => onTrocarCliente(null)}>
              trocar
            </button>
          </div>
        ) : (
          <form className={styles.linhaBusca} onSubmit={carregarCliente}>
            <input
              className={styles.input}
              placeholder="Código do cliente (ex.: 850719)"
              value={codigoCliente}
              onChange={(e) => setCodigoCliente(e.target.value)}
            />
            <button type="submit" className={styles.btn} disabled={!codigoCliente.trim()}>
              Carregar
            </button>
          </form>
        )}
        {erroCliente && <div className={styles.erroBox}>{erroCliente}</div>}
      </div>

      {/* Cabeçalho */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Cabeçalho da NF (padrões da {PADROES[empresa].nome} — pode alterar)</h2>
        <div className={styles.grid}>
          <label className={styles.campo}>
            <span className={styles.label}>Filial emissora</span>
            <select
              className={`${styles.select} ${filial !== lookups.filialNotaPadrao ? styles.inputAlterado : ""}`}
              value={filial}
              onChange={(e) => setFilial(e.target.value)}
            >
              {lookups.filiaisNota.map((f) => (
                <option key={f.filial} value={f.filial}>
                  {f.filial === lookups.filialNotaPadrao ? "★ PRINCIPAL — " : ""}
                  {f.extra ? `${f.rotulo ?? "EXTRA"} (fora do rodízio) — ` : ""}
                  {f.filial} (série {f.serie}, última NF {f.ultimoNumero}
                  {f.ultimaEmissao ? `, emitida ${new Date(f.ultimaEmissao).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""})
                </option>
              ))}
            </select>
            {filialInfo?.extra ? (
              <span className={styles.muted}>
                {filialInfo.rotulo ?? filial}: fora do rodízio do e-commerce — a principal continua {lookups.filialNotaPadrao}.
                {!filialInfo.simples && " Regime normal: a NF sai com ICMS/PIS/COFINS calculados (natureza 100.05; revenda 100.08)."}
              </span>
            ) : (
              lookups.filiaisNota.filter((f) => !f.extra).length > 1 &&
              (filial === lookups.filialNotaPadrao ? (
                <span className={styles.muted}>Principal: a filial que emitiu NF de e-commerce por último.</span>
              ) : (
                <span className={styles.muted}>
                  Faturando fora da principal ({lookups.filialNotaPadrao}). Ao gravar, esta filial passa a ser a principal.
                </span>
              ))
            )}
          </label>
          <label className={`${styles.campo} ${styles.span2}`}>
            <span className={styles.label}>Natureza {naturezaManual === null && cliente ? "(pela UF do cliente)" : ""}</span>
            <select
              className={`${styles.select} ${natureza !== naturezaAuto ? styles.inputAlterado : ""}`}
              value={natureza}
              onChange={(e) => setNaturezaManual(e.target.value)}
            >
              {lookups.naturezas.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Sel label="Cond. pagamento" value={condicao} onChange={setCondicao} opcoes={lookups.condicoesPgto} padrao={padrao.condicaoPgto} />
          <Sel label="Tipo de frete" value={tipoFrete} onChange={setTipoFrete} opcoes={lookups.tiposFrete} padrao={padrao.tipoFrete} />
          <Sel label="Transportadora" value={transp} onChange={setTransp} opcoes={lookups.transportadoras} padrao={padrao.transportadora} />
          <Sel label="Transp. redespacho" value={redesp} onChange={setRedesp} opcoes={lookups.transportadoras} padrao={padrao.transpRedespacho} />
          <Sel label="Info. pagamento" value={infoPgto} onChange={setInfoPgto} opcoes={lookups.infoPgto} padrao={padrao.infoPgto} />
          <Num label="Frete (R$)" value={frete} onChange={setFrete} />
          <Num label="Seguro (R$)" value={seguro} onChange={setSeguro} />
          <label className={styles.campo}>
            <span className={styles.label}>Desconto</span>
            <div className={styles.linhaBusca}>
              <select
                className={styles.select}
                style={{ width: 70, flex: "0 0 70px" }}
                value={descModo}
                onChange={(e) => setDescModo(e.target.value as "percentual" | "valor")}
              >
                <option value="percentual">%</option>
                <option value="valor">R$</option>
              </select>
              <input className={`${styles.input} ${styles.inputNum}`} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
          </label>
          <Num label="Peso líquido" value={pesoLiq} onChange={setPesoLiq} />
          <Num label="Peso bruto" value={pesoBruto} onChange={setPesoBruto} />
          <Num label="Volumes" value={volumes} onChange={setVolumes} />
          <label className={styles.campo}>
            <span className={styles.label}>Tipo de volume</span>
            <input className={styles.input} value={tipoVolume} onChange={(e) => setTipoVolume(e.target.value)} />
          </label>
          <label className={`${styles.campo} ${styles.span2}`}>
            <span className={styles.label}>OBS — nº do pedido do site</span>
            <input className={styles.input} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="#1710" />
          </label>
        </div>
        <p className={styles.muted}>
          O desconto vai no total da NF (como no Linx). Preço do item = preço cheio do site; o cupom/desconto entra aqui.
        </p>
      </div>

      {/* Itens */}
      <ItensCard empresa={empresa} filial={filial} itens={itens} setItens={setItens} tabela={cliente?.codigoTabPreco || "01"} />

      {/* Conferência */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Conferir e gravar</h2>
          <div className={styles.acoes}>
            <button type="button" className={styles.btn} onClick={conferir} disabled={!cliente || itens.length === 0 || processando !== null}>
              {processando === "previa" ? "Conferindo…" : "Conferir NF"}
            </button>
            {podeGravar && (
              <>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => gravar(true)}
                  disabled={!previaValida || (previa?.bloqueios.length ?? 1) > 0 || processando !== null}
                  title="Executa a gravação inteira no Linx (triggers inclusive) e desfaz — nada fica gravado"
                >
                  {processando === "simular" ? "Simulando…" : "Simular gravação"}
                </button>
                <button
                  type="button"
                  className={styles.btnPerigo}
                  onClick={() => setConfirmando(true)}
                  disabled={!previaValida || (previa?.bloqueios.length ?? 1) > 0 || processando !== null}
                >
                  {processando === "gravar" ? "Gravando…" : "Gravar NF no Linx"}
                </button>
              </>
            )}
          </div>
        </div>
        {!previaValida && previa && <div className={styles.infoBox}>Algo mudou depois da conferência — confira de novo.</div>}
        {!previa && <p className={styles.muted}>Confira a NF para ver CFOP, exceção fiscal, estoque e totais antes de gravar.</p>}
        {erro && <div className={styles.erroBox}>{erro}</div>}
        {simulacao && (
          <div className={styles.okBox}>
            Simulação OK: o Linx aceitou a NF ({simulacao.filial}, nº {simulacao.nf}, total {fmtBRL(simulacao.total)}). Nada
            foi gravado.
          </div>
        )}
        {previa && pedido && Math.abs(previa.total - pedido.totalShopify) > 0.01 && (
          <div className={styles.avisoBox}>
            Total da NF {fmtBRL(previa.total)} ≠ total do Shopify {fmtBRL(pedido.totalShopify)} (diferença{" "}
            {fmtBRL(previa.total - pedido.totalShopify)}). Normal quando há item fora da NF (embrulho, serviço) — senão, confira.
          </div>
        )}
        {previa && pedido && Math.abs(previa.total - pedido.totalShopify) <= 0.01 && (
          <div className={styles.okBox}>Total da NF bate com o pedido do Shopify ({fmtBRL(pedido.totalShopify)}).</div>
        )}
        {previa && <PreviaView previa={previa} confirmarDup={confirmarDup} setConfirmarDup={setConfirmarDup} />}
      </div>

      {enviarGravada && gravada && (
        <NotaDetalheModal
          empresa={empresa}
          nota={{ filial: gravada.filial, nf: gravada.nf, serie: gravada.serie }}
          onFechar={() => setEnviarGravada(false)}
          podeGravar={podeGravar}
        />
      )}

      {confirmando && previa && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.cardTitle}>Gravar a NF no Linx?</h2>
            <p>
              Filial <strong>{previa.filial}</strong>, série {previa.serie}, próximo nº <strong>{previa.proximoNumero}</strong>
              <br />
              Cliente <strong>{previa.cliente.razao}</strong> ({previa.cliente.cidade}/{previa.cliente.uf}) — natureza {previa.natureza}
              <br />
              {previa.qtdeTotal} peça(s), total <strong>{fmtBRL(previa.total)}</strong>
            </p>
            <div className={styles.avisoBox}>
              A NF consome o número da série e baixa o estoque da filial na hora. Depois de gravada, só sai pelo
              cancelamento/inutilização no Linx.
            </div>
            <div className={styles.acoes}>
              <button type="button" className={styles.btnPerigo} onClick={() => gravar(false)}>
                Sim, gravar NF
              </button>
              <button type="button" className={styles.btnTexto} onClick={() => setConfirmando(false)}>
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Sel({
  label,
  value,
  onChange,
  opcoes,
  padrao,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opcoes: { value: string; label: string }[];
  padrao: string;
}) {
  const lista = opcoes.some((o) => o.value === value) ? opcoes : [{ value, label: value }, ...opcoes];
  return (
    <label className={styles.campo}>
      <span className={styles.label}>{label}</span>
      <select
        className={`${styles.select} ${value !== padrao ? styles.inputAlterado : ""}`}
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

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={styles.campo}>
      <span className={styles.label}>{label}</span>
      <input className={`${styles.input} ${styles.inputNum}`} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" />
    </label>
  );
}

// ── Itens ───────────────────────────────────────────────────────────────────

function ItensCard({
  empresa,
  filial,
  itens,
  setItens,
  tabela,
}: {
  empresa: EmpresaFat;
  filial: string;
  itens: ItemTela[];
  setItens: (f: (prev: ItemTela[]) => ItemTela[]) => void;
  tabela: string;
}) {
  const api = useFatApi(empresa);
  const [termo, setTermo] = useState("");
  const [opcoes, setOpcoes] = useState<ProdutoFatOpcao[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    if (termo.trim().length < 2) return;
    setBuscando(true);
    setErro(null);
    try {
      const r = await api.get<ProdutoFatOpcao[]>("/produtos", { q: termo.trim(), filial, tab: tabela });
      setOpcoes(r);
      // Código de barras exato (SKU do site) → inclui direto.
      const exato = r.filter((o) => o.codigoBarra && o.codigoBarra === termo.trim());
      if (exato.length === 1) {
        incluir(exato[0]);
        setTermo("");
        setOpcoes(null);
      }
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setBuscando(false);
    }
  };

  const incluir = (o: ProdutoFatOpcao) => {
    const chave = `${o.produto}|${o.cor}|${o.tamanho}`;
    setItens((prev) => {
      const ja = prev.find((i) => i.chave === chave);
      if (ja) return prev.map((i) => (i.chave === chave ? { ...i, qtde: i.qtde + 1 } : i));
      return [
        ...prev,
        {
          chave,
          produto: o.produto,
          descricao: o.descricao,
          cor: o.cor,
          descCor: o.descCor,
          tamanho: o.tamanho,
          tamanhoLabel: o.tamanhoLabel,
          qtde: 1,
          preco: o.preco,
          estoque: o.estoque,
        },
      ];
    });
  };

  const alterar = (chave: string, campo: "qtde" | "preco", valor: string) =>
    setItens((prev) => prev.map((i) => (i.chave === chave ? { ...i, [campo]: campo === "qtde" ? Math.max(0, Math.round(n(valor))) : n(valor) } : i)));

  const subtotal = itens.reduce((s, i) => s + i.qtde * i.preco, 0);

  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>Itens</h2>
      <form className={styles.linhaBusca} onSubmit={buscar}>
        <input
          className={styles.input}
          placeholder="Código de barras / SKU do site, código do produto ou descrição"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
        />
        <button type="submit" className={styles.btn} disabled={buscando || termo.trim().length < 2}>
          {buscando ? "Buscando…" : "Buscar produto"}
        </button>
      </form>
      {erro && <div className={styles.erroBox}>{erro}</div>}
      {opcoes && (
        <div className={styles.tabelaWrap} style={{ maxHeight: 280, overflowY: "auto" }}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Cor</th>
                <th>Tam.</th>
                <th>Cód. barras</th>
                <th className={styles.num}>Preço tab. {tabela}</th>
                <th className={styles.num}>Estoque {filial}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {opcoes.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.vazio}>
                    Nenhum produto encontrado.
                  </td>
                </tr>
              )}
              {opcoes.map((o) => (
                <tr key={`${o.produto}|${o.cor}|${o.tamanho}`}>
                  <td>
                    <span className={styles.mono}>{o.produto}</span> {o.descricao}
                  </td>
                  <td>
                    {o.cor} {o.descCor}
                  </td>
                  <td>{o.tamanhoLabel}</td>
                  <td className={styles.mono}>{o.codigoBarra ?? "—"}</td>
                  <td className={styles.num}>{fmtBRL(o.preco)}</td>
                  <td className={styles.num}>{o.estoque ?? "—"}</td>
                  <td>
                    <button type="button" className={`${styles.btn} ${styles.btnMini}`} onClick={() => incluir(o)}>
                      incluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cor</th>
              <th>Tam.</th>
              <th className={styles.num}>Qtde</th>
              <th className={styles.num}>Preço unit.</th>
              <th className={styles.num}>Valor</th>
              <th className={styles.num}>Estoque</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.vazio}>
                  Nenhum item. Busque pelo SKU do pedido do site (é o código de barras no Linx).
                </td>
              </tr>
            )}
            {itens.map((i) => (
              <tr key={i.chave}>
                <td>
                  <span className={styles.mono}>{i.produto}</span> {i.descricao}
                </td>
                <td>
                  {i.cor} {i.descCor}
                </td>
                <td>{i.tamanhoLabel}</td>
                <td className={styles.num}>
                  <input
                    className={`${styles.input} ${styles.inputNum}`}
                    style={{ width: 70 }}
                    value={String(i.qtde)}
                    onChange={(e) => alterar(i.chave, "qtde", e.target.value)}
                  />
                </td>
                <td className={styles.num}>
                  <input
                    className={`${styles.input} ${styles.inputNum}`}
                    style={{ width: 100 }}
                    defaultValue={numTxt(i.preco)}
                    onBlur={(e) => alterar(i.chave, "preco", e.target.value)}
                  />
                </td>
                <td className={styles.num}>{fmtBRL(i.qtde * i.preco)}</td>
                <td className={styles.num}>{i.estoque ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    className={`${styles.btnTexto} ${styles.btnMini}`}
                    onClick={() => setItens((prev) => prev.filter((x) => x.chave !== i.chave))}
                  >
                    remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {itens.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5} className={styles.num}>
                  <strong>Subtotal</strong>
                </td>
                <td className={styles.num}>
                  <strong>{fmtBRL(subtotal)}</strong>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Prévia ──────────────────────────────────────────────────────────────────

function PreviaView({
  previa,
  confirmarDup,
  setConfirmarDup,
}: {
  previa: NotaPreview;
  confirmarDup: boolean;
  setConfirmarDup: (v: boolean) => void;
}) {
  const temDup = previa.bloqueios.some((b) => b.includes("já aparece na NF")) || (confirmarDup && previa.avisos.some((a) => a.includes("já aparece na NF")));
  return (
    <>
      {previa.bloqueios.length > 0 && (
        <div className={styles.erroBox}>
          <strong>Não dá para gravar:</strong>
          <ul className={styles.lista}>
            {previa.bloqueios.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {temDup && (
        <label className={styles.check}>
          <input type="checkbox" checked={confirmarDup} onChange={(e) => setConfirmarDup(e.target.checked)} />
          faturar mesmo assim (é outra NF do mesmo pedido) — confira de novo depois de marcar
        </label>
      )}
      {previa.avisos.length > 0 && (
        <div className={styles.avisoBox}>
          <ul className={styles.lista}>
            {previa.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.totais}>
        <Total label="Produtos" valor={fmtBRL(previa.subtotal)} />
        <Total
          label={`Desconto (${previa.descontoPercentual.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%)`}
          valor={`− ${fmtBRL(previa.desconto)}`}
        />
        <Total label="Frete" valor={fmtBRL(previa.frete)} />
        {previa.seguro > 0 && <Total label="Seguro" valor={fmtBRL(previa.seguro)} />}
        <Total label="Total da NF" valor={fmtBRL(previa.total)} destaque />
        <Total label="Próxima NF" valor={`${previa.proximoNumero} / ${previa.serie}`} />
      </div>
      <p className={styles.muted}>
        {previa.filial} → {previa.cliente.razao} ({previa.cliente.cidade}/{previa.cliente.uf}) · natureza {previa.natureza}{" "}
        {previa.naturezaDescricao}
      </p>
      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Item fiscal</th>
              <th>Descrição na NF</th>
              <th className={styles.num}>Qtde</th>
              <th className={styles.num}>Valor</th>
              <th>NCM</th>
              <th>CFOP</th>
              <th>CST/CSOSN</th>
              <th>Exceção fiscal</th>
              <th className={styles.num}>Estoque</th>
            </tr>
          </thead>
          <tbody>
            {previa.itens.map((i) => (
              <tr key={i.codigoItem}>
                <td className={styles.mono}>{i.codigoItem}</td>
                <td>{i.descricao}</td>
                <td className={styles.num}>{i.qtde}</td>
                <td className={styles.num}>{fmtBRL(i.valor)}</td>
                <td className={styles.mono}>{i.ncm}</td>
                <td className={styles.mono}>{i.cfop || "—"}</td>
                <td className={styles.mono}>{i.csosn || "—"}</td>
                <td>
                  {i.excecao ?? "—"} <span className={styles.muted}>{i.excecaoDescricao}</span>
                </td>
                <td className={styles.num}>{i.estoque ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Total({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`${styles.total} ${destaque ? styles.totalDestaque : ""}`}>
      <span className={styles.totalLabel}>{label}</span>
      <span className={styles.totalValor}>{valor}</span>
    </div>
  );
}

// ── Encontrar NF ────────────────────────────────────────────────────────────

function BuscarNotas({ empresa, lookups }: { empresa: EmpresaFat; lookups: FatLookups }) {
  const api = useFatApi(empresa);
  const [busca, setBusca] = useState("");
  const [de, setDe] = useState(dataLocal(30));
  const [ate, setAte] = useState(dataLocal(0));
  const [filial, setFilial] = useState("");
  const [lista, setLista] = useState<NotaListItem[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<NotaListItem | null>(null);

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    setCarregando(true);
    setErro(null);
    try {
      setLista(await api.get<NotaListItem[]>("/notas", { busca, de, ate, filial, status: "todas" }));
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>Encontrar NF</h2>
      <form className={styles.grid} onSubmit={buscar}>
        <label className={`${styles.campo} ${styles.span2}`}>
          <span className={styles.label}>Nº da NF, cliente, CPF, chave ou nº do pedido (#1710)</span>
          <input className={styles.input} value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <label className={styles.campo}>
          <span className={styles.label}>De</span>
          <input className={styles.input} type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className={styles.campo}>
          <span className={styles.label}>Até</span>
          <input className={styles.input} type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        <label className={styles.campo}>
          <span className={styles.label}>Filial</span>
          <select className={styles.select} value={filial} onChange={(e) => setFilial(e.target.value)}>
            <option value="">Todas da {PADROES[empresa].nome}</option>
            {lookups.filiaisNota.map((f) => (
              <option key={f.filial} value={f.filial}>
                {f.filial}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.campo}>
          <button type="submit" className={styles.btnPrimario} disabled={carregando}>
            {carregando ? "Buscando…" : "Buscar"}
          </button>
        </div>
      </form>
      {erro && <div className={styles.erroBox}>{erro}</div>}
      {lista && <ListaNotas lista={lista} onAbrir={setAberta} />}
      {aberta && (
        <NotaDetalheModal
          empresa={empresa}
          nota={aberta}
          onFechar={() => setAberta(null)}
          podeGravar={Boolean(lookups.podeGravar)}
          onAtualizado={() => void buscar()}
        />
      )}
    </div>
  );
}

export function ListaNotas({ lista, onAbrir }: { lista: NotaListItem[]; onAbrir: (n: NotaListItem) => void }) {
  return (
    <div className={styles.tabelaWrap}>
      <table className={styles.tabela}>
        <thead>
          <tr>
            <th>Status</th>
            <th>NF</th>
            <th>Emissão</th>
            <th>Filial</th>
            <th>Cliente</th>
            <th>Natureza</th>
            <th className={styles.num}>Valor</th>
            <th>OBS</th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 && (
            <tr>
              <td colSpan={8} className={styles.vazio}>
                Nenhuma NF encontrada.
              </td>
            </tr>
          )}
          {lista.map((nf) => (
            <tr key={`${nf.filial}|${nf.serie}|${nf.nf}`} className={styles.trClick} onClick={() => onAbrir(nf)}>
              <td>
                <span className={`${styles.badge} ${styles[`badge_${nf.tom}`]}`}>{nf.statusLabel}</span>
                {nf.mensagem && <div className={styles.muted}>{nf.mensagem}</div>}
              </td>
              <td className={styles.mono}>
                {nf.nf}/{nf.serie}
              </td>
              <td>{fmtData(nf.emissao)}</td>
              <td>{nf.filial}</td>
              <td>{nf.cliente}</td>
              <td className={styles.mono}>{nf.natureza}</td>
              <td className={styles.num}>{fmtBRL(nf.valor)}</td>
              <td className={styles.muted}>{nf.obs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
