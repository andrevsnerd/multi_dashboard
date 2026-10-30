import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProgramarPrecosPage from "@/components/precos/ProgramarPrecosPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ProgramarPrecosPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: ProgramarPrecosPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Programar Preços | ${company.name}` : "Programar Preços" };
}

export default async function ProgramarPrecosPageRoute({ params }: ProgramarPrecosPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // Mesmo escopo do Alterar Custo / Preço: catálogo de varejo (NERD e ScarfMe).
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  const companyKey: "nerd" | "scarfme" = company.key === "nerd" ? "nerd" : "scarfme";

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProgramarPrecosPage companyKey={companyKey} />
        </div>
      </div>
    </PageLayout>
  );
}
