import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ComprasSalvasListPanel from "@/components/stock/ComprasSalvasListPanel";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface Props {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return {
    title: company ? `Compras Salvas | ${company.name}` : "Compras Salvas",
  };
}

export default async function ComprasSalvasRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) notFound();

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ComprasSalvasListPanel
            companyKey={company.key}
            companySlug={companySlug}
            source="operacoes"
          />
        </div>
      </div>
    </PageLayout>
  );
}
