import type { Metadata } from "next";
import { notFound } from "next/navigation";

import EmbalagensAviamentosPage from "@/components/insumos/EmbalagensAviamentosPage";
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
    title: company ? `Embalagens e Aviamentos | ${company.name}` : "Embalagens e Aviamentos",
  };
}

export default async function EmbalagensAviamentosRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // Os itens (e o estoque que a Projeção Compra usa) são os da Scarf Me.
  if (!company || company.key !== "scarfme") {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <EmbalagensAviamentosPage />
        </div>
      </div>
    </PageLayout>
  );
}
