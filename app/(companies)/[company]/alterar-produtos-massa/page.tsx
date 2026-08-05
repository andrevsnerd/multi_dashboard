import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import AlterarMultiplosProdutosPage from "@/components/cadastro/AlterarMultiplosProdutosPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface AlterarProdutosMassaPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({
  params,
}: AlterarProdutosMassaPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return {
    title: company ? `Alterar Múltiplos Produtos | ${company.name}` : "Alterar Múltiplos Produtos",
  };
}

export default async function AlterarProdutosMassaPageRoute({
  params,
}: AlterarProdutosMassaPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  const companyKey: "nerd" | "scarfme" = company.key === "nerd" ? "nerd" : "scarfme";

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <AlterarMultiplosProdutosPage companyKey={companyKey} />
        </div>
      </div>
    </PageLayout>
  );
}
