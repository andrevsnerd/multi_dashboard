import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ComprasTransitoPage from "@/components/lista-loja/ComprasTransitoPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface Props {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return {
    title: company ? `Compras em Trânsito | ${company.name}` : "Compras em Trânsito",
  };
}

export default async function ComprasTransitoRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) notFound();

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ComprasTransitoPage
            companyKey={company.key}
            companyName={company.name}
            companySlug={companySlug}
          />
        </div>
      </div>
    </PageLayout>
  );
}
