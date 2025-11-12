import { fetchTopCategories, fetchTopProducts } from "@/lib/repositories/sales";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [topProducts, topCategories] = await Promise.all([
    fetchTopProducts(),
    fetchTopCategories(),
  ]);

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.label}>Dashboard</p>
          <h1 className={styles.title}>Visão geral de faturamento</h1>
        </div>
        <p className={styles.periodo}>Últimos 90 dias</p>
      </header>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2 className={styles.cardTitle}>Top produtos</h2>
          <ul className={styles.list}>
            {topProducts.map((item) => (
              <li key={item.productId} className={styles.listItem}>
                <div>
                  <strong className={styles.itemName}>{item.productName}</strong>
                  <p className={styles.itemSubtitle}>Código: {item.productId}</p>
                </div>
                <div className={styles.itemMetrics}>
                  <span className={styles.metricValue}>
                    {item.totalRevenue.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </span>
                  <span className={styles.metricLabel}>
                    {item.totalQuantity} unid.
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className={styles.card}>
          <h2 className={styles.cardTitle}>Top categorias</h2>
          <ul className={styles.list}>
            {topCategories.map((item) => (
              <li key={item.categoryId} className={styles.listItem}>
                <div>
                  <strong className={styles.itemName}>
                    {item.categoryName}
                  </strong>
                  <p className={styles.itemSubtitle}>
                    Código: {item.categoryId}
                  </p>
                </div>
                <div className={styles.itemMetrics}>
                  <span className={styles.metricValue}>
                    {item.totalRevenue.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </span>
                  <span className={styles.metricLabel}>
                    {item.totalQuantity} unid.
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
