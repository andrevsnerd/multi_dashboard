"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import { getCompraCicloRuntime, setCompraCicloRuntime } from "@/lib/config/compra-ciclo";
import {
  LIMITES,
  clonarConfigCiclo,
  novoRegraId,
  type CicloRegra,
  type CompraCicloConfig,
  type CompraCicloPreset,
} from "@/lib/config/compra-ciclo-tipos";

import styles from "./CompraCicloPage.module.css";

interface Props {
  companyKey: "nerd" | "scarfme";
  companyName: string;
}

interface RespostaGet {
  config: CompraCicloConfig;
  fabrica: CompraCicloConfig;
  presets: CompraCicloPreset[];
  podeEditar: boolean;
  error?: string;
}

function mesmoConteudo(a: CompraCicloConfig | null, b: CompraCicloConfig | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function CompraCicloPage({ companyKey, companyName }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [config, setConfig] = useState<CompraCicloConfig | null>(null);
  /** Última config confirmada pelo servidor — base do "tem alteração não salva". */
  const [salva, setSalva] = useState<CompraCicloConfig | null>(null);
  const [fabrica, setFabrica] = useState<CompraCicloConfig | null>(null);
  const [presets, setPresets] = useState<CompraCicloPreset[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const [presetId, setPresetId] = useState("");
  const [presetNome, setPresetNome] = useState("");
  const [criandoPreset, setCriandoPreset] = useState(false);

  const dirty = !!config && !mesmoConteudo(config, salva);

  /* ───────────────────────────── carga ───────────────────────────── */

  useEffect(() => {
    if (!username) return;
    let cancelado = false;

    setCarregando(true);
    setErro("");
    fetch(`/api/compra-ciclo?company=${encodeURIComponent(companyKey)}`, {
      headers: { "x-auth-username": username },
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json()) as RespostaGet;
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar a configuração.");
        return json;
      })
      .then((json) => {
        if (cancelado) return;
        setConfig(clonarConfigCiclo(json.config));
        setSalva(clonarConfigCiclo(json.config));
        setFabrica(clonarConfigCiclo(json.fabrica));
        setPresets(json.presets ?? []);
        setPodeEditar(!!json.podeEditar);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Erro ao carregar.");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [companyKey, username]);

  /* ─────────────────────────── mutações ──────────────────────────── */

  const patch = useCallback((mudanca: Partial<CompraCicloConfig>) => {
    setAviso("");
    setConfig((prev) => (prev ? { ...prev, ...mudanca } : prev));
  }, []);

  const patchRegra = useCallback((indice: number, mudanca: Partial<CicloRegra>) => {
    setAviso("");
    setConfig((prev) => {
      if (!prev) return prev;
      const regras = prev.regras.map((r, i) => (i === indice ? { ...r, ...mudanca } : r));
      return { ...prev, regras };
    });
  }, []);

  const moverRegra = useCallback((indice: number, direcao: -1 | 1) => {
    setAviso("");
    setConfig((prev) => {
      if (!prev) return prev;
      const destino = indice + direcao;
      if (destino < 0 || destino >= prev.regras.length) return prev;
      const regras = [...prev.regras];
      [regras[indice], regras[destino]] = [regras[destino], regras[indice]];
      return { ...prev, regras };
    });
  }, []);

  const removerRegra = useCallback((indice: number) => {
    setAviso("");
    setConfig((prev) =>
      prev ? { ...prev, regras: prev.regras.filter((_, i) => i !== indice) } : prev
    );
  }, []);

  const adicionarRegra = useCallback(() => {
    setAviso("");
    setConfig((prev) => {
      if (!prev) return prev;
      const nova: CicloRegra = {
        id: novoRegraId(),
        grupo: "",
        campo: "linha",
        modo: "igual",
        valor: "",
        coberturaDias: prev.padrao.coberturaDias,
        producaoDias: prev.padrao.producaoDias,
      };
      return { ...prev, regras: [...prev.regras, nova] };
    });
  }, []);

  /** Espelha a config salva no global da aba, para navegar já vendo os prazos novos. */
  const publicarNoRuntime = useCallback(
    (nova: CompraCicloConfig) => {
      const atual = getCompraCicloRuntime() ?? {};
      setCompraCicloRuntime({ ...atual, [companyKey]: nova });
    },
    [companyKey]
  );

  const salvar = useCallback(async () => {
    if (!config) return;
    const invalida = config.regras.find((r) => !r.valor.trim() || !r.grupo.trim());
    if (invalida) {
      setErro("Toda faixa precisa de um nome de grupo e de um valor para casar.");
      return;
    }

    setSalvando(true);
    setErro("");
    setAviso("");
    try {
      const res = await fetch("/api/compra-ciclo", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, config }),
      });
      const json = (await res.json()) as { config?: CompraCicloConfig; error?: string };
      if (!res.ok || !json.config) throw new Error(json.error ?? "Erro ao salvar.");
      setConfig(clonarConfigCiclo(json.config));
      setSalva(clonarConfigCiclo(json.config));
      publicarNoRuntime(json.config);
      setAviso("Prazos salvos. Já valem para a Compra Ideal de todas as telas.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }, [companyKey, config, publicarNoRuntime, username]);

  const voltarAoPadrao = useCallback(async () => {
    if (!window.confirm(`Voltar ${companyName} para os prazos de fábrica? A config salva é apagada.`)) {
      return;
    }
    setSalvando(true);
    setErro("");
    setAviso("");
    try {
      const res = await fetch("/api/compra-ciclo", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, resetar: true }),
      });
      const json = (await res.json()) as { config?: CompraCicloConfig; error?: string };
      if (!res.ok || !json.config) throw new Error(json.error ?? "Erro ao restaurar.");
      setConfig(clonarConfigCiclo(json.config));
      setSalva(clonarConfigCiclo(json.config));
      publicarNoRuntime(json.config);
      setAviso("Voltou para os prazos de fábrica.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao restaurar.");
    } finally {
      setSalvando(false);
    }
  }, [companyKey, companyName, publicarNoRuntime, username]);

  /* ─────────────────────────── presets ───────────────────────────── */

  const presetSelecionado = useMemo(
    () => presets.find((p) => p.id === presetId) ?? null,
    [presetId, presets]
  );

  const aplicarPreset = useCallback(() => {
    if (!presetSelecionado) return;
    setErro("");
    setConfig(clonarConfigCiclo(presetSelecionado.config));
    setAviso(`Preset "${presetSelecionado.nome}" carregado. Confira e clique em Salvar.`);
  }, [presetSelecionado]);

  const criarPreset = useCallback(async () => {
    if (!config) return;
    const nome = presetNome.trim();
    if (!nome) {
      setErro("Dê um nome ao preset.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/compra-ciclo/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, nome, config }),
      });
      const json = (await res.json()) as {
        preset?: CompraCicloPreset;
        presets?: CompraCicloPreset[];
        error?: string;
      };
      if (!res.ok || !json.presets) throw new Error(json.error ?? "Erro ao salvar o preset.");
      setPresets(json.presets);
      setPresetId(json.preset?.id ?? "");
      setPresetNome("");
      setCriandoPreset(false);
      setAviso(`Preset "${nome}" criado.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar o preset.");
    } finally {
      setSalvando(false);
    }
  }, [companyKey, config, presetNome, username]);

  const excluirPreset = useCallback(async () => {
    if (!presetSelecionado || presetSelecionado.builtin) return;
    if (!window.confirm(`Excluir o preset "${presetSelecionado.nome}"?`)) return;
    setSalvando(true);
    setErro("");
    try {
      const params = new URLSearchParams({ company: companyKey, id: presetSelecionado.id });
      const res = await fetch(`/api/compra-ciclo/presets?${params.toString()}`, {
        method: "DELETE",
        headers: { "x-auth-username": username },
      });
      const json = (await res.json()) as { presets?: CompraCicloPreset[]; error?: string };
      if (!res.ok || !json.presets) throw new Error(json.error ?? "Erro ao excluir o preset.");
      setPresets(json.presets);
      setPresetId("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao excluir o preset.");
    } finally {
      setSalvando(false);
    }
  }, [companyKey, presetSelecionado, username]);

  /* ─────────────────────────── render ────────────────────────────── */

  const igualAoFabrica = mesmoConteudo(config, fabrica);

  if (carregando) {
    return <div className={styles.estado}>Carregando os prazos…</div>;
  }
  if (!config) {
    return <div className={styles.estadoErro}>{erro || "Não foi possível carregar a configuração."}</div>;
  }

  const travado = !podeEditar || salvando;

  return (
    <div className={styles.wrapper}>
      {/* ── cabeçalho ─────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.titulo}>Ciclo de Compra</h1>
          <p className={styles.subtitulo}>
            Os prazos que a <strong>Compra Ideal</strong> usa em {companyName}: quantos dias de venda
            uma remessa precisa cobrir e quantos dias ela leva para chegar. Mexer aqui muda a
            quantidade sugerida e a data de compra de todas as telas.
          </p>
        </div>
        <div className={styles.acoes}>
          {dirty && <span className={styles.dirtyTag}>alterações não salvas</span>}
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => setConfig(salva ? clonarConfigCiclo(salva) : config)}
            disabled={travado || !dirty}
          >
            Descartar
          </button>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={voltarAoPadrao}
            disabled={travado || igualAoFabrica}
            title="Apaga a config salva e volta aos prazos de fábrica"
          >
            Padrão de fábrica
          </button>
          <button type="button" className={styles.btnPrimary} onClick={salvar} disabled={travado || !dirty}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </header>

      {!podeEditar && (
        <div className={styles.faixaInfo}>
          Sua função é somente leitura: dá pra conferir os prazos, mas não alterar.
        </div>
      )}
      {erro && <div className={styles.faixaErro}>{erro}</div>}
      {aviso && <div className={styles.faixaOk}>{aviso}</div>}

      {/* ── explicação ────────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitulo}>Como os dois prazos entram na conta</h2>
        <div className={styles.explica}>
          <div>
            <span className={styles.explicaChave}>Cobertura</span>
            <p>
              Por quantos dias de venda uma remessa deve durar. É a <em>quantidade</em>:
              consumo/dia × cobertura, descontando o que ainda sobra quando a remessa chega.
            </p>
          </div>
          <div>
            <span className={styles.explicaChave}>Produção (lead time)</span>
            <p>
              Dias entre fazer a compra e a peça estar vendendo no PDV. É a <em>data</em>:
              (dia em que estoque + trânsito acaba) − produção. Data no passado ⇒ comprar agora.
            </p>
          </div>
          <div>
            <span className={styles.explicaChave}>Alvo total</span>
            <p>
              Cobertura + produção. Posição (estoque + trânsito) acima de 2× o alvo cai em
              <strong> Excesso</strong>.
            </p>
          </div>
        </div>
      </section>

      {/* ── presets ───────────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitulo}>Presets</h2>
        <p className={styles.cardSub}>
          Conjuntos prontos de prazos de {companyName}. Aplicar só preenche a tabela abaixo — os
          números novos só valem depois de <strong>Salvar</strong>.
        </p>

        <div className={styles.presetBarra}>
          <select
            className={styles.select}
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            disabled={travado}
          >
            <option value="">Escolha um preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
                {p.builtin ? " (fábrica)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={aplicarPreset}
            disabled={travado || !presetSelecionado}
          >
            Aplicar
          </button>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={excluirPreset}
            disabled={travado || !presetSelecionado || presetSelecionado.builtin}
            title="Só presets criados aqui podem ser excluídos"
          >
            Excluir
          </button>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => setCriandoPreset((v) => !v)}
            disabled={travado}
          >
            {criandoPreset ? "Cancelar" : "Salvar config atual como preset"}
          </button>
        </div>

        {presetSelecionado?.descricao && (
          <p className={styles.presetDesc}>{presetSelecionado.descricao}</p>
        )}

        {criandoPreset && (
          <div className={styles.presetForm}>
            <input
              className={styles.input}
              placeholder="Nome do preset (ex.: Verão 2027)"
              value={presetNome}
              onChange={(e) => setPresetNome(e.target.value)}
              maxLength={60}
            />
            <button type="button" className={styles.btnPrimary} onClick={criarPreset} disabled={travado}>
              Criar preset
            </button>
          </div>
        )}
      </section>

      {/* ── tabela de faixas ──────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2 className={styles.cardTitulo}>Prazos por linha / subgrupo</h2>
            <p className={styles.cardSub}>
              A <strong>ordem é a precedência</strong>: a primeira faixa que casa vence. É o que faz o
              material mandar — deixe SEDA acima das faixas por linha e um lenço de seda cai em Seda,
              não em Lenços.
            </p>
          </div>
          <button type="button" className={styles.btnGhost} onClick={adicionarRegra} disabled={travado}>
            + Adicionar faixa
          </button>
        </div>

        <div className={styles.tabelaScroll}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th className={styles.colOrdem}>#</th>
                <th>Grupo</th>
                <th colSpan={3}>Casa quando</th>
                <th className={styles.colNum}>Cobertura</th>
                <th className={styles.colNum}>Produção</th>
                <th className={styles.colNum}>Alvo total</th>
                <th className={styles.colAcoes} />
              </tr>
            </thead>
            <tbody>
              {config.regras.map((r, i) => (
                <tr key={r.id}>
                  <td className={styles.colOrdem}>{i + 1}</td>
                  <td>
                    <input
                      className={styles.input}
                      value={r.grupo}
                      onChange={(e) => patchRegra(i, { grupo: e.target.value })}
                      placeholder="Seda"
                      disabled={travado}
                    />
                  </td>
                  <td>
                    <select
                      className={styles.select}
                      value={r.campo}
                      onChange={(e) => patchRegra(i, { campo: e.target.value as CicloRegra["campo"] })}
                      disabled={travado}
                    >
                      <option value="linha">Linha</option>
                      <option value="subgrupo">Subgrupo</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.select}
                      value={r.modo}
                      onChange={(e) => patchRegra(i, { modo: e.target.value as CicloRegra["modo"] })}
                      disabled={travado}
                    >
                      <option value="igual">é igual a</option>
                      <option value="contem">contém</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className={styles.input}
                      value={r.valor}
                      onChange={(e) => patchRegra(i, { valor: e.target.value })}
                      placeholder="SEDA"
                      disabled={travado}
                    />
                  </td>
                  <td className={styles.colNum}>
                    <input
                      type="number"
                      className={styles.inputNum}
                      value={r.coberturaDias}
                      min={LIMITES.coberturaMin}
                      max={LIMITES.coberturaMax}
                      onChange={(e) => patchRegra(i, { coberturaDias: Number(e.target.value) })}
                      disabled={travado}
                    />
                  </td>
                  <td className={styles.colNum}>
                    <input
                      type="number"
                      className={styles.inputNum}
                      value={r.producaoDias}
                      min={LIMITES.producaoMin}
                      max={LIMITES.producaoMax}
                      onChange={(e) => patchRegra(i, { producaoDias: Number(e.target.value) })}
                      disabled={travado}
                    />
                  </td>
                  <td className={`${styles.colNum} ${styles.alvo}`}>{r.coberturaDias + r.producaoDias} d</td>
                  <td className={styles.colAcoes}>
                    <button
                      type="button"
                      className={styles.btnIcone}
                      onClick={() => moverRegra(i, -1)}
                      disabled={travado || i === 0}
                      title="Subir (ganha precedência)"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.btnIcone}
                      onClick={() => moverRegra(i, 1)}
                      disabled={travado || i === config.regras.length - 1}
                      title="Descer"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={`${styles.btnIcone} ${styles.btnIconeRemover}`}
                      onClick={() => removerRegra(i)}
                      disabled={travado}
                      title="Remover faixa"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}

              {/* Padrão: quem não casou com nenhuma faixa. Não some e não sai do lugar. */}
              <tr className={styles.linhaPadrao}>
                <td className={styles.colOrdem}>—</td>
                <td>
                  <input
                    className={styles.input}
                    value={config.padrao.grupo}
                    onChange={(e) => patch({ padrao: { ...config.padrao, grupo: e.target.value } })}
                    disabled={travado}
                  />
                </td>
                <td colSpan={3} className={styles.padraoTexto}>
                  nenhuma faixa acima casou
                </td>
                <td className={styles.colNum}>
                  <input
                    type="number"
                    className={styles.inputNum}
                    value={config.padrao.coberturaDias}
                    min={LIMITES.coberturaMin}
                    max={LIMITES.coberturaMax}
                    onChange={(e) =>
                      patch({ padrao: { ...config.padrao, coberturaDias: Number(e.target.value) } })
                    }
                    disabled={travado}
                  />
                </td>
                <td className={styles.colNum}>
                  <input
                    type="number"
                    className={styles.inputNum}
                    value={config.padrao.producaoDias}
                    min={LIMITES.producaoMin}
                    max={LIMITES.producaoMax}
                    onChange={(e) =>
                      patch({ padrao: { ...config.padrao, producaoDias: Number(e.target.value) } })
                    }
                    disabled={travado}
                  />
                </td>
                <td className={`${styles.colNum} ${styles.alvo}`}>
                  {config.padrao.coberturaDias + config.padrao.producaoDias} d
                </td>
                <td className={styles.colAcoes} />
              </tr>
            </tbody>
          </table>
        </div>

        {config.regras.length === 0 && (
          <p className={styles.vazio}>Sem faixa por categoria: todo item usa o padrão acima.</p>
        )}
      </section>
    </div>
  );
}
