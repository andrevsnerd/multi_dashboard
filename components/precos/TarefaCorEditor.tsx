"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import base from "./AlterarPrecosPage.module.css";
import styles from "./ProgramarPrecosPage.module.css";

/**
 * Programar Preços, modo "Por cor": monta uma tarefa de Preço Líquido (1) por cor. Na
 * execução (agora ou agendada) o servidor liga o modo cor dos produtos que ainda não
 * estão e grava os líquidos — mesmo caminho da aba Por cor do Alterar Custo / Preço
 * (lib/repositories/precosCor.ts → executarTarefaCor).
 */

interface CorPreco {
  cor: string;
  descricao: string;
  preco1: number | null;
  liquido1: number | null;
}

interface ProdutoCor {
  produto: string;
  descricao: string;
  variaPrecoCor: boolean;
  tabela: string;
  tabelas: Array<{ codigo: string; descricao: string; inativa: boolean }>;
  cores: CorPreco[];
}

export interface AlteracaoCor {
  produto: string;
  campoKey: string;
  valor: number;
  atual: number | null;
  tabela: string;
  tabelaDesc: string;
  cor?: string;
  corDesc?: string;
}

export interface TarefaCorEditavel {
  id: string;
  nome: string;
  status: string;
  agendadoPara: string | null;
  alteracoes: AlteracaoCor[];
}

type Api = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Props {
  companyKey: "nerd" | "scarfme";
  api: Api;
  podeExecutar: boolean;
  agendamentoIndisponivel: string | null;
  minAgenda: string;
  /** Tarefa por cor em edição (null = nova). */
  editando: TarefaCorEditavel | null;
  onSalva: (mensagem: string, tarefaId: string | null) => void;
  onErro: (mensagem: string) => void;
  onCancelar: () => void;
}

function fmt(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "298", "298,00", "1.298,50" → número; vazio → null; lixo → NaN. */
function parseValor(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}

function paraInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function chave(produto: string, cor: string): string {
  return `${produto}||${cor}`;
}

/** Chave do campo de um produto de cor única: o preço vale para o SKU inteiro. */
const SKU = "*";

/** Cor única e fora do modo cor: altera o PRECO1 do produto (SKU inteiro), como sempre. */
function ehSkuInteiro(p: ProdutoCor): boolean {
  return p.cores.length === 1 && !p.variaPrecoCor;
}

export default function TarefaCorEditor({
  companyKey,
  api,
  podeExecutar,
  agendamentoIndisponivel,
  minAgenda,
  editando,
  onSalva,
  onErro,
  onCancelar,
}: Props) {
  const [codigos, setCodigos] = useState("");
  const [tabela, setTabela] = useState(editando?.alteracoes[0]?.tabela ?? "01");
  const [produtos, setProdutos] = useState<ProdutoCor[]>([]);
  const [novos, setNovos] = useState<Record<string, string>>(() => {
    const preset: Record<string, string> = {};
    for (const a of editando?.alteracoes ?? []) preset[chave(a.produto, a.cor ?? SKU)] = fmt(a.valor);
    return preset;
  });
  const [naoEncontrados, setNaoEncontrados] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [nome, setNome] = useState(editando?.nome ?? "");
  const [quandoModo, setQuandoModo] = useState<"pendente" | "agendar">(
    editando?.status === "agendada" && editando.agendadoPara ? "agendar" : "pendente"
  );
  const [quandoValor, setQuandoValor] = useState(
    editando?.status === "agendada" && editando.agendadoPara ? paraInputLocal(new Date(editando.agendadoPara)) : ""
  );
  const [salvando, setSalvando] = useState(false);

  const buscarProduto = useCallback(
    async (codigo: string, tab: string): Promise<ProdutoCor | null> => {
      const qs = new URLSearchParams({ codigo, tabela: tab });
      const { ok, json } = await api(`/api/precos/cor?${qs}`);
      if (!ok) return null;
      return json.produto as ProdutoCor;
    },
    [api]
  );

  /** Carrega códigos (produto ou barras) na tabela pedida, sem repetir produto já na lista. */
  const adicionar = useCallback(
    async (lista: string[], tab: string, substituir: boolean) => {
      if (lista.length === 0) return;
      setCarregando(true);
      const faltaram: string[] = [];
      const vindos: ProdutoCor[] = [];
      for (const c of lista) {
        const p = await buscarProduto(c, tab);
        if (!p) faltaram.push(c);
        else if (!vindos.some((v) => v.produto === p.produto)) vindos.push(p);
      }
      setProdutos((atuais) => {
        const base0 = substituir ? [] : atuais;
        return [...base0, ...vindos.filter((v) => !base0.some((a) => a.produto === v.produto))];
      });
      setNaoEncontrados(faltaram);
      setCarregando(false);
    },
    [buscarProduto]
  );

  // Edição: carrega os produtos da tarefa uma vez.
  useEffect(() => {
    if (!editando) return;
    const lista = [...new Set(editando.alteracoes.map((a) => a.produto))];
    void adicionar(lista, editando.alteracoes[0]?.tabela ?? "01", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando?.id]);

  const trocarTabela = (tab: string) => {
    setTabela(tab);
    setNovos({});
    void adicionar(
      produtos.map((p) => p.produto),
      tab,
      true
    );
  };

  const tabelas = produtos[0]?.tabelas ?? [];
  const tabelaDesc = tabelas.find((t) => t.codigo === tabela)?.descricao ?? tabela;

  const alteracoes = useMemo(() => {
    const out: AlteracaoCor[] = [];
    for (const p of produtos) {
      if (ehSkuInteiro(p)) {
        const v = parseValor(novos[chave(p.produto, SKU)] ?? "");
        if (v === null || Number.isNaN(v) || v < 0) continue;
        const valor = Math.round(v * 100) / 100;
        const atual = p.cores[0]?.preco1 ?? null;
        if (atual !== null && Math.abs(atual - valor) < 0.005) continue;
        out.push({ produto: p.produto, campoKey: `T::${tabela}::PRECO1`, valor, atual, tabela, tabelaDesc });
        continue;
      }
      for (const c of p.cores) {
        const v = parseValor(novos[chave(p.produto, c.cor)] ?? "");
        if (v === null || Number.isNaN(v) || v < 0) continue;
        const valor = Math.round(v * 100) / 100;
        if (c.liquido1 !== null && Math.abs(c.liquido1 - valor) < 0.005) continue;
        out.push({
          produto: p.produto,
          campoKey: `COR::${tabela}::${c.cor}::PRECO_LIQUIDO1`,
          valor,
          atual: c.liquido1,
          tabela,
          tabelaDesc,
          cor: c.cor,
          corDesc: c.descricao,
        });
      }
    }
    return out;
  }, [produtos, novos, tabela, tabelaDesc]);

  const invalidos = Object.entries(novos)
    .filter(([, t]) => {
      const v = parseValor(t);
      return v !== null && (Number.isNaN(v) || v < 0);
    })
    .map(([k]) => k.replace("||", " ").replace(` ${SKU}`, ""));

  const vaoLigar = [...new Set(alteracoes.filter((a) => a.cor).map((a) => a.produto))].filter(
    (prod) => !produtos.find((p) => p.produto === prod)?.variaPrecoCor
  );

  const salvar = async () => {
    if (alteracoes.length === 0) return;
    if (!nome.trim()) {
      onErro("Dê um nome para a tarefa.");
      return;
    }
    let agendadoPara: string | null = null;
    if (quandoModo === "agendar") {
      const d = new Date(quandoValor);
      if (!quandoValor || Number.isNaN(d.getTime())) {
        onErro("Escolha a data e a hora do agendamento.");
        return;
      }
      agendadoPara = d.toISOString();
    }
    setSalvando(true);
    try {
      const comAlteracao = new Set(alteracoes.map((a) => a.produto));
      const { ok, json } = await api("/api/precos/tarefas", {
        method: "POST",
        body: JSON.stringify({
          id: editando?.id ?? null,
          company: companyKey,
          nome: nome.trim(),
          modo: "cor",
          produtos: produtos
            .filter((p) => comAlteracao.has(p.produto))
            .map((p) => ({ produto: p.produto, descricao: p.descricao })),
          alteracoes,
          agendadoPara,
        }),
      });
      if (!ok) {
        onErro(json?.error ?? "Erro ao salvar a tarefa.");
        // 422 = conteúdo salvo, só o agendamento falhou.
        if (json?.tarefa?.id) onSalva("", json.tarefa.id);
        return;
      }
      const t = json.tarefa as { nome: string; status: string; agendadoPara: string | null };
      onSalva(
        t.status === "agendada"
          ? `Tarefa "${t.nome}" agendada para ${new Date(t.agendadoPara!).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`
          : `Tarefa "${t.nome}" salva como pendente.`,
        null
      );
    } catch {
      onErro("Falha de conexão ao salvar a tarefa.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <div className={base.codigosBox}>
        <label className={base.campoTexto}>
          <span className={base.campoLabel}>
            Códigos de produto ou de barras — um por linha. Cada produto aparece com todas as cores para você
            digitar o Preço Líquido (1) novo só das cores que quer mudar.
          </span>
          <textarea
            className={base.textarea}
            value={codigos}
            onChange={(e) => setCodigos(e.target.value)}
            rows={3}
            placeholder={"07.A1.00B3\n042396"}
          />
        </label>
      </div>
      <div className={base.acoes}>
        <span className={styles.reconhecidos}>
          {produtos.length} produto(s) na tarefa
          {naoEncontrados.length > 0 && ` · não encontrado(s): ${naoEncontrados.join(", ")}`}
        </span>
        <div className={styles.acoesLinha}>
          <button type="button" className={base.btnTexto} onClick={onCancelar}>
            {editando ? "Cancelar edição" : "Limpar"}
          </button>
          <button
            type="button"
            className={base.btnPrimario}
            disabled={carregando || !codigos.trim()}
            onClick={() => {
              void adicionar(
                codigos.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean),
                tabela,
                false
              );
              setCodigos("");
            }}
          >
            {carregando ? "Carregando…" : "Adicionar produtos"}
          </button>
        </div>
      </div>

      {produtos.length > 0 && (
        <>
          {tabelas.length > 0 && (
            <label className={base.campoTexto} style={{ maxWidth: 360 }}>
              <span className={base.campoLabel}>Tabela de preço (vale para todos os produtos da tarefa)</span>
              <select
                className={base.input}
                value={tabela}
                disabled={carregando}
                onChange={(e) => trocarTabela(e.target.value)}
              >
                {tabelas.map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.codigo} — {t.descricao}
                    {t.inativa ? " (inativa)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {produtos.map((p) => (
            <div key={p.produto} className={base.tabelaWrap}>
              <div className={base.fichaHead} style={{ padding: "10px 12px" }}>
                <span className={base.fichaProduto}>{p.produto}</span>
                <span className={base.fichaDesc}>{p.descricao}</span>
                <span className={base.lote}>
                  {ehSkuInteiro(p)
                    ? "cor única — preço do SKU inteiro"
                    : p.variaPrecoCor
                      ? "modo cor ligado"
                      : "modo cor desligado — liga ao aplicar"}
                </span>
                <button
                  type="button"
                  className={base.btnTexto}
                  onClick={() => setProdutos((lista) => lista.filter((x) => x.produto !== p.produto))}
                >
                  remover
                </button>
              </div>
              <table className={base.tabelaFicha}>
                <thead>
                  <tr>
                    <th>Cor</th>
                    <th>Descrição da cor</th>
                    <th className={base.thNum}>Preço (1)</th>
                    <th className={base.thNum}>Preço Líquido (1)</th>
                    <th className={base.thNum}>{ehSkuInteiro(p) ? "Novo Preço (1) do SKU" : "Novo Preço Líquido (1)"}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.cores.map((c) => {
                    const sku = ehSkuInteiro(p);
                    const k = chave(p.produto, sku ? SKU : c.cor);
                    const alterada = alteracoes.some((a) => a.produto === p.produto && (sku || a.cor === c.cor));
                    return (
                      <tr key={c.cor} className={alterada ? base.trAlterada : undefined}>
                        <td className={base.tdCodigo}>{c.cor}</td>
                        <td>{c.descricao}</td>
                        <td className={base.thNum}>{fmt(c.preco1)}</td>
                        <td className={base.thNum}>{fmt(c.liquido1)}</td>
                        <td className={base.thNum}>
                          <input
                            className={base.inputValor}
                            inputMode="decimal"
                            value={novos[k] ?? ""}
                            disabled={!podeExecutar}
                            onChange={(e) => setNovos((prev) => ({ ...prev, [k]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {invalidos.length > 0 && <p className={base.textoErro}>Valor inválido em: {invalidos.join(", ")}.</p>}

          <div className={styles.salvarBox}>
            <div className={base.resumoLinha}>
              <strong>{alteracoes.filter((a) => a.cor).length}</strong> cor(es) com Preço Líquido (1) novo na tabela{" "}
              {tabela} (o Preço (1) não muda)
              {alteracoes.some((a) => !a.cor) && (
                <>
                  {" "}
                  · <strong>{alteracoes.filter((a) => !a.cor).length}</strong> produto(s) de cor única pelo preço do SKU
                  inteiro (estornados do lote anterior antes de reaplicar)
                </>
              )}
              .
            </div>
            {vaoLigar.length > 0 && (
              <div className={base.avisoBox}>
                Ao aplicar, o modo cor é ligado em {vaoLigar.join(", ")}: o preço do momento é copiado para todas
                as cores e, a partir daí, mudanças por produto (Programar Preços por produto, Alterar Custo / Preço,
                Black) não chegam ao caixa desses produtos.
              </div>
            )}

            <div className={styles.linhaCampos}>
              <label className={base.campoTexto}>
                <span className={base.campoLabel}>Nome da tarefa</span>
                <input
                  className={base.input}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="ex.: Pashmina pêssego"
                  maxLength={120}
                />
              </label>
            </div>

            <div className={styles.quando}>
              <label className={base.check}>
                <input type="radio" checked={quandoModo === "pendente"} onChange={() => setQuandoModo("pendente")} />
                Deixar pendente (aplico quando quiser)
              </label>
              <label className={base.check}>
                <input
                  type="radio"
                  checked={quandoModo === "agendar"}
                  disabled={!!agendamentoIndisponivel}
                  onChange={() => setQuandoModo("agendar")}
                />
                Agendar para
              </label>
              <input
                type="datetime-local"
                className={styles.inputData}
                value={quandoValor}
                min={minAgenda}
                disabled={quandoModo !== "agendar"}
                onChange={(e) => setQuandoValor(e.target.value)}
              />
              {agendamentoIndisponivel && (
                <span className={base.dica}>Agendamento indisponível: {agendamentoIndisponivel}</span>
              )}
            </div>

            <div>
              <button
                type="button"
                className={base.btnPrimario}
                disabled={salvando || alteracoes.length === 0 || invalidos.length > 0 || !podeExecutar}
                onClick={() => void salvar()}
              >
                {salvando
                  ? "Salvando…"
                  : quandoModo === "agendar"
                    ? "Salvar e agendar"
                    : editando
                      ? "Salvar alterações da tarefa"
                      : "Salvar como pendente"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
