"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanyKey } from "@/lib/config/company";
import { useAuth } from "@/components/auth/AuthContext";

import styles from "./AjusteEstoquePage.module.css";

interface FilialAjuste {
  cod: string;
  nome: string;
  display: string;
  apelido: string | null;
  estoquePositivo: number;
  linhas: number;
  company: CompanyKey | null;
  vendaRecente: boolean;
}

interface DiferencaLinha {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  saldo: number;
  contagem: number;
  delta: number;
}

interface PreviewResposta {
  filialNome: string;
  linhas: DiferencaLinha[];
  totais: {
    itens: number;
    comDiferenca: number;
    positivos: number;
    negativos: number;
    somaDelta: number;
    saldoAtualTotal: number;
    saldoFinalTotal: number;
    itensSaldoNegativo: number;
  };
  naoEncontrados: string[];
  ambiguos: string[];
  invalidas: string[];
}

interface AjusteRecente {
  nome: string;
  filial: string;
  emissao: string;
  itens: number;
  soma: number;
}

type Modo = "inventario" | "zerar";

interface Props {
  companyKey: CompanyKey;
  companyName: string;
}

function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sugerirNome(modo: Modo, display: string, dataISO: string): string {
  const compact = (display || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "");
  const [, mm, dd] = dataISO.split("-");
  const ddmm = `${dd ?? ""}${mm ?? ""}`;
  const base = modo === "zerar" ? `ZERAR${compact}${ddmm}` : `INV${compact}${ddmm}`;
  return base.slice(0, 25);
}

export default function AjusteEstoquePage({ companyKey, companyName }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [filiais, setFiliais] = useState<{ ativas: FilialAjuste[]; inativas: FilialAjuste[] }>({
    ativas: [],
    inativas: [],
  });
  const [carregandoFiliais, setCarregandoFiliais] = useState(true);
  const [filialCod, setFilialCod] = useState("");
  const [modo, setModo] = useState<Modo>("inventario");
  const [dataContagem, setDataContagem] = useState(hojeISO());
  const [nomeContagem, setNomeContagem] = useState("");
  const [nomeEditado, setNomeEditado] = useState(false);
  const [obs, setObs] = useState("");

  const [arquivoTexto, setArquivoTexto] = useState("");
  const [arquivoNome, setArquivoNome] = useState("");
  const [arquivoLinhas, setArquivoLinhas] = useState(0);
  const [zerarNaoContados, setZerarNaoContados] = useState(true);

  const [preview, setPreview] = useState<PreviewResposta | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarTodos, setMostrarTodos] = useState(false);

  const [confirmando, setConfirmando] = useState(false);
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [resultado, setResultado] = useState<
    { nomeContagem: string; itensAjustados: number; somaDelta: number; semDiferenca: number } | null
  >(null);

  const [recentes, setRecentes] = useState<AjusteRecente[]>([]);
  const [estornandoNome, setEstornandoNome] = useState<string | null>(null);
  const [estornoMsg, setEstornoMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchRecentes = useCallback(async () => {
    if (!username) return;
    try {
      const r = await fetch("/api/ajuste-estoque/recentes", {
        headers: { "x-auth-username": username },
      });
      const d = await r.json();
      setRecentes(Array.isArray(d?.recentes) ? d.recentes : []);
    } catch {
      /* silencioso */
    }
  }, [username]);

  useEffect(() => {
    fetchRecentes();
  }, [fetchRecentes]);

  const desfazer = useCallback(
    async (nome: string) => {
      if (
        !window.confirm(
          `Desfazer o ajuste "${nome}"? Será criado um estorno que devolve o estoque ao estado anterior (registrado no histórico).`
        )
      ) {
        return;
      }
      setEstornandoNome(nome);
      setEstornoMsg(null);
      setErro(null);
      try {
        const r = await fetch("/api/ajuste-estoque/estornar", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ nomeOriginal: nome }),
        });
        const d = await r.json();
        if (!r.ok) {
          setErro(d?.error ?? "Erro ao desfazer ajuste.");
          return;
        }
        setEstornoMsg(
          `Estorno "${d.nomeContagem}" aplicado — ${d.itensAjustados} item(ns) revertido(s).`
        );
        fetchRecentes();
      } catch {
        setErro("Erro de conexão ao desfazer ajuste.");
      } finally {
        setEstornandoNome(null);
      }
    },
    [username, fetchRecentes]
  );

  const filialSelecionada = useMemo(() => {
    return (
      filiais.ativas.find((f) => f.cod === filialCod) ??
      filiais.inativas.find((f) => f.cod === filialCod) ??
      null
    );
  }, [filiais, filialCod]);

  // Carrega filiais da empresa.
  useEffect(() => {
    let ativo = true;
    setCarregandoFiliais(true);
    fetch(`/api/ajuste-estoque/filiais?company=${companyKey}`)
      .then((r) => r.json())
      .then((data) => {
        if (!ativo) return;
        if (data?.ativas) setFiliais({ ativas: data.ativas, inativas: data.inativas ?? [] });
      })
      .catch(() => {})
      .finally(() => ativo && setCarregandoFiliais(false));
    return () => {
      ativo = false;
    };
  }, [companyKey]);

  // Sugere a descrição (NOME_CONTAGEM) enquanto o usuário não editar manualmente.
  useEffect(() => {
    if (nomeEditado) return;
    if (!filialSelecionada) return;
    setNomeContagem(sugerirNome(modo, filialSelecionada.display, dataContagem));
  }, [modo, filialSelecionada, dataContagem, nomeEditado]);

  // Reset do preview quando muda o contexto.
  useEffect(() => {
    setPreview(null);
    setResultado(null);
    setErro(null);
  }, [filialCod, modo, arquivoTexto, zerarNaoContados]);

  const handleArquivo = useCallback((file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const texto = String(reader.result ?? "");
      setArquivoTexto(texto);
      setArquivoNome(file.name);
      setArquivoLinhas(texto.split(/\r?\n/).filter((l) => l.trim()).length);
    };
    reader.readAsText(file);
  }, []);

  const calcular = useCallback(async () => {
    if (!filialCod) {
      setErro("Selecione uma filial.");
      return;
    }
    if (modo === "inventario" && !arquivoTexto.trim()) {
      setErro("Carregue o arquivo de inventário.");
      return;
    }
    setErro(null);
    setCalculando(true);
    setPreview(null);
    try {
      const resp = await fetch("/api/ajuste-estoque/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filialCod, modo, arquivoTexto, zerarNaoContados }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErro(data?.error ?? "Erro ao calcular diferenças.");
        return;
      }
      setPreview(data as PreviewResposta);
    } catch {
      setErro("Erro de conexão ao calcular diferenças.");
    } finally {
      setCalculando(false);
    }
  }, [filialCod, modo, arquivoTexto, zerarNaoContados]);

  const linhasComDiferenca = useMemo(
    () => (preview ? preview.linhas.filter((l) => l.delta !== 0) : []),
    [preview]
  );
  const linhasExibidas = mostrarTodos ? preview?.linhas ?? [] : linhasComDiferenca;

  const executar = useCallback(async () => {
    if (!preview) return;
    setExecutando(true);
    setErro(null);
    try {
      const itens = linhasComDiferenca.map((l) => ({
        produto: l.produto,
        cor: l.cor,
        contagem: l.contagem,
      }));
      const resp = await fetch("/api/ajuste-estoque/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          filialCod,
          modo,
          nomeContagem: nomeContagem.trim(),
          dataContagem,
          obs: obs.trim() || null,
          itens,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErro(data?.error ?? "Erro ao executar ajuste.");
        setConfirmando(false);
        return;
      }
      setResultado({
        nomeContagem: data.nomeContagem,
        itensAjustados: data.itensAjustados,
        somaDelta: data.somaDelta,
        semDiferenca: data.semDiferenca,
      });
      setConfirmando(false);
      setPreview(null);
      fetchRecentes();
    } catch {
      setErro("Erro de conexão ao executar ajuste.");
    } finally {
      setExecutando(false);
      setConfirmCheck(false);
    }
  }, [preview, linhasComDiferenca, username, filialCod, modo, nomeContagem, dataContagem, obs, fetchRecentes]);

  const podeCalcular = !!filialCod && (modo === "zerar" || !!arquivoTexto.trim());
  const podeConfirmar =
    !!preview && linhasComDiferenca.length > 0 && !!nomeContagem.trim() && nomeContagem.length <= 25;

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Ajuste de Estoque</h1>
        <p className={styles.subtitle}>
          Ajuste registrado de estoque — {companyName}. Cria uma contagem nativa no Linx
          (aparece no extrato do produto, com descrição, responsável e histórico). Por
          inventário (arquivo) ou zerando a filial.
        </p>
      </header>

      {/* ── Configuração ── */}
      <section className={styles.card}>
        <div className={styles.modoTabs}>
          <button
            type="button"
            className={`${styles.modoTab} ${modo === "inventario" ? styles.modoTabAtivo : ""}`}
            onClick={() => setModo("inventario")}
          >
            📋 Inventário (arquivo)
          </button>
          <button
            type="button"
            className={`${styles.modoTab} ${modo === "zerar" ? styles.modoTabAtivo : ""}`}
            onClick={() => setModo("zerar")}
          >
            🧹 Zerar filial
          </button>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.label}>Filial</span>
            <select
              className={styles.input}
              value={filialCod}
              onChange={(e) => setFilialCod(e.target.value)}
              disabled={carregandoFiliais}
            >
              <option value="">{carregandoFiliais ? "Carregando…" : "Selecione…"}</option>
              <optgroup label="Filiais ativas (venda recente)">
                {filiais.ativas.map((f) => (
                  <option key={f.cod} value={f.cod}>
                    {f.nome} ({f.cod}) — {f.estoquePositivo.toLocaleString("pt-BR")} un
                  </option>
                ))}
              </optgroup>
              {filiais.inativas.length > 0 && (
                <optgroup label="Filiais não utilizadas (todas)">
                  {filiais.inativas.map((f) => (
                    <option key={f.cod} value={f.cod}>
                      {f.nome} ({f.cod}) — {f.estoquePositivo.toLocaleString("pt-BR")} un
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Data da contagem (início do dia)</span>
            <input
              type="date"
              className={styles.input}
              value={dataContagem}
              onChange={(e) => setDataContagem(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>
              Descrição (extrato) <span className={styles.hint}>{nomeContagem.length}/25</span>
            </span>
            <input
              type="text"
              className={styles.input}
              value={nomeContagem}
              maxLength={25}
              placeholder="Ex.: INVENTLEBLON2506"
              onChange={(e) => {
                setNomeContagem(e.target.value.toUpperCase());
                setNomeEditado(true);
              }}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Responsável</span>
            <input className={styles.input} value={username || "—"} disabled readOnly />
          </label>
        </div>

        {modo === "inventario" && (
          <div className={styles.uploadRow}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,text/plain"
              className={styles.fileInput}
              onChange={(e) => handleArquivo(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              Selecionar arquivo de inventário
            </button>
            {arquivoNome ? (
              <span className={styles.fileInfo}>
                {arquivoNome} — {arquivoLinhas.toLocaleString("pt-BR")} linhas
              </span>
            ) : (
              <span className={styles.fileHintMuted}>Formato: código;quantidade por linha</span>
            )}
          </div>
        )}

        {modo === "inventario" && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={zerarNaoContados}
              onChange={(e) => setZerarNaoContados(e.target.checked)}
            />
            Inventário completo: zerar itens em estoque que <strong>não</strong> estão no arquivo.
            {zerarNaoContados
              ? " (Desmarque se o arquivo é parcial.)"
              : " (Parcial: só ajusta o que está no arquivo.)"}
          </label>
        )}

        <label className={styles.field}>
          <span className={styles.label}>Observação (opcional)</span>
          <textarea
            className={styles.textarea}
            value={obs}
            rows={2}
            placeholder="Observações do ajuste…"
            onChange={(e) => setObs(e.target.value)}
          />
        </label>

        <div className={styles.actionsRow}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={calcular}
            disabled={!podeCalcular || calculando}
          >
            {calculando ? "Calculando…" : "Calcular diferenças"}
          </button>
          {erro && <span className={styles.erro}>{erro}</span>}
        </div>
      </section>

      {/* ── Resultado da execução ── */}
      {resultado && (
        <section className={`${styles.card} ${styles.sucesso}`}>
          <h2 className={styles.sucessoTitle}>✅ Ajuste registrado</h2>
          <p>
            Contagem <strong>{resultado.nomeContagem}</strong> aplicada.{" "}
            <strong>{resultado.itensAjustados}</strong> item(ns) ajustado(s), variação líquida{" "}
            <strong>{resultado.somaDelta > 0 ? "+" : ""}{resultado.somaDelta}</strong> un
            {resultado.semDiferenca > 0 && ` (${resultado.semDiferenca} já batiam)`}.
          </p>
          <p className={styles.fileHintMuted}>
            Já aparece no extrato dos produtos (CONTAGEM/AJUSTE) com sua descrição e responsável.
          </p>
          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => desfazer(resultado.nomeContagem)}
              disabled={estornandoNome === resultado.nomeContagem}
            >
              {estornandoNome === resultado.nomeContagem ? "Desfazendo…" : "↩ Desfazer este ajuste"}
            </button>
          </div>
        </section>
      )}

      {estornoMsg && (
        <section className={`${styles.card} ${styles.sucesso}`}>
          <p style={{ margin: 0 }}>↩ {estornoMsg}</p>
        </section>
      )}

      {/* ── Preview ── */}
      {preview && (
        <section className={styles.card}>
          <div className={styles.totaisBar}>
            <div className={`${styles.totalBox} ${styles.totalBoxDestaque}`}>
              <span className={styles.totalLabel}>Saldo atual (total)</span>
              <span className={styles.totalValor}>
                {preview.totais.saldoAtualTotal.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className={`${styles.totalBox} ${styles.totalBoxDestaque}`}>
              <span className={styles.totalLabel}>Saldo final (após ajuste)</span>
              <span className={`${styles.totalValor} ${styles.final}`}>
                {preview.totais.saldoFinalTotal.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Variação líquida</span>
              <span
                className={`${styles.totalValor} ${
                  preview.totais.somaDelta < 0 ? styles.neg : styles.pos
                }`}
              >
                {preview.totais.somaDelta > 0 ? "+" : ""}
                {preview.totais.somaDelta.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Itens no escopo</span>
              <span className={styles.totalValor}>{preview.totais.itens.toLocaleString("pt-BR")}</span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Com diferença</span>
              <span className={styles.totalValor}>{preview.totais.comDiferenca.toLocaleString("pt-BR")}</span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Entradas (+)</span>
              <span className={`${styles.totalValor} ${styles.pos}`}>{preview.totais.positivos}</span>
            </div>
            <div className={styles.totalBox}>
              <span className={styles.totalLabel}>Saídas (−)</span>
              <span className={`${styles.totalValor} ${styles.neg}`}>{preview.totais.negativos}</span>
            </div>
          </div>

          {preview.totais.itensSaldoNegativo > 0 && (
            <p className={styles.fileHintMuted}>
              ℹ {preview.totais.itensSaldoNegativo} item(ns) têm saldo negativo no escopo — por
              isso a variação líquida ({preview.totais.somaDelta > 0 ? "+" : ""}
              {preview.totais.somaDelta}) difere do estoque positivo da filial. Após o ajuste o
              saldo final total fica <strong>{preview.totais.saldoFinalTotal.toLocaleString("pt-BR")}</strong>.
            </p>
          )}

          {(preview.naoEncontrados.length > 0 ||
            preview.ambiguos.length > 0 ||
            preview.invalidas.length > 0) && (
            <div className={styles.avisos}>
              {preview.naoEncontrados.length > 0 && (
                <span className={styles.aviso}>
                  ⚠ {preview.naoEncontrados.length} código(s) não encontrado(s):{" "}
                  {preview.naoEncontrados.slice(0, 12).join(", ")}
                  {preview.naoEncontrados.length > 12 ? "…" : ""}
                </span>
              )}
              {preview.ambiguos.length > 0 && (
                <span className={styles.aviso}>
                  ⚠ {preview.ambiguos.length} código(s) ambíguo(s) (ignorado(s)):{" "}
                  {preview.ambiguos.slice(0, 12).join(", ")}
                  {preview.ambiguos.length > 12 ? "…" : ""}
                </span>
              )}
              {preview.invalidas.length > 0 && (
                <span className={styles.aviso}>
                  ⚠ {preview.invalidas.length} linha(s) inválida(s) no arquivo.
                </span>
              )}
            </div>
          )}

          <div className={styles.tableHeaderRow}>
            <h2 className={styles.cardTitle}>Diferenças</h2>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={mostrarTodos}
                onChange={(e) => setMostrarTodos(e.target.checked)}
              />
              Mostrar itens sem diferença
            </label>
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Descrição</th>
                  <th>Cor</th>
                  <th className={styles.num}>Saldo atual</th>
                  <th className={styles.num}>Diferença</th>
                  <th className={styles.num}>Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {linhasExibidas.slice(0, 1000).map((l) => (
                  <tr key={`${l.produto}|${l.cor}`} className={l.delta !== 0 ? styles.rowDiff : ""}>
                    <td className={styles.mono}>{l.produto}</td>
                    <td>{l.descProduto}</td>
                    <td>{l.descCor || l.cor}</td>
                    <td className={styles.num}>{l.saldo}</td>
                    <td
                      className={`${styles.num} ${
                        l.delta < 0 ? styles.neg : l.delta > 0 ? styles.pos : ""
                      }`}
                    >
                      {l.delta > 0 ? "+" : ""}
                      {l.delta}
                    </td>
                    <td className={`${styles.num} ${styles.final}`}>{l.contagem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {linhasExibidas.length > 1000 && (
              <p className={styles.fileHintMuted}>
                Mostrando 1000 de {linhasExibidas.length.toLocaleString("pt-BR")} linhas. O ajuste
                aplica todas.
              </p>
            )}
          </div>

          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={() => {
                setConfirmCheck(false);
                setConfirmando(true);
              }}
              disabled={!podeConfirmar}
            >
              Ajustar estoque ({linhasComDiferenca.length} itens)
            </button>
          </div>
        </section>
      )}

      {/* ── Desfazer ajustes recentes ── */}
      {recentes.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Desfazer ajustes recentes</h2>
          <p className={styles.fileHintMuted}>
            Seus ajustes dos últimos 7 dias. Desfazer cria um estorno (ajuste inverso) registrado.
          </p>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Filial</th>
                  <th>Data</th>
                  <th className={styles.num}>Itens</th>
                  <th className={styles.num}>Variação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentes.map((r) => (
                  <tr key={r.nome}>
                    <td className={styles.mono}>{r.nome}</td>
                    <td>{r.filial}</td>
                    <td>{r.emissao ? new Date(r.emissao).toLocaleDateString("pt-BR") : "—"}</td>
                    <td className={styles.num}>{r.itens}</td>
                    <td className={`${styles.num} ${r.soma < 0 ? styles.neg : styles.pos}`}>
                      {r.soma > 0 ? "+" : ""}
                      {r.soma}
                    </td>
                    <td className={styles.num}>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => desfazer(r.nome)}
                        disabled={estornandoNome === r.nome}
                      >
                        {estornandoNome === r.nome ? "Desfazendo…" : "↩ Desfazer"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Modal de confirmação ── */}
      {confirmando && preview && (
        <div className={styles.modalOverlay} onClick={() => !executando && setConfirmando(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>
              {modo === "zerar" ? "Zerar estoque da filial" : "Confirmar ajuste de inventário"}
            </h2>
            <p className={styles.modalText}>
              Filial: <strong>{preview.filialNome}</strong>
              <br />
              Descrição: <strong>{nomeContagem}</strong>
              <br />
              Itens a ajustar: <strong>{linhasComDiferenca.length}</strong> · Variação líquida:{" "}
              <strong>
                {preview.totais.somaDelta > 0 ? "+" : ""}
                {preview.totais.somaDelta}
              </strong>{" "}
              un
              <br />
              Saldo final (total) após o ajuste:{" "}
              <strong>{preview.totais.saldoFinalTotal.toLocaleString("pt-BR")}</strong> un
            </p>
            <p className={styles.modalWarn}>
              Altera o estoque real no Linx e registra no extrato. Dá pra desfazer depois.
            </p>
            <label className={styles.confirmCheck}>
              <input
                type="checkbox"
                checked={confirmCheck}
                onChange={(e) => setConfirmCheck(e.target.checked)}
              />
              Confirmo que revisei as diferenças e desejo aplicar o ajuste.
            </label>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setConfirmando(false)}
                disabled={executando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={executar}
                disabled={!confirmCheck || executando}
              >
                {executando ? "Aplicando…" : "Aplicar ajuste"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
