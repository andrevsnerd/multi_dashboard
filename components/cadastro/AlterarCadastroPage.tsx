"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";

import CadastroHistorico from "./CadastroHistorico";
import styles from "./AlterarCadastroPage.module.css";
import {
  opcoesDoCampo,
  type CampoProdutoDef,
  type CompanyKey,
  type DimensaoMeta,
  type DimensaoRow,
  type DimensaoTipo,
  type ImpactoDimensao,
  type OpcoesDimensoes,
  type ProdutoCadastro,
  type ResultadoDimensao,
  type ResultadoProdutos,
  type ValorCampo,
} from "./types";

interface Props {
  companyKey: CompanyKey;
}

type Aba = "dimensoes" | "produto";

/** Acima disso o rename pede confirmação digitada — é escrita em muitos produtos. */
const LIMITE_CONFIRMACAO_DIGITADA = 200;

const ORDEM_DIMENSOES: DimensaoTipo[] = ["grupo", "subgrupo", "linha", "tipo", "griffe", "colecao"];

export default function AlterarCadastroPage({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [aba, setAba] = useState<Aba>("dimensoes");
  const [podeExecutar, setPodeExecutar] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcoesDimensoes | null>(null);
  const [campos, setCampos] = useState<CampoProdutoDef[]>([]);
  const [metas, setMetas] = useState<DimensaoMeta[]>([]);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(true);
  const [historicoVersao, setHistoricoVersao] = useState(0);

  // ───────── carga inicial ─────────

  useEffect(() => {
    if (!username) return;
    let cancelado = false;
    setCarregandoOpcoes(true);
    setErroOpcoes(null);
    (async () => {
      try {
        const res = await fetch(`/api/cadastro/opcoes?company=${companyKey}`, {
          headers: { "x-auth-username": username },
          cache: "no-store",
        });
        const json = await res.json();
        if (cancelado) return;
        if (!res.ok) {
          setErroOpcoes(json?.error ?? "Erro ao carregar as opções do cadastro.");
          return;
        }
        setOpcoes(json.opcoes as OpcoesDimensoes);
        setCampos((json.campos ?? []) as CampoProdutoDef[]);
        setMetas((json.dimensoes ?? []) as DimensaoMeta[]);
        setPodeExecutar(Boolean(json.podeExecutar));
      } catch {
        if (!cancelado) setErroOpcoes("Não foi possível carregar as opções do cadastro.");
      } finally {
        if (!cancelado) setCarregandoOpcoes(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [companyKey, username, historicoVersao]);

  const avisarGravou = useCallback(() => setHistoricoVersao((v) => v + 1), []);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Alterar Cadastro</h1>
        {!podeExecutar && !carregandoOpcoes && (
          <div className={styles.avisoTopo}>
            Seu perfil é somente leitura: dá para conferir o impacto, mas não para gravar.
          </div>
        )}
      </header>

      {erroOpcoes && <div className={styles.erroBox}>{erroOpcoes}</div>}

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${aba === "dimensoes" ? styles.tabAtiva : ""}`}
          onClick={() => setAba("dimensoes")}
        >
          Dimensões (grupo, subgrupo, linha…)
        </button>
        <button
          type="button"
          className={`${styles.tab} ${aba === "produto" ? styles.tabAtiva : ""}`}
          onClick={() => setAba("produto")}
        >
          Alterar Produto
        </button>
      </div>

      {aba === "dimensoes" ? (
        <AbaDimensoes
          companyKey={companyKey}
          username={username}
          podeExecutar={podeExecutar}
          metas={metas}
          onGravou={avisarGravou}
        />
      ) : (
        <AbaProduto
          companyKey={companyKey}
          username={username}
          podeExecutar={podeExecutar}
          campos={campos}
          opcoes={opcoes}
          onGravou={avisarGravou}
        />
      )}

      <CadastroHistorico
        companyKey={companyKey}
        username={username}
        podeExecutar={podeExecutar}
        recarregarEm={historicoVersao}
        onEstornado={avisarGravou}
      />
    </div>
  );
}

// ═══════════════════════════ ABA 1 — DIMENSÕES ═══════════════════════════

interface AbaDimensoesProps {
  companyKey: CompanyKey;
  username: string;
  podeExecutar: boolean;
  metas: DimensaoMeta[];
  onGravou: () => void;
}

type ModalDimensao =
  | { modo: "renomear"; row: DimensaoRow }
  | { modo: "criar" }
  | null;

function AbaDimensoes({ companyKey, username, podeExecutar, metas, onGravou }: AbaDimensoesProps) {
  const [tipo, setTipo] = useState<DimensaoTipo>("grupo");
  const [pai, setPai] = useState("");
  const [busca, setBusca] = useState("");
  const [incluirInativos, setIncluirInativos] = useState(false);

  const [rows, setRows] = useState<DimensaoRow[]>([]);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDimensao | null>(null);
  const [modal, setModal] = useState<ModalDimensao>(null);
  const [alterandoInativo, setAlterandoInativo] = useState<string | null>(null);

  const meta = useMemo(() => metas.find((m) => m.tipo === tipo) ?? null, [metas, tipo]);

  const carregar = useCallback(async () => {
    if (!username) return;
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ company: companyKey, tipo });
      if (pai) params.set("pai", pai);
      if (busca.trim().length >= 2) params.set("busca", busca.trim());
      if (incluirInativos) params.set("incluirInativos", "1");

      const res = await fetch(`/api/cadastro/dimensoes?${params}`, {
        headers: { "x-auth-username": username },
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao carregar a dimensão.");
        setRows([]);
        return;
      }
      setRows((json.rows ?? []) as DimensaoRow[]);
      setGrupos((json.grupos ?? []) as string[]);
    } catch {
      setErro("Falha de conexão ao carregar a dimensão.");
    } finally {
      setCarregando(false);
    }
  }, [companyKey, username, tipo, pai, busca, incluirInativos]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Trocar de dimensão limpa o escopo de grupo — ele só existe para subgrupo.
  useEffect(() => {
    setPai("");
    setResultado(null);
  }, [tipo]);

  const alternarInativo = useCallback(
    async (row: DimensaoRow, inativar: boolean) => {
      if (!username) return;
      const rotulo = meta?.label.toLowerCase() ?? "dimensão";
      const texto = inativar
        ? `Inativar o ${rotulo} "${row.nome}"?\n\nOs ${row.produtos} produto(s) que já usam continuam intactos — ` +
          "o inativo só impede escolher esse valor em cadastro novo."
        : `Reativar o ${rotulo} "${row.nome}"?`;
      if (!window.confirm(texto)) return;

      setAlterandoInativo(`${row.pai ?? ""}||${row.nome}`);
      setErro(null);
      try {
        const res = await fetch("/api/cadastro/dimensoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            company: companyKey,
            tipo,
            acao: inativar ? "inativar" : "reativar",
            nome: row.nome,
            chave: row.chave,
            pai: row.pai,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setErro(json?.error ?? "Erro ao mudar ativo/inativo.");
          return;
        }
        setResultado(json as ResultadoDimensao);
        onGravou();
        await carregar();
      } catch {
        setErro("Falha de conexão ao mudar ativo/inativo.");
      } finally {
        setAlterandoInativo(null);
      }
    },
    [companyKey, username, tipo, meta, carregar, onGravou]
  );

  const totalProdutos = useMemo(
    () => rows.reduce((acc, r) => acc + r.produtos, 0),
    [rows]
  );

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Dimensões do cadastro</h2>

        <p className={styles.dica}>
          No Linx, o nome do grupo/subgrupo/linha/tipo <strong>é a chave</strong> na tabela mestre.
          Renomear é um único UPDATE nessa mestre — o próprio Linx cascateia para PRODUTOS e para as
          tabelas filhas, de forma atômica. Coleção é a exceção: ali o nome é só descrição, sem cascata.
        </p>

        <div className={styles.filtros}>
          <label className={styles.campoTexto}>
            <span className={styles.campoLabel}>Dimensão</span>
            <select
              className={styles.select}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as DimensaoTipo)}
            >
              {ORDEM_DIMENSOES.filter((t) => metas.some((m) => m.tipo === t)).map((t) => (
                <option key={t} value={t}>
                  {metas.find((m) => m.tipo === t)?.label ?? t}
                </option>
              ))}
            </select>
          </label>

          {meta?.temPai && (
            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Grupo do subgrupo</span>
              <select className={styles.select} value={pai} onChange={(e) => setPai(e.target.value)}>
                <option value="">Todos os grupos</option>
                {grupos.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className={styles.campoTexto}>
            <span className={styles.campoLabel}>Nome contém</span>
            <input
              className={styles.input}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="ex.: CAPA"
            />
          </label>
        </div>

        {meta?.temPai && (
          <p className={styles.dica}>
            Subgrupo pertence a um grupo: o mesmo nome existe em grupos diferentes (&quot;VISCOSE&quot;
            aparece em dezenas). Renomear vale só para o par grupo + subgrupo da linha escolhida.
          </p>
        )}

        <div className={styles.acoes}>
          <div className={styles.toggles}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={incluirInativos}
                onChange={(e) => setIncluirInativos(e.target.checked)}
              />
              Incluir inativos
            </label>
          </div>
          {meta?.podeCriar && podeExecutar && (
            <button type="button" className={styles.btnSecundario} onClick={() => setModal({ modo: "criar" })}>
              + Criar {meta.label.toLowerCase()}
            </button>
          )}
        </div>
      </section>

      {erro && <div className={styles.erroBox}>{erro}</div>}

      {resultado && (
        <section className={`${styles.card} ${styles.cardResultado}`}>
          <h2 className={styles.cardTitle}>Resultado</h2>
          <div className={styles.resumoLinha}>{resultado.mensagem}</div>
          {resultado.lote && (
            <div className={styles.resumoLinha}>
              Lote <code className={styles.lote}>{resultado.lote}</code>
              <span className={styles.dica}>desfazer fica no histórico, no fim da página</span>
            </div>
          )}
          {resultado.avisos.length > 0 && (
            <div className={styles.avisoBox}>
              <strong>Atenção — o Linx cascateou, mas o dashboard não:</strong>
              <ul className={styles.impactoLista}>
                {resultado.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.resumoLinha}>
          <strong>{rows.length.toLocaleString("pt-BR")}</strong> {meta?.label.toLowerCase() ?? "registro"}(s)
          {totalProdutos > 0 && <> · {totalProdutos.toLocaleString("pt-BR")} produto(s) no total</>}
          {carregando && <span className={styles.dica}>carregando…</span>}
        </div>

        <div className={styles.tabelaWrap}>
          <table className={styles.tabelaFicha}>
            <thead>
              <tr>
                <th className={styles.thFichaNum}>#</th>
                {meta?.temCodigo && <th>Código</th>}
                {meta?.temPai && <th>Grupo</th>}
                <th>Nome</th>
                <th className={styles.thNum}>Produtos</th>
                <th className={styles.thNum}>Da empresa</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const chave = `${row.pai ?? ""}||${row.nome}`;
                const mexendo = alterandoInativo === chave;
                return (
                  <tr key={chave} className={row.inativo ? styles.trInativa : ""}>
                    <td className={styles.thFichaNum}>{i + 1}</td>
                    {meta?.temCodigo && <td className={styles.tdCodigo}>{row.codigo ?? "—"}</td>}
                    {meta?.temPai && <td className={styles.tdDesc}>{row.pai ?? "—"}</td>}
                    <td className={styles.tdDesc}>
                      <strong>{row.nome}</strong>
                    </td>
                    <td className={styles.thNum}>{row.produtos.toLocaleString("pt-BR")}</td>
                    <td className={styles.thNum}>{row.produtosEmpresa.toLocaleString("pt-BR")}</td>
                    <td>
                      {row.inativo ? (
                        <span className={styles.badgeInativa}>inativo</span>
                      ) : (
                        <span className={styles.badgeNeutro}>ativo</span>
                      )}
                    </td>
                    <td className={styles.acoesLinha}>
                      {podeExecutar ? (
                        <>
                          <button
                            type="button"
                            className={styles.btnTexto}
                            onClick={() => setModal({ modo: "renomear", row })}
                          >
                            Renomear
                          </button>
                          <button
                            type="button"
                            className={`${styles.btnTexto} ${row.inativo ? "" : styles.btnTextoPerigo}`}
                            onClick={() => void alternarInativo(row, !row.inativo)}
                            disabled={mexendo}
                          >
                            {mexendo ? "…" : row.inativo ? "Reativar" : "Inativar"}
                          </button>
                        </>
                      ) : (
                        <span className={styles.dica}>somente leitura</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !carregando && (
                <tr>
                  <td colSpan={8} className={styles.dica}>
                    Nada encontrado com esse filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal && meta && (
        <ModalDimensaoForm
          companyKey={companyKey}
          username={username}
          tipo={tipo}
          meta={meta}
          grupos={grupos}
          paiSelecionado={pai}
          estado={modal}
          onFechar={() => setModal(null)}
          onConcluido={async (res) => {
            setModal(null);
            setResultado(res);
            onGravou();
            await carregar();
          }}
        />
      )}
    </>
  );
}

// ───────────────────── modal de renomear / criar dimensão ─────────────────────

interface ModalDimensaoFormProps {
  companyKey: CompanyKey;
  username: string;
  tipo: DimensaoTipo;
  meta: DimensaoMeta;
  grupos: string[];
  paiSelecionado: string;
  estado: NonNullable<ModalDimensao>;
  onFechar: () => void;
  onConcluido: (resultado: ResultadoDimensao) => void | Promise<void>;
}

function ModalDimensaoForm({
  companyKey,
  username,
  tipo,
  meta,
  grupos,
  paiSelecionado,
  estado,
  onFechar,
  onConcluido,
}: ModalDimensaoFormProps) {
  const renomeando = estado.modo === "renomear";
  const rowAtual = renomeando ? estado.row : null;

  const [nome, setNome] = useState(renomeando ? estado.row.nome : "");
  const [codigo, setCodigo] = useState("");
  const [paiNovo, setPaiNovo] = useState(rowAtual?.pai ?? paiSelecionado);
  const [obs, setObs] = useState("");
  const [impacto, setImpacto] = useState<ImpactoDimensao | null>(null);
  const [avaliando, setAvaliando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [textoConfirmacao, setTextoConfirmacao] = useState("");

  // Sugere um código livre ao abrir a criação: o código entra no código do
  // produto (N4.7P.0100) e tem índice UNIQUE, então colidir é erro garantido.
  useEffect(() => {
    if (renomeando || !meta.temCodigo || !username) return;
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/cadastro/dimensoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ company: companyKey, tipo, acao: "sugerirCodigo", pai: paiNovo || null }),
        });
        const json = await res.json();
        if (!cancelado && res.ok && json?.codigo) setCodigo(String(json.codigo));
      } catch {
        /* sugestão é conveniência: o usuário pode digitar */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [renomeando, meta.temCodigo, username, companyKey, tipo, paiNovo]);

  // Pré-checagem: nome já existe, código ocupado, quantos produtos a cascata
  // alcança e quais regras do dashboard citam esse nome por string literal.
  useEffect(() => {
    if (!username) return;
    const alvo = renomeando ? rowAtual!.nome : nome.trim();
    if (!alvo) {
      setImpacto(null);
      return;
    }
    let cancelado = false;
    const timer = setTimeout(() => {
      (async () => {
        setAvaliando(true);
        try {
          const res = await fetch("/api/cadastro/dimensoes", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-auth-username": username },
            body: JSON.stringify({
              company: companyKey,
              tipo,
              acao: "impacto",
              nomeAtual: alvo,
              nomeNovo: renomeando ? nome.trim() : null,
              codigo: codigo.trim() || null,
              chave: renomeando ? rowAtual!.chave : null,
              pai: (renomeando ? rowAtual!.pai : paiNovo) || null,
            }),
          });
          const json = await res.json();
          if (!cancelado && res.ok) setImpacto(json.impacto as ImpactoDimensao);
        } catch {
          /* a checagem repete no servidor antes de gravar */
        } finally {
          if (!cancelado) setAvaliando(false);
        }
      })();
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [username, companyKey, tipo, renomeando, rowAtual, nome, codigo, paiNovo]);

  const nomeLimpo = nome.trim();
  const mudouNome = renomeando && nomeLimpo !== "" && nomeLimpo !== rowAtual!.nome;
  const excedeu = nomeLimpo.length > meta.maxNome;

  const precisaDigitarConfirmacao =
    renomeando && (impacto?.produtos ?? 0) >= LIMITE_CONFIRMACAO_DIGITADA;
  const confirmacaoOk = !precisaDigitarConfirmacao || textoConfirmacao.trim() === rowAtual?.nome;

  const bloqueios: string[] = [];
  if (excedeu) bloqueios.push(`O nome passa do limite de ${meta.maxNome} caracteres do Linx.`);
  if (impacto?.nomeJaExiste) {
    bloqueios.push(
      `Já existe "${nomeLimpo}". Renomear para um nome existente seria uma MESCLAGEM, que o Linx não faz por UPDATE.`
    );
  }
  if (impacto?.codigoJaExiste) {
    bloqueios.push(`O código "${codigo.trim()}" já está em uso — precisa ser livre.`);
  }
  if (impacto?.bloqueadoPorUso) {
    bloqueios.push(
      `${meta.label} está em uso por ${impacto.produtos} produto(s) e esta dimensão não tem cascata de UPDATE no banco: ` +
        "o rename seria rejeitado."
    );
  }
  if (!renomeando && meta.codigoObrigatorio && !codigo.trim()) {
    bloqueios.push("O código é obrigatório nesta dimensão.");
  }
  if (!renomeando && meta.temPai && !paiNovo) {
    bloqueios.push("Escolha o grupo ao qual o subgrupo pertence.");
  }

  const podeGravar =
    bloqueios.length === 0 &&
    nomeLimpo.length > 0 &&
    (renomeando ? mudouNome : true) &&
    confirmacaoOk &&
    !gravando;

  const gravar = useCallback(async () => {
    if (!username) return;
    setGravando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cadastro/dimensoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify(
          renomeando
            ? {
                company: companyKey,
                tipo,
                acao: "renomear",
                nomeAtual: rowAtual!.nome,
                nomeNovo: nomeLimpo,
                chave: rowAtual!.chave,
                pai: rowAtual!.pai,
                obs: obs.trim() || null,
              }
            : {
                company: companyKey,
                tipo,
                acao: "criar",
                nome: nomeLimpo,
                codigo: codigo.trim() || null,
                pai: paiNovo || null,
                obs: obs.trim() || null,
              }
        ),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao gravar.");
        return;
      }
      await onConcluido(json as ResultadoDimensao);
    } catch {
      setErro("Falha de conexão ao gravar.");
    } finally {
      setGravando(false);
    }
  }, [username, companyKey, tipo, renomeando, rowAtual, nomeLimpo, codigo, paiNovo, obs, onConcluido]);

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <h2 className={styles.cardTitle}>
          {renomeando ? `Renomear ${meta.label.toLowerCase()}` : `Criar ${meta.label.toLowerCase()}`}
        </h2>

        {renomeando && (
          <p className={styles.modalAviso}>
            Nome atual: <strong>{rowAtual!.nome}</strong>
            {rowAtual!.pai && <> · grupo <strong>{rowAtual!.pai}</strong></>}
            {rowAtual!.codigo && <> · código <code className={styles.lote}>{rowAtual!.codigo}</code></>}
          </p>
        )}

        <div className={styles.fichaGrid}>
          {!renomeando && meta.temPai && (
            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Grupo</span>
              <select className={styles.select} value={paiNovo} onChange={(e) => setPaiNovo(e.target.value)}>
                <option value="">Escolha o grupo…</option>
                {grupos.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className={styles.campoTexto}>
            <span className={styles.campoLabel}>{renomeando ? "Nome novo" : "Nome"}</span>
            <input
              className={styles.input}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={meta.maxNome + 10}
              placeholder={renomeando ? rowAtual!.nome : "ex.: CAPA IPHONE 18"}
              autoFocus
            />
            <span className={styles.contador}>
              {nomeLimpo.length}/{meta.maxNome} caracteres
            </span>
          </label>

          {!renomeando && meta.temCodigo && (
            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Código</span>
              <input
                className={`${styles.input} ${styles.inputCurto}`}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                maxLength={meta.codigoMax}
              />
              <span className={styles.campoNota}>
                Entra no código do produto (ex.: <code>N4.7P.0100</code>). Sugerimos o primeiro livre.
              </span>
            </label>
          )}
        </div>

        {/* ─── impacto ─── */}
        {renomeando && (
          <div
            className={`${styles.impacto} ${
              bloqueios.length > 0
                ? styles.impactoBloqueio
                : (impacto?.avisosCodigo.length ?? 0) > 0
                  ? styles.impactoAlerta
                  : ""
            }`}
          >
            {avaliando && <span className={styles.dica}>conferindo o impacto…</span>}

            {impacto && (
              <>
                <div>
                  A cascata do Linx vai atualizar{" "}
                  <span className={styles.impactoNumero}>{impacto.produtos.toLocaleString("pt-BR")}</span>{" "}
                  produto(s)
                  {impacto.produtosEmpresa !== impacto.produtos && (
                    <>
                      {" "}
                      — <span className={styles.impactoNumero}>
                        {impacto.produtosEmpresa.toLocaleString("pt-BR")}
                      </span>{" "}
                      da empresa {companyKey === "nerd" ? "NERD" : "ScarfMe"}
                    </>
                  )}
                  .
                </div>

                {meta.nomeEhChave ? (
                  <div className={styles.dica}>
                    Gravamos <strong>um único UPDATE</strong> na tabela mestre. Não tocamos em PRODUTOS: as
                    FKs <code>ON UPDATE CASCADE</code> e os triggers <code>LXU_*</code> do Linx já
                    propagam — e fazem isso dentro do mesmo statement, então ou vale tudo, ou nada.
                  </div>
                ) : (
                  <div className={styles.dica}>
                    Coleção guarda o nome como descrição, não como chave: aqui é só um UPDATE de coluna,
                    sem cascata nenhuma.
                  </div>
                )}

                {impacto.avisosCodigo.length > 0 && (
                  <>
                    <div>
                      <strong>Este nome está fixo no código do dashboard.</strong> O Linx cascateia; estas
                      regras <em>não</em> — elas casam por texto e vão parar de casar em silêncio:
                    </div>
                    <ul className={styles.impactoLista}>
                      {impacto.avisosCodigo.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}

                {impacto.avisosCopia.length > 0 && (
                  <ul className={styles.impactoLista}>
                    {impacto.avisosCopia.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {bloqueios.length > 0 && (
              <ul className={styles.impactoLista}>
                {bloqueios.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!renomeando && bloqueios.length > 0 && (
          <div className={`${styles.impacto} ${styles.impactoBloqueio}`}>
            <ul className={styles.impactoLista}>
              {bloqueios.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <label className={styles.campoTexto}>
          <span className={styles.campoLabel}>Observação (fica no histórico)</span>
          <input
            className={styles.input}
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            maxLength={300}
            placeholder="ex.: padronizando nome de grupo da linha de capas"
          />
        </label>

        {precisaDigitarConfirmacao && (
          <label className={`${styles.campoTexto} ${styles.confirmacaoTexto}`}>
            <span className={styles.campoLabel}>
              São {impacto?.produtos.toLocaleString("pt-BR")} produtos. Digite{" "}
              <strong>{rowAtual!.nome}</strong> para confirmar
            </span>
            <input
              className={styles.input}
              value={textoConfirmacao}
              onChange={(e) => setTextoConfirmacao(e.target.value)}
              placeholder={rowAtual!.nome}
            />
          </label>
        )}

        {erro && <div className={styles.erroBox}>{erro}</div>}

        <div className={styles.modalAcoes}>
          <button type="button" className={styles.btnTexto} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.btnPerigo}
            disabled={!podeGravar}
            onClick={() => void gravar()}
          >
            {gravando ? "Gravando…" : renomeando ? "Renomear no Linx" : "Criar no Linx"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════ ABA 2 — PRODUTO ═══════════════════════════

interface AbaProdutoProps {
  companyKey: CompanyKey;
  username: string;
  podeExecutar: boolean;
  campos: CampoProdutoDef[];
  opcoes: OpcoesDimensoes | null;
  onGravou: () => void;
}

function AbaProduto({ companyKey, username, podeExecutar, campos, opcoes, onGravou }: AbaProdutoProps) {
  const [codigo, setCodigo] = useState("");
  const [produto, setProduto] = useState<ProdutoCadastro | null>(null);
  const [edicao, setEdicao] = useState<Record<string, ValorCampo>>({});
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [obs, setObs] = useState("");
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoProdutos | null>(null);

  const buscar = useCallback(async () => {
    if (!username || !codigo.trim()) return;
    setBuscando(true);
    setErro(null);
    setResultado(null);
    try {
      const res = await fetch("/api/cadastro/produtos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, codigo: codigo.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao buscar o produto.");
        setProduto(null);
        return;
      }
      setProduto(json.produto as ProdutoCadastro);
      setEdicao({});
    } catch {
      setErro("Falha de conexão ao buscar o produto.");
    } finally {
      setBuscando(false);
    }
  }, [username, codigo, companyKey]);

  const valorDe = useCallback(
    (campo: string): ValorCampo => {
      if (campo in edicao) return edicao[campo];
      return produto?.valores[campo] ?? null;
    },
    [edicao, produto]
  );

  const grupoAtual = String(valorDe("GRUPO_PRODUTO") ?? "");

  /**
   * Trocar o grupo pode deixar o subgrupo órfão: o par (grupo, subgrupo) é
   * validado junto pela FK. Quando o subgrupo atual não existe no grupo novo,
   * limpamos o campo para o usuário escolher — em vez de deixar gravar e falhar.
   */
  const definir = useCallback(
    (campo: string, valor: ValorCampo) => {
      setEdicao((prev) => {
        const proximo = { ...prev, [campo]: valor };
        if (campo === "GRUPO_PRODUTO" && opcoes) {
          const disponiveis = opcoes.subgruposPorGrupo[String(valor ?? "")] ?? [];
          const subgrupoAtual = String(proximo.SUBGRUPO_PRODUTO ?? produto?.valores.SUBGRUPO_PRODUTO ?? "");
          if (!disponiveis.some((s) => s === subgrupoAtual)) {
            proximo.SUBGRUPO_PRODUTO = "";
          }
        }
        return proximo;
      });
    },
    [opcoes, produto]
  );

  const alteracoes = useMemo(() => {
    if (!produto) return [];
    return campos
      .filter((c) => !c.somenteLeitura)
      .map((c) => ({ campo: c, atual: produto.valores[c.campo] ?? null, novo: valorDe(c.campo) }))
      .filter(({ campo, atual, novo }) => {
        if (!(campo.campo in edicao)) return false;
        if (campo.tipo === "bool") return Boolean(atual) !== Boolean(novo);
        if (campo.tipo === "inteiro" || campo.tipo === "decimal") {
          const a = atual === null || atual === "" ? null : Number(atual);
          const b = novo === null || novo === "" ? null : Number(novo);
          return a !== b;
        }
        return String(atual ?? "").trim() !== String(novo ?? "").trim();
      });
  }, [produto, campos, edicao, valorDe]);

  const faltando = useMemo(
    () =>
      alteracoes.filter(
        ({ campo, novo }) => campo.obrigatorio && String(novo ?? "").trim() === "" && campo.tipo !== "bool"
      ),
    [alteracoes]
  );

  const gravar = useCallback(async () => {
    if (!username || !produto || alteracoes.length === 0) return;
    setGravando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cadastro/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          alteracoes: alteracoes.map(({ campo, novo }) => ({
            produto: produto.produto,
            campo: campo.campo,
            valor: novo,
          })),
          obs: obs.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao gravar as alterações.");
        return;
      }
      setResultado(json as ResultadoProdutos);
      setRevisando(false);
      setConfirmado(false);
      setObs("");
      setEdicao({});
      onGravou();
      await buscar();
    } catch {
      setErro("Falha de conexão ao gravar as alterações.");
    } finally {
      setGravando(false);
    }
  }, [username, produto, alteracoes, companyKey, obs, onGravou, buscar]);

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Localizar produto</h2>
        <div className={styles.acoes}>
          <label className={styles.campoTexto} style={{ flex: 1, minWidth: 260 }}>
            <span className={styles.campoLabel}>Código do produto ou código de barras</span>
            <input
              className={styles.input}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void buscar()}
              placeholder="ex.: N4.7P.0100 ou 7891234567890"
            />
          </label>
          <button
            type="button"
            className={styles.btnPrimario}
            onClick={() => void buscar()}
            disabled={buscando || !codigo.trim()}
          >
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </div>
      </section>

      {erro && <div className={styles.erroBox}>{erro}</div>}

      {resultado && (
        <section className={`${styles.card} ${styles.cardResultado}`}>
          <h2 className={styles.cardTitle}>Resultado</h2>
          <div className={styles.resumoLinha}>
            <strong>{resultado.aplicados}</strong> campo(s) alterado(s)
            {resultado.semMudanca > 0 && <> · {resultado.semMudanca} já estavam no valor</>}
            {resultado.invalidos > 0 && <> · {resultado.invalidos} inválido(s)</>}
            {resultado.naoConfirmados > 0 && (
              <>
                {" "}
                · <span className={styles.textoErro}>{resultado.naoConfirmados} não confirmado(s)</span>
              </>
            )}
          </div>
          {resultado.lote && (
            <div className={styles.resumoLinha}>
              Lote <code className={styles.lote}>{resultado.lote}</code>
            </div>
          )}
          {resultado.erros.length > 0 && (
            <ul className={styles.listaErros}>
              {resultado.erros.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {produto && (
        <section className={styles.card}>
          <div className={styles.fichaHead}>
            <span className={styles.fichaProduto}>{produto.produto}</span>
            <span className={styles.fichaDesc}>{String(produto.valores.DESC_PRODUTO ?? "")}</span>
            {produto.valores.INATIVO === true && <span className={styles.badgeInativa}>inativo</span>}
          </div>

          <div className={styles.fichaGrid}>
            {campos.map((campo) => {
              const valor = valorDe(campo.campo);
              const alterado = campo.campo in edicao;
              const listaOpcoes =
                campo.tipo === "dimensao" && opcoes ? opcoesDoCampo(campo, opcoes, grupoAtual) : [];

              return (
                <label
                  key={campo.campo}
                  className={`${styles.campoTexto} ${alterado ? styles.campoAlterado : ""}`}
                >
                  <span className={styles.campoLabel}>
                    {campo.label}
                    {campo.obrigatorio && " *"}
                  </span>

                  {campo.tipo === "bool" ? (
                    <select
                      className={styles.select}
                      value={valor ? "1" : "0"}
                      disabled={!podeExecutar || campo.somenteLeitura}
                      onChange={(e) => definir(campo.campo, e.target.value === "1")}
                    >
                      <option value="0">Não</option>
                      <option value="1">Sim</option>
                    </select>
                  ) : campo.tipo === "dimensao" ? (
                    <select
                      className={styles.select}
                      value={String(valor ?? "")}
                      disabled={!podeExecutar || campo.somenteLeitura}
                      onChange={(e) => definir(campo.campo, e.target.value)}
                    >
                      <option value="">
                        {campo.fonte === "subgrupo" && !grupoAtual ? "escolha o grupo primeiro" : "—"}
                      </option>
                      {/* O valor atual pode ser de um cadastro inativo: mantém na lista
                          para não sumir da ficha nem virar alteração acidental. */}
                      {!listaOpcoes.some((o) => o.value === String(valor ?? "")) && valor ? (
                        <option value={String(valor)}>{String(valor)}</option>
                      ) : null}
                      {listaOpcoes.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={styles.input}
                      value={valor === null ? "" : String(valor)}
                      disabled={!podeExecutar || campo.somenteLeitura}
                      maxLength={campo.max}
                      inputMode={campo.tipo === "texto" ? undefined : "decimal"}
                      onChange={(e) => definir(campo.campo, e.target.value)}
                    />
                  )}

                  {campo.somenteLeitura && campo.nota && (
                    <span className={styles.campoBloqueado}>🔒 {campo.nota}</span>
                  )}
                  {!campo.somenteLeitura && campo.nota && (
                    <span className={styles.campoNota}>{campo.nota}</span>
                  )}
                  {campo.max && campo.tipo === "texto" && (
                    <span className={styles.contador}>
                      {String(valor ?? "").length}/{campo.max}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <div className={styles.aplicarBar}>
            <span className={styles.campoLabel}>
              {alteracoes.length === 0
                ? "Nenhum campo alterado"
                : `${alteracoes.length} campo(s) alterado(s)`}
            </span>
            <button
              type="button"
              className={styles.btnSecundario}
              onClick={() => setEdicao({})}
              disabled={alteracoes.length === 0}
            >
              Descartar
            </button>
            <button
              type="button"
              className={styles.btnPrimario}
              disabled={alteracoes.length === 0 || faltando.length > 0 || !podeExecutar}
              onClick={() => {
                setConfirmado(false);
                setRevisando(true);
              }}
            >
              Revisar e gravar
            </button>
          </div>

          {faltando.length > 0 && (
            <div className={styles.erroBox}>
              Campo obrigatório vazio: {faltando.map((f) => f.campo.label).join(", ")}. No Linx essas
              colunas são NOT NULL.
            </div>
          )}
        </section>
      )}

      {revisando && produto && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.cardTitle}>Preview das alterações</h2>
            <p className={styles.modalAviso}>
              {alteracoes.length} campo(s) de <strong>{produto.produto}</strong> serão gravados no cadastro
              do Linx.
            </p>

            <table className={styles.tabelaFicha}>
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Valor atual</th>
                  <th>Valor novo</th>
                </tr>
              </thead>
              <tbody>
                {alteracoes.map(({ campo, atual, novo }) => (
                  <tr key={campo.campo}>
                    <td className={styles.tdDesc}>{campo.label}</td>
                    <td className={styles.tdDesc}>
                      {campo.tipo === "bool"
                        ? atual
                          ? "Sim"
                          : "Não"
                        : String(atual ?? "") || "—"}
                    </td>
                    <td className={styles.tdDesc}>
                      <strong>
                        {campo.tipo === "bool" ? (novo ? "Sim" : "Não") : String(novo ?? "") || "—"}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Observação (fica no histórico)</span>
              <input
                className={styles.input}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                maxLength={300}
              />
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={confirmado}
                onChange={(e) => setConfirmado(e.target.checked)}
              />
              Confirmo que revisei e quero gravar no Linx.
            </label>

            {erro && <div className={styles.erroBox}>{erro}</div>}

            <div className={styles.modalAcoes}>
              <button type="button" className={styles.btnTexto} onClick={() => setRevisando(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className={styles.btnPerigo}
                disabled={!confirmado || gravando || !podeExecutar}
                onClick={() => void gravar()}
              >
                {gravando ? "Gravando…" : `Gravar ${alteracoes.length} campo(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
