import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ControleFinanceiroPage from "@/components/controle-financeiro/ControleFinanceiroPage";
import PageLayout from "@/components/layout/PageLayout";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface Props {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return {
    title: company ? `Controle Financeiro | ${company.name}` : "Controle Financeiro",
  };
}

export default async function ControleFinanceiroRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // A planilha do financeiro é a da Scarf Me.
  if (!company || company.key !== "scarfme") {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        {/* minWidth 0: a DRE (12 meses + totais) rola dentro do cartão em vez de esticar a página. */}
        <div className={styles.content} style={{ minWidth: 0 }}>
          <ControleFinanceiroPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
