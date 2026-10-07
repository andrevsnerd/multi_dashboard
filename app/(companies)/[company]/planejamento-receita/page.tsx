import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import PlanejamentoReceitaPage from "@/components/planejamento-receita/PlanejamentoReceitaPage";
import { resolveCompany } from "@/lib/config/company";
import { anosComPlanejamento } from "@/lib/config/planejamento-receita";

import styles from "../page.module.css";

interface Props {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return {
    title: company ? `Planejamento de Receita | ${company.name}` : "Planejamento de Receita",
  };
}

export default async function PlanejamentoReceitaRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  const anos = company ? anosComPlanejamento(company.key) : [];

  // Só empresa com orçado cadastrado (hoje, a Scarf Me).
  if (!company || anos.length === 0) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <PlanejamentoReceitaPage companyKey={company.key} companyName={company.name} anos={anos} />
        </div>
      </div>
    </PageLayout>
  );
}
