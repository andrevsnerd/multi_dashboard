import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import FaturamentoEcommercePage from "@/components/faturamento-ecommerce/FaturamentoEcommercePage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface Props {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: slug } = await params;
  const company = resolveCompany(slug);
  const nome = "Faturamento E-com / Matriz";
  return { title: company ? `${nome} | ${company.name}` : nome };
}

export default async function FaturamentoEcommerceRoute({ params }: Props) {
  const { company: slug } = await params;
  const company = resolveCompany(slug);

  // NERD e Scarf Me são empresas separadas: cada uma fatura só nas suas filiais.
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <FaturamentoEcommercePage empresa={company.key} />
        </div>
      </div>
    </PageLayout>
  );
}
