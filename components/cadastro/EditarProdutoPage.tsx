"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";

import BuscaProdutoCadastro from "./BuscaProdutoCadastro";
import CadastroHistorico from "./CadastroHistorico";
import FichaProdutoEditor from "./FichaProdutoEditor";
import styles from "./AlterarCadastroPage.module.css";
import type { CampoProdutoDef, CompanyKey, OpcoesDimensoes } from "./types";

interface Props {
  companyKey: CompanyKey;
}

/**
 * Editar Produto: acha um produto já cadastrado (nome, código ou barra) e
 * edita a ficha. Mesma whitelist de campos, gravação e histórico do
 * Alterar Cadastro — esta tela é só a porta de entrada direta para isso.
 */
export default function EditarProdutoPage({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [codigo, setCodigo] = useState("");
  const [podeExecutar, setPodeExecutar] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcoesDimensoes | null>(null);
  const [campos, setCampos] = useState<CampoProdutoDef[]>([]);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(true);
  const [historicoVersao, setHistoricoVersao] = useState(0);

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
  }, [companyKey, username]);

  const avisarGravou = useCallback(() => setHistoricoVersao((v) => v + 1), []);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Editar Produto</h1>
        <p className={styles.subtitulo}>
          Encontre um produto já cadastrado, altere a ficha e grave no Linx. Toda gravação fica no
          histórico abaixo e pode ser estornada.
        </p>
        {!podeExecutar && !carregandoOpcoes && !erroOpcoes && (
          <div className={styles.avisoTopo}>
            Seu perfil é somente leitura: dá para consultar a ficha, mas não para gravar.
          </div>
        )}
      </header>

      {erroOpcoes && <div className={styles.erroBox}>{erroOpcoes}</div>}

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
        onGravou={avisarGravou}
        recarregarEm={historicoVersao}
      />

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
