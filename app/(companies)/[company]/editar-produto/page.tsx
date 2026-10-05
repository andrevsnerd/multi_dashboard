import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import EditarProdutoPage from "@/components/cadastro/EditarProdutoPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface EditarProdutoPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: EditarProdutoPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Editar Produto | ${company.name}` : "Editar Produto" };
}

export default async function EditarProdutoPageRoute({ params }: EditarProdutoPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // Edita o cadastro de PRODUTOS do Linx — só as operações de varejo têm catálogo.
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  const companyKey: "nerd" | "scarfme" = company.key === "nerd" ? "nerd" : "scarfme";

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <EditarProdutoPage companyKey={companyKey} />
        </div>
      </div>
    </PageLayout>
  );
}
