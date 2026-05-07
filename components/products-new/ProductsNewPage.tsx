import type { ProdutoNovoItem } from "@/lib/repositories/produtosNovos";

import styles from "./ProductsNewPage.module.css";

interface ProductsNewPageProps {
  items: ProdutoNovoItem[];
}

function parseLocalDate(value: string | null): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRegistrationDate(value: string | null): string {
  const parsed = parseLocalDate(value);
  if (!parsed) return "-";

  return new Intl.DateTimeFormat("pt-BR").format(parsed);
}

function getDaysLabel(value: string | null): string {
  const parsed = parseLocalDate(value);
  if (!parsed) return "-";

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfRegistration = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffInMs = startOfToday.getTime() - startOfRegistration.getTime();
  const diffInDays = Math.max(0, Math.floor(diffInMs / (1000 * 60 * 60 * 24))) + 1;

  return `${diffInDays} dia${diffInDays === 1 ? "" : "s"}`;
}

export default function ProductsNewPage({ items }: ProductsNewPageProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Produtos Novos</h1>
        <p className={styles.subtitle}>
          Produtos cadastrados nos ultimos 18 dias com a label persistida <strong>produto novo</strong>.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data Cadastro</th>
                <th>Produto</th>
                <th>Descricao</th>
                <th>Cor</th>
                <th>Dias</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className={styles.empty} colSpan={5}>
                    Nenhum produto novo encontrado.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={`${item.produto}::${item.corCodigo}`}>
                    <td className={styles.dataCadastro}>{formatRegistrationDate(item.dataCadastro)}</td>
                    <td className={styles.produto}>{item.produto}</td>
                    <td className={styles.descricao}>{item.descricao || "-"}</td>
                    <td className={styles.cor}>{item.cor || "-"}</td>
                    <td className={styles.dias}>{getDaysLabel(item.dataCadastro)}</td>
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
