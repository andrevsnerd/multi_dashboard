"use client";

/**
 * Adicionar Cor ao cadastro de UM produto, dentro da tela de etiquetas.
 *
 * O fluxo é o da bancada: chegou peça de uma cor que não existe no cadastro,
 * escolhe a cor entre as que o sistema já tem, o Linx gera os códigos de barra
 * (interno + EAN por tamanho) e a etiqueta sai na hora.
 *
 * Duas decisões que valem explicação:
 *
 * 1. A lista mostra o nome que a EMPRESA mais usa naquele código, não só o do
 *    cadastro global — na NERD o 105 é ROSA MESCLA (global: ROSA INDIANO), o 107
 *    é GRAFITE (global: PRETO/OFF WHITE). Escolher pelo nome global imprimiria
 *    etiqueta com o nome errado, então quando os dois divergem os dois aparecem,
 *    e a descrição que vai para o cadastro fica editável.
 *
 * 2. Todo o resto (sequenciais, dígito verificador, um par de códigos por
 *    tamanho da grade) é responsabilidade do servidor, em `produtoCores.ts`,
 *    num batch atômico. Aqui não se calcula código nenhum: o que a tela mostra
 *    antes de gravar é PRÉVIA, e o que ela mostra depois é releitura do banco.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { EtiquetaCompany } from "@/lib/etiquetas/tipos";

import styles from "./ModalAdicionarCor.module.css";

interface CorCatalogo {
  cor: string;
  descBasica: string;
  descEmpresa: string | null;
  usosEmpresa: number;
  jaNoProduto: boolean;
  conflitoDeFormato: boolean;
  corEquivalente: string | null;
  descNoProduto: string | null;
}

interface TamanhoParaCriar {
  tamanho: number;
  grade: string;
}

interface Previa {
  produto: string;
  descProduto: string;
  grade: string;
  inativo: boolean;
  variaPrecoCor: boolean;
  tamanhos: TamanhoParaCriar[];
  origemTamanhos: "cores-irmas" | "grade" | "unico";
  coresAtuais: Array<{ cor: string; descCor: string; codigos: number }>;
  prefixoEan: string;
  proximoInterno: string;
  proximoEan: string;
  catalogo: CorCatalogo[];
  podeGravar: boolean;
  error?: string;
}

interface CodigoCriado {
  tamanho: number;
  grade: string;
  interno: string;
  ean: string;
}

interface Resultado {
  lote: string;
  produto: string;
  descProduto: string;
  cor: string;
  descCor: string;
  codigos: CodigoCriado[];
  precoPorCorCopiado: number;
  avisos: string[];
  error?: string;
}

interface Props {
  companyKey: EtiquetaCompany;
  username: string;
  produto: string;
  descProduto: string;
  /** Somente-leitura (diretor) confere a lista mas não grava. */
  podeGravar: boolean;
  onFechar: () => void;
  /** Chamado depois de criar, para a tela reler o produto e já poder imprimir. */
  onCriada: (cor: string) => void;
}

/** Normaliza para busca sem acento e sem caixa ("lilas" acha "LILÁS"). */
function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export default function ModalAdicionarCor({
  companyKey,
  username,
  produto,
  descProduto,
  podeGravar,
  onFechar,
  onCriada,
}: Props) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);

  const [filtro, setFiltro] = useState("");
  const [corEscolhida, setCorEscolhida] = useState<string | null>(null);
  const [descricao, setDescricao] = useState("");
  const [descricaoTocada, setDescricaoTocada] = useState(false);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  /* ── carga ─────────────────────────────────────────────────────────── */

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/etiquetas/cores", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, produto }),
      });
      const json = (await res.json()) as Previa;
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao carregar o catálogo de cores.");
        return;
      }
      setPrevia(json);
    } catch {
      setErro("Falha de conexão ao carregar o catálogo de cores.");
    } finally {
      setCarregando(false);
    }
  }, [companyKey, username, produto]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Esc fecha — mesmo atalho da ficha de custo.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  /* ── filtro ────────────────────────────────────────────────────────── */

  const catalogo = useMemo(() => previa?.catalogo ?? [], [previa]);

  /**
   * Filtra por código OU por nome, nos dois nomes (o da empresa e o global). O
   * catálogo inteiro (450 cores) já está na memória, então digitar é instantâneo.
   */
  const filtradas = useMemo(() => {
    const t = normalizar(filtro);
    if (!t) return catalogo;
    const termos = t.split(/\s+/).filter(Boolean);
    return catalogo.filter((c) => {
      const alvo = normalizar(`${c.cor} ${c.descEmpresa ?? ""} ${c.descBasica}`);
      return termos.every((termo) => alvo.includes(termo));
    });
  }, [catalogo, filtro]);

  const selecionada = useMemo(
    () => catalogo.find((c) => c.cor === corEscolhida) ?? null,
    [catalogo, corEscolhida]
  );

  /** Escolher a cor sugere a descrição que a empresa usa; digitar vence a sugestão. */
  const escolher = useCallback(
    (cor: CorCatalogo) => {
      setCorEscolhida(cor.cor);
      setResultado(null);
      if (!descricaoTocada) {
        setDescricao((cor.descEmpresa || cor.descBasica || "").toUpperCase());
      }
    },
    [descricaoTocada]
  );

  const tamanhos = previa?.tamanhos ?? [];
  const podeSalvar =
    podeGravar &&
    !!previa?.podeGravar &&
    !!selecionada &&
    !selecionada.jaNoProduto &&
    !selecionada.conflitoDeFormato &&
    descricao.trim().length > 0 &&
    !salvando;

  const salvar = useCallback(async () => {
    if (!selecionada) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/etiquetas/cores/adicionar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          produto,
          cor: selecionada.cor,
          descCor: descricao.trim(),
          obs: obs.trim() || null,
        }),
      });
      const json = (await res.json()) as Resultado;
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao criar a cor.");
        return;
      }
      setResultado(json);
      setCorEscolhida(null);
      setDescricao("");
      setDescricaoTocada(false);
      setObs("");
      // Relê o catálogo (a cor nova passa a aparecer como "já tem") e avisa a
      // tela para recarregar o produto, para a etiqueta já poder ser impressa.
      await carregar();
      onCriada(json.cor);
    } catch {
      setErro("Falha de conexão ao criar a cor.");
    } finally {
      setSalvando(false);
    }
  }, [selecionada, username, companyKey, produto, descricao, obs, carregar, onCriada]);

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={onFechar}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <div className={styles.titulo}>Adicionar Cor</div>
            <div className={styles.subtitulo}>
              <strong>{produto}</strong> {descProduto}
              {previa?.inativo ? <span className={styles.tagInativo}>inativo</span> : null}
              {previa ? (
                <>
                  {" · "}
                  {previa.coresAtuais.length} cor
                  {previa.coresAtuais.length === 1 ? "" : "es"} no cadastro
                </>
              ) : null}
            </div>
          </div>
          <button type="button" className={styles.botaoFechar} onClick={onFechar} aria-label="Fechar">
            ✕
          </button>
        </div>

        {erro ? <div className={styles.erro}>{erro}</div> : null}

        {resultado ? (
          <div className={styles.ok}>
            Cor <strong>{resultado.cor}</strong> {resultado.descCor} criada no cadastro do Linx com{" "}
            {resultado.codigos.length} tamanho(s):{" "}
            <span className={styles.mono}>
              {resultado.codigos
                .map((c) => `${c.grade || c.tamanho} ${c.interno} / ${c.ean}`)
                .join(" · ")}
            </span>
            {resultado.lote ? (
              <>
                {" "}
                · lote <strong>{resultado.lote}</strong> no histórico de Alterar Cadastro
              </>
            ) : null}
          </div>
        ) : null}

        {resultado?.avisos?.length ? (
          <div className={styles.aviso}>{resultado.avisos.join(" ")}</div>
        ) : null}

        {carregando ? (
          <div className={styles.vazio}>Carregando as cores cadastradas…</div>
        ) : previa ? (
          <>
            <div className={styles.busca}>
              <span className={styles.rotulo}>
                Procure pelo número ou pelo nome da cor ({catalogo.length} cadastradas)
              </span>
              <input
                className={styles.inputBusca}
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="ex.: 06, roxo, azul marinho"
                autoFocus
              />
            </div>

            <div className={styles.lista}>
              {filtradas.length === 0 ? (
                <div className={styles.vazio}>
                  Nenhuma cor cadastrada casa com “{filtro}”. Cor nova de verdade tem que nascer no
                  cadastro de cores do Linx primeiro.
                </div>
              ) : (
                filtradas.map((cor) => {
                  const nome = cor.descEmpresa || cor.descBasica;
                  // O nome global só aparece quando DIVERGE — é o alerta de que
                  // '06' na tabela é PRETO mas na prática é ROXO.
                  const divergente =
                    !!cor.descEmpresa &&
                    normalizar(cor.descEmpresa) !== normalizar(cor.descBasica);
                  const bloqueada = cor.jaNoProduto || cor.conflitoDeFormato;
                  return (
                    <button
                      key={cor.cor}
                      type="button"
                      className={`${styles.item} ${
                        cor.cor === corEscolhida ? styles.itemSelecionado : ""
                      }`}
                      onClick={() => escolher(cor)}
                      disabled={bloqueada}
                      title={
                        cor.jaNoProduto
                          ? `O produto já tem essa cor (${cor.descNoProduto ?? ""})`
                          : cor.conflitoDeFormato
                            ? `O produto já tem essa cor como "${cor.corEquivalente}" — use a que existe`
                            : divergente
                              ? `No cadastro global esta cor é "${cor.descBasica}"`
                              : undefined
                      }
                    >
                      <span className={styles.codigo}>{cor.cor}</span>
                      <span className={styles.nome}>{nome}</span>
                      {divergente ? (
                        <span className={styles.nomeGlobal}>(global: {cor.descBasica})</span>
                      ) : null}
                      {cor.jaNoProduto ? <span className={styles.tagJaTem}>já tem</span> : null}
                      {cor.conflitoDeFormato ? (
                        <span className={styles.tagConflito}>já tem como {cor.corEquivalente}</span>
                      ) : null}
                      <span className={styles.usos}>
                        {cor.usosEmpresa > 0
                          ? `${cor.usosEmpresa} produto${cor.usosEmpresa === 1 ? "" : "s"}`
                          : "não usada aqui"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className={styles.previa}>
              <div className={styles.previaLinha}>
                <span>
                  Grade <strong>{previa.grade || "—"}</strong>
                </span>
                <span>
                  Vai criar{" "}
                  <strong>
                    {tamanhos.length} tamanho{tamanhos.length === 1 ? "" : "s"}
                  </strong>{" "}
                  ({tamanhos.map((t) => t.grade).join(", ")}) ={" "}
                  <strong>{tamanhos.length * 2} códigos de barra</strong> (interno + EAN-13 cada)
                </span>
              </div>
              <div className={styles.previaLinha}>
                <span>
                  Próximos códigos do Linx:{" "}
                  <strong className={styles.mono}>{previa.proximoInterno || "—"}</strong> e{" "}
                  <strong className={styles.mono}>{previa.proximoEan || "—"}</strong> (prefixo{" "}
                  {previa.prefixoEan || "—"}) — o número final é o que a sequência der na hora de
                  gravar.
                </span>
              </div>
              {previa.origemTamanhos === "grade" ? (
                <div className={styles.previaLinha}>
                  <span>
                    O produto ainda não tem código de barra nenhum: os tamanhos vieram do cadastro
                    da grade.
                  </span>
                </div>
              ) : null}
              {previa.origemTamanhos === "unico" ? (
                <div className={styles.previaLinha}>
                  <span>
                    Sem barras e sem grade reconhecida: vai criar um tamanho único (rótulo “U”).
                  </span>
                </div>
              ) : null}
              {previa.variaPrecoCor ? (
                <div className={styles.previaLinha}>
                  <span>
                    Produto com <strong>preço por cor</strong>: as linhas de preço da cor nova são
                    copiadas de uma cor irmã.
                  </span>
                </div>
              ) : null}
            </div>

            {selecionada && !selecionada.jaNoProduto && !selecionada.conflitoDeFormato ? (
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Cor escolhida</th>
                    <th>Descrição que vai para o cadastro (sai na etiqueta)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={styles.tdMono}>{selecionada.cor}</td>
                    <td>
                      <input
                        className={styles.inputTexto}
                        value={descricao}
                        maxLength={40}
                        onChange={(e) => {
                          setDescricao(e.target.value);
                          setDescricaoTocada(true);
                        }}
                        placeholder={selecionada.descEmpresa || selecionada.descBasica}
                        disabled={!podeGravar}
                        aria-label="Descrição da cor no cadastro do produto"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}

            <div className={styles.rodape}>
              <label className={styles.campoRodape}>
                <span>Observação (vai para o histórico)</span>
                <input
                  className={styles.inputTexto}
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="ex.: nota 12345 do fornecedor"
                  disabled={!podeGravar}
                />
              </label>
              <div className={styles.acoes}>
                <button type="button" className={styles.botao} onClick={onFechar}>
                  Fechar
                </button>
                <button
                  type="button"
                  className={`${styles.botao} ${styles.botaoPrimario}`}
                  onClick={() => void salvar()}
                  disabled={!podeSalvar}
                  title={
                    podeGravar
                      ? "Cria a cor e os códigos de barra no cadastro do Linx"
                      : "Seu perfil é somente leitura"
                  }
                >
                  {salvando
                    ? "Criando…"
                    : selecionada
                      ? `Criar cor ${selecionada.cor} (${tamanhos.length * 2} códigos)`
                      : "Escolha uma cor"}
                </button>
              </div>
            </div>

            {!podeGravar ? (
              <div className={styles.aviso}>
                Seu perfil é somente leitura: dá para conferir as cores, mas não para criar.
              </div>
            ) : (
              <div className={styles.aviso}>
                Criar cor não tem desfazer — o cadastro do Linx não tem “inativo” para cor. Confira
                o código e o nome antes de gravar.
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
