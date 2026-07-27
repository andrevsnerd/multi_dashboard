import type { ProdutoNovoItem, ProdutoNovoOrigem } from "@/lib/repositories/produtosNovos";
import { PRODUTOS_NOVOS_WINDOW_DAYS } from "@/lib/repositories/produtosNovos";

import styles from "./ProductsNewPage.module.css";

interface ProductsNewPageProps {
  items: ProdutoNovoItem[];
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const quantityFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

const ORIGEM_LABEL: Record<ProdutoNovoOrigem, string> = {
  cadastro: "Cadastro",
  entrada: "1ª entrada",
  ambos: "Cadastro + entrada",
};

function parseLocalDate(value: string | null): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null): string {
  const parsed = parseLocalDate(value);
  if (!parsed) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(parsed);
}

function getDaysSince(value: string | null): number | null {
  const parsed = parseLocalDate(value);
  if (!parsed) return null;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfRef = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffInMs = startOfToday.getTime() - startOfRef.getTime();
  return Math.max(0, Math.floor(diffInMs / (1000 * 60 * 60 * 24))) + 1;
}

function getDaysLabel(value: string | null): string {
  const days = getDaysSince(value);
  if (days == null) return "-";
  return `${days} dia${days === 1 ? "" : "s"}`;
}

export default function ProductsNewPage({ items }: ProductsNewPageProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Produtos Novos</h1>
        <p className={styles.subtitle}>
          Produtos que surgiram nos ultimos {PRODUTOS_NOVOS_WINDOW_DAYS} dias — por{" "}
          <strong>cadastro</strong> ou pela <strong>primeira entrada de estoque</strong> na rede
          (inclui itens que ainda nao venderam). A performance mostra o total vendido desde que o
          produto surgiu.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Descricao</th>
                <th>Cor</th>
                <th>Origem</th>
                <th>Cadastro</th>
                <th>1a Entrada</th>
                <th>Surgiu ha</th>
                <th className={styles.numHead}>Vendas</th>
                <th className={styles.numHead}>Qtd</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className={styles.empty} colSpan={9}>
                    Nenhum produto novo encontrado.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={`${item.produto}::${item.corCodigo}`}>
                    <td className={styles.produto}>{item.produto}</td>
                    <td className={styles.descricao}>{item.descricao || "-"}</td>
                    <td className={styles.cor}>{item.cor || "-"}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge_${item.origem}`]}`}>
                        {ORIGEM_LABEL[item.origem]}
                      </span>
                    </td>
                    <td className={styles.dataCadastro}>{formatDate(item.dataCadastro)}</td>
                    <td className={styles.dataCadastro}>{formatDate(item.primeiraEntrada)}</td>
                    <td className={styles.dias}>{getDaysLabel(item.surgeDate)}</td>
                    <td className={`${styles.num} ${item.vendas > 0 ? styles.numStrong : ""}`}>
                      {currencyFormatter.format(item.vendas)}
                    </td>
                    <td className={styles.num}>{quantityFormatter.format(item.qtde)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
