import { notFound } from "next/navigation";
import type { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import VendedorDetalhePage from "@/components/vendedores/VendedorDetalhePage";
import { resolveCompany } from "@/lib/config/company";
import { getCurrentMonthRange } from "@/lib/utils/date";

import styles from "../../page.module.css";

interface VendedorDetalhePageRouteProps {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: VendedorDetalhePageRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  const sp = await searchParams;
  const vendedor = typeof sp.vendedor === "string" ? sp.vendedor : "";

  if (!company) {
    return { title: "Vendedor | Dashboard" };
  }

  return {
    title: vendedor ? `${vendedor} | Vendedores | ${company.name}` : `Vendedor | Vendedores | ${company.name}`,
  };
}

export default async function VendedorDetalhePageRoute({
  params,
  searchParams,
}: VendedorDetalhePageRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  const sp = await searchParams;

  if (!company) {
    notFound();
  }

  const vendedor = typeof sp.vendedor === "string" ? sp.vendedor : "";
  const filial = typeof sp.filial === "string" ? sp.filial : "";

  if (!vendedor || !filial) {
    notFound();
  }

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
          <VendedorDetalhePage
            companyKey={company.key}
            companyName={company.name}
            vendedorNome={vendedor}
            filial={filial}
            initialStart={start}
            initialEnd={end}
          />
        </div>
      </div>
    </PageLayout>
  );
}
