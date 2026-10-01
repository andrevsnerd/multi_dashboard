import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import CadastrarProdutoPage from "@/components/produto-novo/CadastrarProdutoPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface CadastrarProdutoPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: CadastrarProdutoPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Cadastrar Produto | ${company.name}` : "Cadastrar Produto" };
}

export default async function CadastrarProdutoPageRoute({ params }: CadastrarProdutoPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // Grava produto novo no cadastro do Linx — só as operações de varejo têm catálogo.
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  const companyKey: "nerd" | "scarfme" = company.key === "nerd" ? "nerd" : "scarfme";

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <CadastrarProdutoPage companyKey={companyKey} />
        </div>
      </div>
    </PageLayout>
  );
}
