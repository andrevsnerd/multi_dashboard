"use client";

/**
 * Custo / Preço de UM produto, dentro da tela de etiquetas.
 *
 * É a mesma ficha da página Alterar Custo / Preço (todos os registros de tabela
 * de preço do item), mas com o valor editável linha a linha — o fluxo é
 * "chegou a mercadoria, o custo mudou, corrige e imprime a etiqueta na hora".
 *
 * Nada aqui fala com o banco por conta própria: usa as MESMAS rotas
 * (`/api/precos/produtos` e `/api/precos/executar`), então a regra de gravação,
 * a releitura de confirmação e o histórico (`NERD_PRECO_HISTORICO`, com estorno
 * pela página de Alterar Custo / Preço) são exatamente os mesmos.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { EtiquetaCompany } from "@/lib/etiquetas/tipos";

import styles from "./ModalCustoProduto.module.css";

interface CampoAlvo {
  key: string;
  origem: "PRODUTOS" | "PRODUTOS_PRECOS";
  campo: string;
  codigoTabela: string | null;
  label: string;
  espelho: string | null;
  avancado: boolean;
}

interface TabelaSelecionada {
  codigo: string;
  descricao: string;
  inativa: boolean;
  comRegistro: number;
}

interface ProdutoRow {
  produto: string;
  descricao: string;
  inativo: boolean;
  v: Array<number | null>;
  sr: number[];
}

interface RespostaProdutos {
  rows: ProdutoRow[];
  campos: CampoAlvo[];
  tabelas: TabelaSelecionada[];
  error?: string;
}

interface ResumoCampoExec {
  campoKey: string;
  label: string;
  codTabela: string | null;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
}

interface Resultado {
  lote: string;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
  porCampo: ResumoCampoExec[];
  erros: string[];
}

/** Uma linha da ficha: um slot PRECO1..4 de uma tabela de preço. */
interface LinhaFicha {
  /** chave estável da linha (usada como key do React e do rascunho). */
  id: string;
  cod: string;
  desc: string;
  /** coluna gravável do valor principal. */
  campoKey: string;
  valor: number | null;
  /** coluna do Preço Líquido do mesmo slot. */
  liquidoKey: string | null;
  liquido: number | null;
}

interface Props {
  companyKey: EtiquetaCompany;
  username: string;
  produto: string;
  descProduto: string;
  /** Somente-leitura (diretor) enxerga os valores mas não grava. */
  podeGravar: boolean;
  onFechar: () => void;
}

function fmt(valor: number | null | undefined): string {
  const n = valor ?? 0;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Aceita "148,00" e "148.00" — o mesmo parser da página de Alterar Custo / Preço. */
function parseValor(texto: string): number | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  const normalizado = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function mesmoValor(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.005;
}

export default function ModalCustoProduto({
  companyKey,
  username,
  produto,
  descProduto,
  podeGravar,
  onFechar,
}: Props) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [campos, setCampos] = useState<CampoAlvo[]>([]);
  const [tabelas, setTabelas] = useState<TabelaSelecionada[]>([]);
  const [row, setRow] = useState<ProdutoRow | null>(null);

  const [mostrarZerados, setMostrarZerados] = useState(false);
  /** Valor digitado por linha; vazio = não mexe naquela linha. */
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  /** Atalho "mesmo valor em todas as tabelas". */
  const [valorTodas, setValorTodas] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  /* ── carga ─────────────────────────────────────────────────────────── */

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/precos/produtos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          codigos: [produto],
          // Item inativo e item carimbado em outra EMPRESA também têm etiqueta
          // para imprimir — a ficha não pode sumir por causa do escopo.
          incluirInativos: true,
          todoCadastro: true,
          // Traz PRECO2..4 e os campos avançados do cadastro, igual à ficha de
          // um produto só na página de Alterar Custo / Preço.
          incluirAvancados: true,
        }),
      });
      const json = (await res.json()) as RespostaProdutos;
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao carregar os preços do produto.");
        return;
      }
      const encontrado = (json.rows ?? []).find((r) => r.produto === produto) ?? (json.rows ?? [])[0] ?? null;
      setCampos(json.campos ?? []);
      setTabelas(json.tabelas ?? []);
      setRow(encontrado);
      if (!encontrado) setErro("Produto não encontrado no cadastro de preços.");
    } catch {
      setErro("Falha de conexão ao carregar os preços do produto.");
    } finally {
      setCarregando(false);
    }
  }, [companyKey, username, produto]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Esc fecha — menos uma viagem até o X quando o fluxo é rápido.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  /* ── ficha ─────────────────────────────────────────────────────────── */

  const indicePorCampo = useMemo(() => {
    const mapa = new Map<string, number>();
    campos.forEach((c, i) => mapa.set(c.key, i));
    return mapa;
  }, [campos]);

  const valorDe = useCallback(
    (campoKey: string): number | null => {
      if (!row) return null;
      const i = indicePorCampo.get(campoKey);
      if (i === undefined || row.sr.includes(i)) return null;
      return row.v[i] ?? null;
    },
    [row, indicePorCampo]
  );

  const temRegistro = useCallback(
    (campoKey: string): boolean => {
      if (!row) return false;
      const i = indicePorCampo.get(campoKey);
      return i !== undefined && !row.sr.includes(i);
    },
    [row, indicePorCampo]
  );

  /**
   * Tabelas de preço, mesma montagem da página: uma linha por slot PRECO1..4 em
   * que o produto tem registro, escondendo inativas/zeradas por padrão. É a
   * única lista da ficha — os campos do cadastro (custo/preço de reposição) não
   * entram aqui de propósito; quem manda é a tabela de preço.
   */
  const linhasTabelas = useMemo<LinhaFicha[]>(() => {
    if (!row) return [];
    const out: LinhaFicha[] = [];
    for (const tabela of tabelas) {
      if (!mostrarZerados && tabela.inativa) continue;
      for (let n = 1; n <= 4; n += 1) {
        const campoKey = `T::${tabela.codigo}::PRECO${n}`;
        const liquidoKey = `T::${tabela.codigo}::PRECO_LIQUIDO${n}`;
        if (!indicePorCampo.has(campoKey)) continue;
        if (!temRegistro(campoKey)) continue;
        const valor = valorDe(campoKey);
        if (!mostrarZerados && (valor ?? 0) === 0) continue;
        out.push({
          id: `${tabela.codigo}-P${n}`,
          cod: tabela.codigo,
          desc: tabela.descricao,
          campoKey,
          valor,
          liquidoKey: indicePorCampo.has(liquidoKey) ? liquidoKey : null,
          liquido: valorDe(liquidoKey),
        });
      }
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }, [row, tabelas, indicePorCampo, temRegistro, valorDe, mostrarZerados]);

  const somaPrecos = useMemo(
    () => linhasTabelas.reduce((acc, l) => acc + (l.valor ?? 0), 0),
    [linhasTabelas]
  );

  /* ── alterações pendentes ──────────────────────────────────────────── */

  const alteracoes = useMemo(() => {
    const lista: Array<{ id: string; desc: string; cod: string; campoKey: string; atual: number | null; novo: number }> = [];
    for (const linha of linhasTabelas) {
      const digitado = rascunho[linha.id];
      const novo = parseValor(digitado ?? "");
      if (novo === null) continue;
      // O espelho (Preço Líquido) é resolvido no servidor; aqui basta detectar
      // que o valor principal OU o líquido está diferente do que já está gravado.
      const precisaLiquido = linha.liquidoKey !== null && !mesmoValor(linha.liquido, novo);
      if (mesmoValor(linha.valor, novo) && !precisaLiquido) continue;
      lista.push({ id: linha.id, desc: linha.desc, cod: linha.cod, campoKey: linha.campoKey, atual: linha.valor, novo });
    }
    return lista;
  }, [linhasTabelas, rascunho]);

  /** Mesmo valor em todas as tabelas visíveis — é o atalho da página original. */
  const aplicarEmTodasAsTabelas = useCallback(
    (texto: string) => {
      setValorTodas(texto);
      setRascunho((atual) => {
        const proximo = { ...atual };
        for (const linha of linhasTabelas) proximo[linha.id] = texto;
        return proximo;
      });
    },
    [linhasTabelas]
  );

  const salvar = useCallback(async () => {
    if (alteracoes.length === 0) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/precos/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          alteracoes: alteracoes.map((a) => ({ produto, campoKey: a.campoKey, valor: a.novo })),
          // Espelhos idênticos aos da página: PRECOn grava PRECO_LIQUIDOn junto
          // (regra do script). O espelho à vista é do cadastro, que esta ficha
          // não edita — fica desligado.
          sincronizarPrecoLiquido: true,
          sincronizarPrecoAVista: false,
          obs: obs.trim() || "Alterado pela tela de Imprimir Etiquetas",
        }),
      });
      const json = (await res.json()) as Resultado & { error?: string };
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao gravar as alterações.");
        return;
      }
      setResultado(json);
      setRascunho({});
      setValorTodas("");
      setObs("");
      // Relê do banco: a ficha passa a mostrar o que ficou gravado de verdade.
      await carregar();
    } catch {
      setErro("Falha de conexão ao gravar as alterações.");
    } finally {
      setSalvando(false);
    }
  }, [alteracoes, username, companyKey, produto, obs, carregar]);

  /* ── render ────────────────────────────────────────────────────────── */

  const renderLinhas = (linhas: LinhaFicha[]) =>
    linhas.map((linha, i) => {
      const digitado = rascunho[linha.id] ?? "";
      const novo = parseValor(digitado);
      const invalido = digitado.trim() !== "" && novo === null;
      const alterada = alteracoes.some((a) => a.id === linha.id);
      return (
        <tr key={linha.id} className={alterada ? styles.trAlterada : ""}>
          <td className={styles.tdNum}>{i + 1}</td>
          <td className={styles.tdCodigo}>{linha.cod}</td>
          <td className={styles.tdDesc}>{linha.desc}</td>
          <td className={styles.tdValor}>{fmt(linha.valor)}</td>
          <td className={styles.tdValor}>{linha.liquidoKey ? fmt(linha.liquido) : "—"}</td>
          <td className={styles.tdValor}>
            <input
              className={`${styles.inputValor} ${invalido ? styles.inputInvalido : ""}`}
              value={digitado}
              onChange={(e) => setRascunho((atual) => ({ ...atual, [linha.id]: e.target.value }))}
              placeholder={fmt(linha.valor)}
              inputMode="decimal"
              disabled={!podeGravar}
              aria-label={`Novo valor para ${linha.desc}`}
            />
          </td>
        </tr>
      );
    });

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={onFechar}>
      {/* O clique de dentro não fecha: digitar valor e arrastar seleção passa por aqui. */}
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <div className={styles.titulo}>Custo / Preço</div>
            <div className={styles.subtitulo}>
              <strong>{produto}</strong> {descProduto}
              {row?.inativo ? <span className={styles.tagInativo}>inativo</span> : null}
            </div>
          </div>
          <button type="button" className={styles.botaoFechar} onClick={onFechar} aria-label="Fechar">
            ✕
          </button>
        </div>

        {erro ? <div className={styles.erro}>{erro}</div> : null}

        {resultado ? (
          <div className={resultado.naoConfirmados > 0 || resultado.erros.length > 0 ? styles.aviso : styles.ok}>
            {resultado.aplicados} alteração(ões) gravada(s)
            {resultado.lote ? (
              <>
                {" "}· lote <strong>{resultado.lote}</strong> no histórico de Alterar Custo / Preço
              </>
            ) : null}
            {resultado.semMudanca > 0 ? ` · ${resultado.semMudanca} sem mudança` : ""}
            {resultado.naoConfirmados > 0 ? ` · ${resultado.naoConfirmados} não confirmada(s)` : ""}
            {resultado.erros.length > 0 ? ` · ${resultado.erros.join(" ")}` : ""}
          </div>
        ) : null}

        {carregando ? (
          <div className={styles.vazio}>Carregando os preços do produto…</div>
        ) : row ? (
          <>
            <div className={styles.resumo}>
              <span>
                Total de registros: <strong>{linhasTabelas.length}</strong> · Soma dos preços:{" "}
                <strong>R$ {fmt(somaPrecos)}</strong>
              </span>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={mostrarZerados}
                  onChange={(e) => setMostrarZerados(e.target.checked)}
                />
                Mostrar tabelas inativas e zeradas
              </label>
            </div>

            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th className={styles.thNum}>#</th>
                  <th>Cod.Tabela</th>
                  <th>Descrição da Tabela</th>
                  <th className={styles.thValor}>Preço (1)</th>
                  <th className={styles.thValor}>Preço Líquido (1)</th>
                  <th className={styles.thValor}>Novo valor</th>
                </tr>
              </thead>
              <tbody>
                {renderLinhas(linhasTabelas)}
                {linhasTabelas.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.vazio}>
                      O produto não tem registro em nenhuma tabela de preço ativa.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <div className={styles.rodape}>
              <label className={styles.campoRodape}>
                <span>Mesmo valor em todas as tabelas</span>
                <input
                  className={styles.inputValor}
                  value={valorTodas}
                  placeholder="ex.: 188,00"
                  inputMode="decimal"
                  disabled={!podeGravar || linhasTabelas.length === 0}
                  onChange={(e) => aplicarEmTodasAsTabelas(e.target.value)}
                  aria-label="Aplicar o mesmo valor em todas as tabelas de preço"
                />
              </label>
              <label className={`${styles.campoRodape} ${styles.campoObs}`}>
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
                  disabled={!podeGravar || salvando || alteracoes.length === 0}
                  title={
                    podeGravar
                      ? "Grava no cadastro do Linx e registra no histórico"
                      : "Seu perfil é somente leitura"
                  }
                >
                  {salvando ? "Gravando…" : `Gravar ${alteracoes.length} alteração(ões)`}
                </button>
              </div>
            </div>

            {!podeGravar ? (
              <div className={styles.aviso}>
                Seu perfil é somente leitura: dá para conferir, mas não para gravar.
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
