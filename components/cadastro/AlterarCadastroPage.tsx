"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";

import AbaDimensoes from "./AbaDimensoes";
import BuscaProdutoCadastro from "./BuscaProdutoCadastro";
import CadastroHistorico from "./CadastroHistorico";
import FichaProdutoEditor from "./FichaProdutoEditor";
import styles from "./AlterarCadastroPage.module.css";
import type { CampoProdutoDef, CompanyKey, DimensaoMeta, OpcoesDimensoes } from "./types";

interface Props {
  companyKey: CompanyKey;
}

type Aba = "dimensoes" | "produto";

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
          recarregarEm={historicoVersao}
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

// ═══════════════════════════ ABA 2 — PRODUTO ═══════════════════════════

interface AbaProdutoProps {
  companyKey: CompanyKey;
  username: string;
  podeExecutar: boolean;
  campos: CampoProdutoDef[];
  opcoes: OpcoesDimensoes | null;
  onGravou: () => void;
  recarregarEm: number;
}

function AbaProduto({ companyKey, username, podeExecutar, campos, opcoes, onGravou, recarregarEm }: AbaProdutoProps) {
  const [codigo, setCodigo] = useState("");

  return (
    <>
      <BuscaProdutoCadastro
        companyKey={companyKey}
        username={username}
        onEscolher={setCodigo}
        selecionado={codigo}
      />
      <FichaProdutoEditor
        companyKey={companyKey}
        username={username}
        podeExecutar={podeExecutar}
        campos={campos}
        opcoes={opcoes}
        codigo={codigo}
        onGravou={onGravou}
        recarregarEm={recarregarEm}
      />
    </>
  );
}
