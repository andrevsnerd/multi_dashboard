"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/AuthContext";
import styles from "./RomaneioDetalhePage.module.css";

export interface RomaneioDetalheItem {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  subgrupo: string;
  grade: string;
  qtde: number;
  estoqueOrigem: number;
  estoqueDestino: number;
  filialOrigem?: string;
  filialDestino?: string;
  destino?: string;
}

interface FilialOption {
  codFilial: string;
  filial: string;
}

interface RomaneioDetalhePageProps {
  companySlug: string;
  companyName: string;
  romaneioId: string;
  tipo: "saida" | "entrada";
  filialOrigem: string;
  filialDestino: string;
  dataEmissao?: string;
  responsavel?: string;
}

async function fetchDetalhes(
  tipo: "saida" | "entrada",
  romaneio: string,
  filialOrigem: string,
  filialDestino: string
): Promise<RomaneioDetalheItem[]> {
  const params = new URLSearchParams({
    tipo,
    romaneio,
    filialOrigem,
    filialDestino,
  });
  const response = await fetch(`/api/transferencia-produtos/log-detalhes?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: RomaneioDetalheItem[] };
  return json.data || [];
}

async function fetchFiliais(): Promise<FilialOption[]> {
  const response = await fetch("/api/transferencia-produtos/filiais", { cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: FilialOption[] };
  return json.data || [];
}

async function fetchDestinoRomaneio(
  companyKey: string,
  romaneioId: string,
  filialOrigem: string
): Promise<string | null> {
  const res = await fetch(
    `/api/destino-romaneio?company=${encodeURIComponent(companyKey)}&romaneio=${encodeURIComponent(romaneioId)}&filialOrigem=${encodeURIComponent(filialOrigem)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { filialDestino?: string | null };
  return json.filialDestino ?? null;
}

async function saveDestinoRomaneio(
  username: string,
  companyKey: string,
  romaneioId: string,
  filialOrigem: string,
  filialDestino: string
): Promise<boolean> {
  const res = await fetch("/api/destino-romaneio", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify({
      companyKey,
      romaneioId,
      filialOrigem,
      filialDestino,
    }),
  });
  return res.ok;
}

export default function RomaneioDetalhePage({
  companySlug,
  companyName,
  romaneioId,
  tipo,
  filialOrigem,
  filialDestino,
  dataEmissao: dataEmissaoProp = "",
  responsavel: responsavelProp = "",
}: RomaneioDetalhePageProps) {
  const { user } = useAuth();
  const [itens, setItens] = useState<RomaneioDetalheItem[]>([]);
  const [loading, setLoading] = useState(true);
  const dataEmissao = dataEmissaoProp
    ? (() => {
        try {
          return new Date(dataEmissaoProp).toLocaleString("pt-BR");
        } catch {
          return dataEmissaoProp;
        }
      })()
    : "";
  const responsavel = responsavelProp || "";

  const [filiais, setFiliais] = useState<FilialOption[]>([]);
  const [destinoSelected, setDestinoSelected] = useState<string>("");
  const [loadingDestino, setLoadingDestino] = useState(false);
  const canSetDestino =
    !!user &&
    (user.role === "admin" || (user.permissions ?? []).includes("destino-romaneio"));

  const loadDestino = useCallback(() => {
    if (tipo !== "saida") return;
    setLoadingDestino(true);
    fetchDestinoRomaneio(companySlug, romaneioId, filialOrigem)
      .then((val) => setDestinoSelected(val ?? ""))
      .finally(() => setLoadingDestino(false));
  }, [companySlug, romaneioId, filialOrigem, tipo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDetalhes(tipo, romaneioId, filialOrigem, filialDestino).then((data) => {
      if (!cancelled) {
        setItens(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tipo, romaneioId, filialOrigem, filialDestino]);

  useEffect(() => {
    if (tipo === "saida") {
      fetchFiliais().then(setFiliais);
      loadDestino();
    }
  }, [tipo, loadDestino]);

  const handleDestinoChange = useCallback(
    async (codFilial: string) => {
      setDestinoSelected(codFilial);
      if (!user?.username) return;
      await saveDestinoRomaneio(user.username, companySlug, romaneioId, filialOrigem, codFilial);
    },
    [user?.username, companySlug, romaneioId, filialOrigem]
  );

  const destinoDisplay =
    destinoSelected && filiais.length > 0
      ? filiais.find((f) => f.codFilial === destinoSelected)?.filial || destinoSelected
      : null;

  const qtdProdutos = itens.length;
  const qtdItens = itens.reduce((s, i) => s + i.qtde, 0);
  const backHref = `/${companySlug}/romaneios`;
  const transferenciaHref = `/${companySlug}/transferencia-produtos`;

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando detalhes do romaneio...</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <Link href={backHref} className={styles.backLink}>
          ← Voltar
        </Link>
        <h1 className={styles.title}>Romaneio #{romaneioId}</h1>
        <p className={styles.meta}>
          {responsavel || "—"} • {dataEmissao || "—"}
        </p>
      </header>

      {tipo === "saida" && canSetDestino && (
        <div className={styles.destinoSection}>
          <label htmlFor="destino-romaneio-detalhe" className={styles.destinoLabel}>
            Filial destino
          </label>
          <select
            id="destino-romaneio-detalhe"
            className={styles.destinoSelect}
            value={destinoSelected}
            onChange={(e) => handleDestinoChange(e.target.value)}
            disabled={loadingDestino}
          >
            <option value="">Nenhum destino definido</option>
            {filiais.map((f) => (
              <option key={f.codFilial} value={f.codFilial}>
                {f.filial} ({f.codFilial})
              </option>
            ))}
          </select>
        </div>
      )}

      {tipo === "saida" && !canSetDestino && destinoDisplay && (
        <p className={styles.destinoReadOnly}>Destino: {destinoDisplay}</p>
      )}

      <div className={styles.cards}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryIcon}>📦</span>
          <div>
            <span className={styles.summaryValue}>Produtos</span>
            <span className={styles.summaryNumber}>{qtdProdutos}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryIcon}>📦</span>
          <div>
            <span className={styles.summaryValue}>Itens</span>
            <span className={styles.summaryNumber}>{qtdItens}</span>
          </div>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>PRODUTO</th>
              <th>CÓD. BARRAS</th>
              <th>SUBGRUPO</th>
              <th>GRADE</th>
              <th>DESCRIÇÃO</th>
              <th>COR</th>
              <th>DESTINO</th>
              <th>QTD</th>
              <th>AÇÃO</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item, idx) => {
              const destinoCell =
                tipo === "saida"
                  ? destinoDisplay || "—"
                  : (item.destino && item.destino.trim()) || "—";
              return (
                <tr key={`${item.produto}-${item.corProduto ?? ""}-${idx}`}>
                  <td>{item.produto}</td>
                  <td>{item.codigoBarra ?? "—"}</td>
                  <td>{item.subgrupo || "—"}</td>
                  <td>{item.grade || "—"}</td>
                  <td>{item.descProduto || "—"}</td>
                  <td>{item.descCor || item.corProduto || "—"}</td>
                  <td>
                    <span className={styles.destinoTag}>{destinoCell}</span>
                  </td>
                  <td>
                    <div className={styles.qtdCell}>
                      <span className={styles.qtdValue}>{item.qtde}</span>
                    </div>
                  </td>
                  <td>
                    <Link href={transferenciaHref} className={styles.transferirBtn}>
                      DAR ENTRADA
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {itens.length === 0 && (
        <div className={styles.emptyState}>
          Nenhum item encontrado neste romaneio.
        </div>
      )}
    </div>
  );
}
