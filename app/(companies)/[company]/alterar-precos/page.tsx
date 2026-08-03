import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import AlterarPrecosPage from "@/components/precos/AlterarPrecosPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface AlterarPrecosPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: AlterarPrecosPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Alterar Custo / Preço | ${company.name}` : "Alterar Custo / Preço" };
}

export default async function AlterarPrecosPageRoute({ params }: AlterarPrecosPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // A tela mexe no cadastro de PRODUTOS/PRODUTOS_PRECOS do Linx — só faz sentido
  // para as operações de varejo. CORPORATIVO não tem catálogo próprio.
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  const companyKey: "nerd" | "scarfme" = company.key === "nerd" ? "nerd" : "scarfme";

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <AlterarPrecosPage companyKey={companyKey} />
        </div>
      </div>
    </PageLayout>
  );
}
