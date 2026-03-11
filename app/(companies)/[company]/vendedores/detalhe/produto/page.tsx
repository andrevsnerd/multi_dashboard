import { notFound } from "next/navigation";
import type { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import VendedorProdutoDetalhePage from "@/components/vendedores/VendedorProdutoDetalhePage";
import { resolveCompany } from "@/lib/config/company";
import { getCurrentMonthRange } from "@/lib/utils/date";

import styles from "../../../page.module.css";

interface Props {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  const sp = await searchParams;
  const descricao = typeof sp.descricao === "string" ? sp.descricao : "Produto";
  if (!company) return { title: "Produto | Dashboard" };
  return { title: `${descricao} | ${company.name}` };
}

export default async function VendedorProdutoDetalhePageRoute({ params, searchParams }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  const sp = await searchParams;

  if (!company) notFound();

  const vendedor = typeof sp.vendedor === "string" ? sp.vendedor : "";
  const filial = typeof sp.filial === "string" ? sp.filial : "";
  const produto = typeof sp.produto === "string" ? sp.produto : "";
  const descricao = typeof sp.descricao === "string" ? sp.descricao : "";

  if (!vendedor || !filial || !produto) notFound();

  let start = typeof sp.start === "string" ? sp.start : "";
  let end = typeof sp.end === "string" ? sp.end : "";
  if (!start || !end) {
    const range = getCurrentMonthRange();
    start = range.start.toISOString();
    end = range.end.toISOString();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <VendedorProdutoDetalhePage
            companyKey={company.key}
            vendedorNome={vendedor}
            filial={filial}
            produtoCodigo={produto}
            produtoDescricao={descricao || produto}
            initialStart={start}
            initialEnd={end}
          />
        </div>
      </div>
    </PageLayout>
  );
}
