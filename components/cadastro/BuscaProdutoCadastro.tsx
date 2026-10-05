"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./BuscaProdutoCadastro.module.css";
import type { CompanyKey } from "./types";

export interface ProdutoBusca {
  produto: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  griffe: string;
  inativo: boolean;
  outraEmpresa: boolean;
  codigoBarra: string | null;
  palavras: number;
  totalPalavras: number;
}

interface Props {
  companyKey: CompanyKey;
  username: string;
  /** Produto escolhido — ou o termo cru, quando o Enter chega antes das sugestões (leitor). */
  onEscolher: (codigo: string) => void;
  selecionado?: string | null;
}

const ESPERA_MS = 250;

/** Maiúscula sem acento, caractere a caractere (mantém os índices do texto original). */
function normalizar(texto: string): string {
  return Array.from(texto)
    .map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().charAt(0) || c)
    .join("");
}

/** Destaca no nome as palavras digitadas (sem acento e sem caixa). */
function destacar(texto: string, termo: string): ReactNode {
  const palavras = termo
    .split(/\s+/)
    .filter((p) => p.length >= 2)
    .map(normalizar);
  if (palavras.length === 0) return texto;

  const base = normalizar(texto);
  const marcado = new Array<boolean>(texto.length).fill(false);
  for (const p of palavras) {
    let i = base.indexOf(p);
    while (i >= 0) {
      for (let k = i; k < i + p.length; k += 1) marcado[k] = true;
      i = base.indexOf(p, i + p.length);
    }
  }

  const partes: ReactNode[] = [];
  let inicio = 0;
  for (let i = 1; i <= texto.length; i += 1) {
    if (i === texto.length || marcado[i] !== marcado[inicio]) {
      const pedaco = texto.slice(inicio, i);
      partes.push(marcado[inicio] ? <mark key={inicio}>{pedaco}</mark> : pedaco);
      inicio = i;
    }
  }
  return partes;
}

/**
 * Campo único que acha produto por nome (qualquer palavra, mais parecidos
 * primeiro), código do produto ou código de barras, mostrando as sugestões
 * enquanto digita. Setas + Enter escolhem; Esc fecha.
 */
export default function BuscaProdutoCadastro({ companyKey, username, onEscolher, selecionado }: Props) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ProdutoBusca[]>([]);
  const [termoDosResultados, setTermoDosResultados] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const listaRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const t = termo.trim();
    if (!username || t.length < 2) {
      setResultados([]);
      setTermoDosResultados("");
      setBuscando(false);
      setErro(null);
      return;
    }

    const controle = new AbortController();
    setBuscando(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ company: companyKey, q: t });
        const res = await fetch(`/api/cadastro/busca?${params}`, {
          headers: { "x-auth-username": username },
          cache: "no-store",
          signal: controle.signal,
        });
        const json = await res.json();
        if (controle.signal.aborted) return;
        if (!res.ok) {
          setErro(json?.error ?? "Erro ao buscar produtos.");
          setResultados([]);
        } else {
          setErro(null);
          setResultados((json.produtos ?? []) as ProdutoBusca[]);
        }
        setTermoDosResultados(t);
        setAtivo(0);
      } catch {
        if (!controle.signal.aborted) setErro("Falha de conexão ao buscar produtos.");
      } finally {
        if (!controle.signal.aborted) setBuscando(false);
      }
    }, ESPERA_MS);

    return () => {
      clearTimeout(timer);
      controle.abort();
    };
  }, [termo, companyKey, username]);

  // Mantém o item destacado visível ao navegar com as setas.
  useEffect(() => {
    const item = listaRef.current?.children[ativo] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  const escolher = (produto: string) => {
    onEscolher(produto);
    setAberto(false);
  };

  const resultadosValidos = termoDosResultados === termo.trim();

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAberto(true);
      setAtivo((i) => Math.min(i + 1, Math.max(resultados.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setAberto(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = termo.trim();
      if (!t) return;
      if (resultadosValidos && resultados[ativo]) {
        escolher(resultados[ativo].produto);
      } else if (!resultadosValidos) {
        // Leitor de código de barras dispara o Enter antes da sugestão chegar:
        // a ficha resolve código ou barra direto.
        escolher(t);
      }
    }
  };

  const mostrarLista = aberto && termo.trim().length >= 2;

  return (
    <section className={styles.card}>
      <label className={styles.rotulo} htmlFor="busca-produto-cadastro">
        Encontrar produto
      </label>
      <div className={styles.caixa}>
        <input
          id="busca-produto-cadastro"
          className={styles.input}
          value={termo}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Nome, código do produto ou código de barras"
          onChange={(e) => {
            setTermo(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          onKeyDown={aoTeclar}
          role="combobox"
          aria-expanded={mostrarLista}
          aria-controls="busca-produto-cadastro-lista"
        />
        {buscando && <span className={styles.spinner} aria-label="Buscando" />}

        {mostrarLista && (
          <div className={styles.painel}>
            {erro ? (
              <div className={styles.vazio}>{erro}</div>
            ) : resultadosValidos && resultados.length === 0 && !buscando ? (
              <div className={styles.vazio}>Nenhum produto com “{termo.trim()}”.</div>
            ) : (
              <ul id="busca-produto-cadastro-lista" ref={listaRef} className={styles.lista} role="listbox">
                {resultados.map((r, i) => (
                  <li
                    key={r.produto}
                    role="option"
                    aria-selected={i === ativo}
                    className={`${styles.item} ${i === ativo ? styles.itemAtivo : ""} ${
                      r.produto === selecionado ? styles.itemSelecionado : ""
                    }`}
                    onMouseEnter={() => setAtivo(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      escolher(r.produto);
                    }}
                  >
                    <div className={styles.linha1}>
                      <span className={styles.codigo}>{r.produto}</span>
                      <span className={styles.desc}>{destacar(r.descricao || "—", termoDosResultados)}</span>
                    </div>
                    <div className={styles.linha2}>
                      <span>
                        {[r.grupo, r.subgrupo, r.linha].filter(Boolean).join(" · ") || "sem classificação"}
                      </span>
                      {r.codigoBarra && <span className={styles.tagBarra}>barra {r.codigoBarra}</span>}
                      {r.totalPalavras > 1 && r.palavras > 0 && r.palavras < r.totalPalavras && (
                        <span className={styles.tag}>
                          {r.palavras} de {r.totalPalavras} palavras
                        </span>
                      )}
                      {r.inativo && <span className={styles.tagInativo}>inativo</span>}
                      {r.outraEmpresa && <span className={styles.tag}>outra empresa</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <span className={styles.dica}>
        Basta uma palavra do nome — os mais parecidos aparecem primeiro. Código de barras: bipe ou cole e
        tecle Enter.
      </span>
    </section>
  );
}
