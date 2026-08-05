import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import AlterarCadastroPage from "@/components/cadastro/AlterarCadastroPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface AlterarCadastroPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: AlterarCadastroPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Alterar Cadastro | ${company.name}` : "Alterar Cadastro" };
}

export default async function AlterarCadastroPageRoute({ params }: AlterarCadastroPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // Mexe no cadastro de PRODUTOS e nas mestres de dimensão do Linx — só faz
  // sentido para as operações de varejo. CORPORATIVO não tem catálogo próprio.
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  const companyKey: "nerd" | "scarfme" = company.key === "nerd" ? "nerd" : "scarfme";

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <AlterarCadastroPage companyKey={companyKey} />
        </div>
      </div>
    </PageLayout>
  );
}
