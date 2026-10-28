import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AproveitamentosMatrizPage from "@/components/insumos/AproveitamentosMatrizPage";
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
    title: company ? `Aproveitamentos Matriz | ${company.name}` : "Aproveitamentos Matriz",
  };
}

export default async function AproveitamentosMatrizRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // Os aproveitamentos (lenço 50x50 e twilly 8x130) são da matriz Scarf Me.
  if (!company || company.key !== "scarfme") {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <AproveitamentosMatrizPage />
        </div>
      </div>
    </PageLayout>
  );
}
