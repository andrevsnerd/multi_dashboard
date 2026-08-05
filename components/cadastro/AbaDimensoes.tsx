"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./AlterarCadastroPage.module.css";
import type {
  CompanyKey,
  DimensaoMeta,
  DimensaoRow,
  DimensaoTipo,
  ImpactoDimensao,
  ResultadoDimensao,
} from "./types";

interface Props {
  companyKey: CompanyKey;
  username: string;
  podeExecutar: boolean;
  metas: DimensaoMeta[];
  onGravou: () => void;
}

/** Acima disso o rename pede confirmação digitada — é escrita em muitos produtos. */
const LIMITE_CONFIRMACAO_DIGITADA = 200;
/** Linhas visíveis do detalhe antes de pedir "mostrar todos". */
const LIMITE_DETALHE = 300;

const ORDEM_DIMENSOES: DimensaoTipo[] = ["grupo", "subgrupo", "linha", "tipo", "griffe", "colecao"];

/**
 * Um registro selecionável. Nas dimensões globais é a própria linha; no subgrupo é
 * o par (grupo, subgrupo) — que é o registro físico que o Linx guarda.
 */
interface ItemSelecionavel {
  key: string;
  nome: string;
  chave: string;
  grupo: string | null;
  codigo: string | null;
  inativo: boolean;
  produtos: number;
  produtosEmpresa: number;
}

export default function AbaDimensoes({
  companyKey,
  username,
  podeExecutar,
  metas,
  onGravou,
}: Props) {
  const [tipo, setTipo] = useState<DimensaoTipo>("grupo");
  const [busca, setBusca] = useState("");
  const [incluirInativos, setIncluirInativos] = useState(false);

  const [rows, setRows] = useState<DimensaoRow[]>([]);
  const [agrupado, setAgrupado] = useState(false);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDimensao | null>(null);

  /** Nomes escolhidos na primeira camada. */
  const [nomesEscolhidos, setNomesEscolhidos] = useState<string[]>([]);
  /** Registros desmarcados na camada de detalhe (o padrão é TODOS marcados). */
  const [desmarcados, setDesmarcados] = useState<string[]>([]);
  const [verTodosDetalhes, setVerTodosDetalhes] = useState(false);

  const [novoNome, setNovoNome] = useState("");
  const [criando, setCriando] = useState(false);

  // Execução
  const [revisando, setRevisando] = useState<"renomear" | "inativar" | "reativar" | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [obs, setObs] = useState("");
  const [gravando, setGravando] = useState(false);
  const [impacto, setImpacto] = useState<ImpactoDimensao | null>(null);
  const [textoConfirmacao, setTextoConfirmacao] = useState("");

  const meta = useMemo(() => metas.find((m) => m.tipo === tipo) ?? null, [metas, tipo]);

  // ───────── busca ─────────

  const carregar = useCallback(async () => {
    if (!username) return;
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ company: companyKey, tipo });
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
      setAgrupado(Boolean(json.agrupado));
      setGrupos((json.grupos ?? []) as string[]);
    } catch {
      setErro("Falha de conexão ao carregar a dimensão.");
    } finally {
      setCarregando(false);
    }
  }, [companyKey, username, tipo, busca, incluirInativos]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Trocar de dimensão zera a seleção — ela é de outro conjunto de registros.
  useEffect(() => {
    setNomesEscolhidos([]);
    setDesmarcados([]);
    setNovoNome("");
    setResultado(null);
  }, [tipo]);

  // ───────── camadas de seleção ─────────

  /** Registros dos nomes escolhidos. É a lista de detalhe. */
  const itens = useMemo<ItemSelecionavel[]>(() => {
    const escolhidos = new Set(nomesEscolhidos);
    const out: ItemSelecionavel[] = [];
    for (const row of rows) {
      if (!escolhidos.has(row.nome)) continue;
      if (row.pares.length > 0) {
        for (const par of row.pares) {
          out.push({
            key: `${row.nome}||${par.grupo}`,
            nome: row.nome,
            chave: row.chave,
            grupo: par.grupo,
            codigo: par.codigo,
            inativo: par.inativo,
            produtos: par.produtos,
            produtosEmpresa: par.produtosEmpresa,
          });
        }
      } else {
        out.push({
          key: row.nome,
          nome: row.nome,
          chave: row.chave,
          grupo: row.pai,
          codigo: row.codigo,
          inativo: row.inativo,
          produtos: row.produtos,
          produtosEmpresa: row.produtosEmpresa,
        });
      }
    }
    return out;
  }, [rows, nomesEscolhidos]);

  /** O que vai ser alterado: tudo do detalhe menos o que foi desmarcado. */
  const selecionados = useMemo(
    () => itens.filter((i) => !desmarcados.includes(i.key)),
    [itens, desmarcados]
  );

  const produtosSelecionados = useMemo(
    () => selecionados.reduce((acc, i) => acc + i.produtos, 0),
    [selecionados]
  );

  /** Renomear exige um nome só: N registros do MESMO nome viram um novo nome. */
  const nomesNaSelecao = useMemo(
    () => [...new Set(selecionados.map((i) => i.nome))],
    [selecionados]
  );
  const nomeUnico = nomesNaSelecao.length === 1 ? nomesNaSelecao[0] : null;

  const alternarNome = useCallback((nome: string) => {
    setNomesEscolhidos((prev) => {
      if (prev.includes(nome)) {
        // Sair de um nome leva embora os desmarcados dele.
        setDesmarcados((d) => d.filter((k) => !k.startsWith(`${nome}||`) && k !== nome));
        return prev.filter((n) => n !== nome);
      }
      return [...prev, nome];
    });
    setVerTodosDetalhes(false);
  }, []);

  const alternarItem = useCallback((key: string) => {
    setDesmarcados((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const todosNomesMarcados = rows.length > 0 && rows.every((r) => nomesEscolhidos.includes(r.nome));
  const todosItensMarcados = itens.length > 0 && selecionados.length === itens.length;

  // ───────── pré-checagem do preview ─────────

  const nomeLimpo = novoNome.trim();
  const excedeu = !!meta && nomeLimpo.length > meta.maxNome;

  useEffect(() => {
    if (!username || revisando !== "renomear" || !nomeUnico) return;
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/cadastro/dimensoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            company: companyKey,
            tipo,
            acao: "impacto",
            nomeAtual: nomeUnico,
            nomeNovo: nomeLimpo,
            chave: selecionados[0]?.chave ?? null,
            // Só os grupos marcados entram na conta e na checagem de colisão.
            grupos: selecionados.map((i) => i.grupo).filter(Boolean),
          }),
        });
        const json = await res.json();
        if (!cancelado && res.ok) setImpacto(json.impacto as ImpactoDimensao);
      } catch {
        /* o servidor repete a checagem antes de gravar */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [username, companyKey, tipo, revisando, nomeUnico, nomeLimpo, selecionados]);

  // ───────── execução ─────────

  const executar = useCallback(async () => {
    if (!username || !revisando || selecionados.length === 0) return;
    setGravando(true);
    setErro(null);
    try {
      const gruposSel = selecionados.map((i) => i.grupo).filter(Boolean) as string[];

      /**
       * Inativar/reativar aceita a seleção com VÁRIOS nomes, então manda um alvo por
       * nome com os grupos dele. Renomear é sempre de um nome só (o botão exige).
       */
      const porNome = new Map<string, { nome: string; chave: string; grupos: string[] }>();
      for (const item of selecionados) {
        const atual = porNome.get(item.nome) ?? { nome: item.nome, chave: item.chave, grupos: [] };
        if (item.grupo) atual.grupos.push(item.grupo);
        porNome.set(item.nome, atual);
      }

      const res = await fetch("/api/cadastro/dimensoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          tipo,
          acao: revisando,
          nomeAtual: nomeUnico,
          nome: nomeUnico,
          nomeNovo: revisando === "renomear" ? nomeLimpo : undefined,
          chave: selecionados[0]?.chave ?? null,
          grupos: gruposSel.length > 0 ? gruposSel : undefined,
          alvos:
            revisando === "renomear"
              ? undefined
              : [...porNome.values()].map((a) => ({
                  nome: a.nome,
                  chave: a.chave,
                  grupos: a.grupos.length > 0 ? a.grupos : undefined,
                })),
          obs: obs.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao gravar.");
        return;
      }
      setResultado(json as ResultadoDimensao);
      setRevisando(null);
      setConfirmado(false);
      setObs("");
      setNovoNome("");
      setTextoConfirmacao("");
      setImpacto(null);
      setNomesEscolhidos([]);
      setDesmarcados([]);
      onGravou();
      await carregar();
    } catch {
      setErro("Falha de conexão ao gravar.");
    } finally {
      setGravando(false);
    }
  }, [
    username, revisando, selecionados, companyKey, tipo, nomeUnico, nomeLimpo, obs,
    onGravou, carregar,
  ]);

  // ───────── bloqueios do rename ─────────

  const bloqueios: string[] = [];
  if (revisando === "renomear") {
    if (!nomeUnico) {
      bloqueios.push(
        `A seleção tem ${nomesNaSelecao.length} nomes diferentes. Renomear grava UM nome novo, ` +
          "então a seleção precisa ser de um nome só — juntar cadastros diferentes seria mesclagem."
      );
    }
    if (excedeu) bloqueios.push(`O nome passa do limite de ${meta?.maxNome} caracteres do Linx.`);
    if (impacto?.nomeJaExiste) {
      bloqueios.push(
        (impacto.colisoes ?? []).length > 0
          ? `"${nomeLimpo}" já existe em: ${impacto.colisoes.join(", ")}. Nesses grupos seria uma ` +
            "MESCLAGEM, que o Linx não faz por UPDATE — desmarque-os ou escolha outro nome."
          : `Já existe "${nomeLimpo}". Renomear para um nome existente seria uma MESCLAGEM.`
      );
    }
    if (impacto?.bloqueadoPorUso) {
      bloqueios.push(
        `${meta?.label} está em uso por ${impacto.produtos} produto(s) e esta dimensão não tem ` +
          "cascata de UPDATE no banco: o rename seria rejeitado."
      );
    }
  }

  const precisaDigitarConfirmacao =
    revisando === "renomear" && produtosSelecionados >= LIMITE_CONFIRMACAO_DIGITADA;
  const confirmacaoOk =
    !precisaDigitarConfirmacao || textoConfirmacao.trim() === (nomeUnico ?? "");

  const podeAplicar =
    bloqueios.length === 0 &&
    confirmado &&
    confirmacaoOk &&
    !gravando &&
    podeExecutar &&
    selecionados.length > 0 &&
    (revisando !== "renomear" || (nomeLimpo.length > 0 && nomeLimpo !== nomeUnico));

  const rotulo = meta?.label.toLowerCase() ?? "registro";

  return (
    <>
      {/* ─── ENTRADA ─── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Entrada de dados</h2>

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

          <label className={styles.campoTexto}>
            <span className={styles.campoLabel}>Nome contém</span>
            <input
              className={styles.input}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="ex.: CREPE DE SEDA"
            />
          </label>
        </div>

        <p className={styles.dica}>
          {agrupado ? (
            <>
              O subgrupo aparece <strong>uma vez por nome</strong>. Marque o subgrupo, confira os
              grupos onde ele está, desmarque os que não quer, e altere os selecionados de uma vez.
            </>
          ) : (
            <>
              Marque um ou mais {rotulo}s. O nome novo vale para os registros selecionados; inativar
              e reativar aceitam vários nomes juntos.
            </>
          )}
        </p>

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
            <button type="button" className={styles.btnSecundario} onClick={() => setCriando(true)}>
              + Criar {rotulo}
            </button>
          )}
        </div>
      </section>

      {erro && <div className={styles.erroBox}>{erro}</div>}

      {/* ─── RESULTADO ─── */}
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
              <strong>Atenção:</strong>
              <ul className={styles.impactoLista}>
                {resultado.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ─── CAMADA 1: NOMES DISPONÍVEIS ─── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          {meta?.label ?? "Dimensão"}s disponíveis
        </h2>
        <div className={styles.resumoLinha}>
          <strong>{rows.length.toLocaleString("pt-BR")}</strong> {rotulo}(s)
          {carregando && <span className={styles.dica}>carregando…</span>}
        </div>

        <div className={styles.tabelaWrap}>
          <table className={styles.tabelaFicha}>
            <thead>
              <tr>
                <th className={styles.thCheck}>
                  <input
                    type="checkbox"
                    checked={todosNomesMarcados}
                    onChange={() => {
                      if (todosNomesMarcados) {
                        setNomesEscolhidos([]);
                        setDesmarcados([]);
                      } else {
                        setNomesEscolhidos(rows.map((r) => r.nome));
                      }
                    }}
                    aria-label="Marcar todos"
                  />
                </th>
                <th className={styles.thFichaNum}>#</th>
                {meta?.temCodigo && <th>Código</th>}
                <th>Nome</th>
                {agrupado && <th className={styles.thNum}>Grupos</th>}
                <th className={styles.thNum}>Produtos</th>
                <th className={styles.thNum}>Da empresa</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const marcado = nomesEscolhidos.includes(row.nome);
                return (
                  <tr
                    key={row.nome}
                    className={`${marcado ? styles.trAlterada : ""} ${
                      row.inativo ? styles.trInativa : ""
                    }`}
                    onClick={() => alternarNome(row.nome)}
                  >
                    <td className={styles.thCheck}>
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternarNome(row.nome)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Marcar ${row.nome}`}
                      />
                    </td>
                    <td className={styles.thFichaNum}>{i + 1}</td>
                    {meta?.temCodigo && (
                      <td className={styles.tdCodigo}>
                        {row.codigo ?? (row.pares.length > 1 ? "vários" : "—")}
                      </td>
                    )}
                    <td className={styles.tdDesc}>
                      <strong>{row.nome}</strong>
                    </td>
                    {agrupado && <td className={styles.thNum}>{row.pares.length}</td>}
                    <td className={styles.thNum}>{row.produtos.toLocaleString("pt-BR")}</td>
                    <td className={styles.thNum}>{row.produtosEmpresa.toLocaleString("pt-BR")}</td>
                    <td>
                      {row.inativo ? (
                        <span className={styles.badgeInativa}>inativo</span>
                      ) : row.inativoParcial ? (
                        <span className={styles.badgeNeutro} title="Ativo em parte dos grupos">
                          parcial
                        </span>
                      ) : (
                        <span className={styles.badgeNeutro}>ativo</span>
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

      {/* ─── CAMADA 2: DETALHE DOS REGISTROS + APLICAÇÃO ─── */}
      {itens.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Registros selecionados</h2>

          <div className={styles.resumoLinha}>
            <strong>{selecionados.length.toLocaleString("pt-BR")}</strong> de{" "}
            {itens.length.toLocaleString("pt-BR")} registro(s) ·{" "}
            <strong>{produtosSelecionados.toLocaleString("pt-BR")}</strong> produto(s) na cascata
            {selecionados.length < itens.length && (
              <button type="button" className={styles.btnTexto} onClick={() => setDesmarcados([])}>
                marcar todos de novo
              </button>
            )}
          </div>

          {agrupado && (
            <p className={styles.dica}>
              Cada linha é um registro que o Linx guarda de verdade — o subgrupo dentro daquele
              grupo. Desmarcar um grupo deixa ele com o nome antigo.
            </p>
          )}

          <div className={styles.tabelaWrap}>
            <table className={styles.tabelaFicha}>
              <thead>
                <tr>
                  <th className={styles.thCheck}>
                    <input
                      type="checkbox"
                      checked={todosItensMarcados}
                      onChange={() =>
                        setDesmarcados(todosItensMarcados ? itens.map((i) => i.key) : [])
                      }
                      aria-label="Marcar todos os registros"
                    />
                  </th>
                  <th className={styles.thFichaNum}>#</th>
                  <th>Nome</th>
                  {agrupado && <th>Grupo</th>}
                  {meta?.temCodigo && <th>Código</th>}
                  <th className={styles.thNum}>Produtos</th>
                  <th className={styles.thNum}>Da empresa</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {(verTodosDetalhes ? itens : itens.slice(0, LIMITE_DETALHE)).map((item, i) => {
                  const marcado = !desmarcados.includes(item.key);
                  return (
                    <tr
                      key={item.key}
                      className={marcado ? styles.trAlterada : ""}
                      onClick={() => alternarItem(item.key)}
                    >
                      <td className={styles.thCheck}>
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => alternarItem(item.key)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Marcar ${item.nome} em ${item.grupo ?? ""}`}
                        />
                      </td>
                      <td className={styles.thFichaNum}>{i + 1}</td>
                      <td className={styles.tdDesc}>{item.nome}</td>
                      {agrupado && <td className={styles.tdDesc}>{item.grupo ?? "—"}</td>}
                      {meta?.temCodigo && (
                        <td className={styles.tdCodigo}>{item.codigo ?? "—"}</td>
                      )}
                      <td className={styles.thNum}>{item.produtos.toLocaleString("pt-BR")}</td>
                      <td className={styles.thNum}>
                        {item.produtosEmpresa.toLocaleString("pt-BR")}
                      </td>
                      <td>
                        {item.inativo ? (
                          <span className={styles.badgeInativa}>inativo</span>
                        ) : (
                          <span className={styles.badgeNeutro}>ativo</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {itens.length > LIMITE_DETALHE && (
            <p className={styles.dica}>
              {verTodosDetalhes
                ? `Mostrando todos os ${itens.length.toLocaleString("pt-BR")} registros.`
                : `Mostrando os ${LIMITE_DETALHE} primeiros de ${itens.length.toLocaleString("pt-BR")}.`}
              <button
                type="button"
                className={styles.btnTexto}
                onClick={() => setVerTodosDetalhes((v) => !v)}
              >
                {verTodosDetalhes ? "mostrar menos" : "mostrar todos"}
              </button>
              A alteração vale para os {selecionados.length.toLocaleString("pt-BR")} marcados, não só
              para os visíveis.
            </p>
          )}

          {/* barra de aplicação */}
          <div className={styles.aplicarBar}>
            <span className={styles.campoLabel}>
              Novo nome para {selecionados.length.toLocaleString("pt-BR")} registro(s)
              {nomeUnico ? (
                <>
                  {" "}
                  de <strong>{nomeUnico}</strong>
                </>
              ) : (
                <> — {nomesNaSelecao.length} nomes diferentes na seleção</>
              )}
            </span>
            <input
              className={styles.input}
              style={{ maxWidth: 280 }}
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder={nomeUnico ?? "escolha um nome só"}
              maxLength={(meta?.maxNome ?? 25) + 10}
              disabled={!nomeUnico}
            />
            <button
              type="button"
              className={styles.btnPrimario}
              disabled={
                !podeExecutar ||
                !nomeUnico ||
                nomeLimpo.length === 0 ||
                nomeLimpo === nomeUnico ||
                selecionados.length === 0
              }
              onClick={() => {
                setConfirmado(false);
                setImpacto(null);
                setTextoConfirmacao("");
                setRevisando("renomear");
              }}
            >
              Revisar {selecionados.length.toLocaleString("pt-BR")} alteração(ões)
            </button>
          </div>

          {/* ativo/inativo em massa */}
          {meta?.temInativo && (
            <div className={styles.acoes}>
              <span className={styles.dica}>
                Inativar não toca em produto: só impede escolher esse valor em cadastro novo.
              </span>
              <div className={styles.toggles}>
                <button
                  type="button"
                  className={styles.btnSecundario}
                  disabled={!podeExecutar || selecionados.every((i) => i.inativo)}
                  onClick={() => {
                    setConfirmado(false);
                    setRevisando("inativar");
                  }}
                >
                  Inativar selecionados
                </button>
                <button
                  type="button"
                  className={styles.btnSecundario}
                  disabled={!podeExecutar || selecionados.every((i) => !i.inativo)}
                  onClick={() => {
                    setConfirmado(false);
                    setRevisando("reativar");
                  }}
                >
                  Reativar selecionados
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── PREVIEW ─── */}
      {revisando && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.cardTitle}>
              {revisando === "renomear"
                ? "Preview do rename"
                : revisando === "inativar"
                  ? "Preview — inativar"
                  : "Preview — reativar"}
            </h2>

            <p className={styles.modalAviso}>
              {revisando === "renomear" ? (
                <>
                  {selecionados.length} registro(s) de <strong>{nomeUnico}</strong> passam a se
                  chamar <strong>{nomeLimpo}</strong> no cadastro do Linx.
                </>
              ) : (
                <>
                  {selecionados.length} registro(s) serão marcados como{" "}
                  <strong>{revisando === "inativar" ? "inativos" : "ativos"}</strong>. Nenhum produto
                  é alterado.
                </>
              )}
            </p>

            <table className={styles.tabelaFicha}>
              <thead>
                <tr>
                  <th className={styles.thFichaNum}>#</th>
                  {agrupado && <th>Grupo</th>}
                  <th>Nome atual</th>
                  {revisando === "renomear" && <th>Nome novo</th>}
                  <th className={styles.thNum}>Produtos</th>
                </tr>
              </thead>
              <tbody>
                {selecionados.slice(0, 200).map((item, i) => (
                  <tr key={item.key}>
                    <td className={styles.thFichaNum}>{i + 1}</td>
                    {agrupado && <td className={styles.tdDesc}>{item.grupo ?? "—"}</td>}
                    <td className={styles.tdDesc}>{item.nome}</td>
                    {revisando === "renomear" && (
                      <td className={styles.tdDesc}>
                        <strong>{nomeLimpo}</strong>
                      </td>
                    )}
                    <td className={styles.thNum}>{item.produtos.toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selecionados.length > 200 && (
              <p className={styles.dica}>Mostrando os 200 primeiros de {selecionados.length}.</p>
            )}

            {revisando === "renomear" && (
              <div
                className={`${styles.impacto} ${
                  bloqueios.length > 0
                    ? styles.impactoBloqueio
                    : (impacto?.avisosCodigo.length ?? 0) > 0
                      ? styles.impactoAlerta
                      : ""
                }`}
              >
                {!impacto && <span className={styles.dica}>conferindo o impacto…</span>}

                {impacto && (
                  <>
                    <div>
                      A cascata do Linx vai atualizar{" "}
                      <span className={styles.impactoNumero}>
                        {produtosSelecionados.toLocaleString("pt-BR")}
                      </span>{" "}
                      produto(s).
                    </div>

                    {selecionados.length > 1 ? (
                      <div className={styles.dica}>
                        O Linx guarda um registro por grupo, então gravamos{" "}
                        <strong>um UPDATE por registro</strong> — de propósito: o trigger de cascata
                        do subgrupo pareia INSERTED com DELETED por posição, e num UPDATE de várias
                        linhas isso poderia jogar produto de um grupo para outro. Não tocamos em
                        PRODUTOS: quem propaga é a FK <code>ON UPDATE CASCADE</code> do Linx.
                      </div>
                    ) : (
                      <div className={styles.dica}>
                        Um único UPDATE na mestre. Não tocamos em PRODUTOS: as FKs{" "}
                        <code>ON UPDATE CASCADE</code> e os triggers <code>LXU_*</code> propagam
                        dentro do mesmo statement.
                      </div>
                    )}

                    {impacto.avisosCodigo.length > 0 && (
                      <>
                        <div>
                          <strong>Este nome está fixo no código do dashboard.</strong> O Linx
                          cascateia; estas regras <em>não</em> — elas casam por texto e vão parar de
                          casar em silêncio:
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

            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Observação (fica no histórico)</span>
              <input
                className={styles.input}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                maxLength={300}
                placeholder="ex.: padronizando nome do subgrupo"
              />
            </label>

            {precisaDigitarConfirmacao && (
              <label className={`${styles.campoTexto} ${styles.confirmacaoTexto}`}>
                <span className={styles.campoLabel}>
                  São {produtosSelecionados.toLocaleString("pt-BR")} produtos. Digite{" "}
                  <strong>{nomeUnico}</strong> para confirmar
                </span>
                <input
                  className={styles.input}
                  value={textoConfirmacao}
                  onChange={(e) => setTextoConfirmacao(e.target.value)}
                  placeholder={nomeUnico ?? ""}
                />
              </label>
            )}

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
              <button
                type="button"
                className={styles.btnTexto}
                onClick={() => {
                  setRevisando(null);
                  setImpacto(null);
                }}
                disabled={gravando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.btnPerigo}
                disabled={!podeAplicar}
                onClick={() => void executar()}
              >
                {gravando
                  ? "Gravando…"
                  : `Aplicar em ${selecionados.length.toLocaleString("pt-BR")} registro(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {criando && meta && (
        <ModalCriarDimensao
          companyKey={companyKey}
          username={username}
          tipo={tipo}
          meta={meta}
          grupos={grupos}
          onFechar={() => setCriando(false)}
          onConcluido={async (res) => {
            setCriando(false);
            setResultado(res);
            onGravou();
            await carregar();
          }}
        />
      )}
    </>
  );
}

// ───────────────────────── modal de criação ─────────────────────────

interface ModalCriarProps {
  companyKey: CompanyKey;
  username: string;
  tipo: DimensaoTipo;
  meta: DimensaoMeta;
  grupos: string[];
  onFechar: () => void;
  onConcluido: (resultado: ResultadoDimensao) => void | Promise<void>;
}

function ModalCriarDimensao({
  companyKey,
  username,
  tipo,
  meta,
  grupos,
  onFechar,
  onConcluido,
}: ModalCriarProps) {
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  const [pai, setPai] = useState("");
  const [obs, setObs] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Sugere um código livre: ele entra no código do produto (N4.7P.0100) e tem
  // índice UNIQUE, então colidir é erro garantido.
  useEffect(() => {
    if (!meta.temCodigo || !username) return;
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/cadastro/dimensoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({
            company: companyKey,
            tipo,
            acao: "sugerirCodigo",
            pai: pai || null,
          }),
        });
        const json = await res.json();
        if (!cancelado && res.ok && json?.codigo) setCodigo(String(json.codigo));
      } catch {
        /* sugestão é conveniência */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [meta.temCodigo, username, companyKey, tipo, pai]);

  const nomeLimpo = nome.trim();
  const bloqueios: string[] = [];
  if (nomeLimpo.length > meta.maxNome) {
    bloqueios.push(`O nome passa do limite de ${meta.maxNome} caracteres do Linx.`);
  }
  if (meta.codigoObrigatorio && !codigo.trim()) bloqueios.push("O código é obrigatório.");
  if (meta.temPai && !pai) bloqueios.push("Escolha o grupo ao qual o subgrupo pertence.");

  const gravar = useCallback(async () => {
    if (!username) return;
    setGravando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cadastro/dimensoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          tipo,
          acao: "criar",
          nome: nomeLimpo,
          codigo: codigo.trim() || null,
          pai: pai || null,
          obs: obs.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao criar.");
        return;
      }
      await onConcluido(json as ResultadoDimensao);
    } catch {
      setErro("Falha de conexão ao criar.");
    } finally {
      setGravando(false);
    }
  }, [username, companyKey, tipo, nomeLimpo, codigo, pai, obs, onConcluido]);

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <h2 className={styles.cardTitle}>Criar {meta.label.toLowerCase()}</h2>

        <div className={styles.fichaGrid}>
          {meta.temPai && (
            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Grupo</span>
              <select className={styles.select} value={pai} onChange={(e) => setPai(e.target.value)}>
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
            <span className={styles.campoLabel}>Nome</span>
            <input
              className={styles.input}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={meta.maxNome + 10}
              placeholder="ex.: CREPE DE SEDA"
              autoFocus
            />
            <span className={styles.contador}>
              {nomeLimpo.length}/{meta.maxNome} caracteres
            </span>
          </label>

          {meta.temCodigo && (
            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Código</span>
              <input
                className={`${styles.input} ${styles.inputCurto}`}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                maxLength={meta.codigoMax}
              />
              <span className={styles.campoNota}>
                Entra no código do produto (ex.: <code>N4.7P.0100</code>). Sugerimos o primeiro
                livre.
              </span>
            </label>
          )}
        </div>

        {bloqueios.length > 0 && (
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
          />
        </label>

        <p className={styles.dica}>
          Criação não tem “desfazer”: apagar a mestre arrastaria filhas por CASCADE. Se criar por
          engano, inative.
        </p>

        {erro && <div className={styles.erroBox}>{erro}</div>}

        <div className={styles.modalAcoes}>
          <button type="button" className={styles.btnTexto} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.btnPerigo}
            disabled={bloqueios.length > 0 || nomeLimpo.length === 0 || gravando}
            onClick={() => void gravar()}
          >
            {gravando ? "Criando…" : "Criar no Linx"}
          </button>
        </div>
      </div>
    </div>
  );
}
