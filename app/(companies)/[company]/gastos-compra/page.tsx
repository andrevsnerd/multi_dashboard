import type { Metadata } from "next";
import { notFound } from "next/navigation";

import GastosCompraPanel from "@/components/compras/GastosCompraPanel";
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
    title: company ? `Gastos de Compra | ${company.name}` : "Gastos de Compra",
  };
}

export default async function GastosCompraRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // Planejamento de compra de mercadoria: só as operações de varejo.
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <GastosCompraPanel companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
