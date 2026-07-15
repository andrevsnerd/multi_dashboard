import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import AumentosDescontosPage from "@/components/aumentos-descontos/AumentosDescontosPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface AumentosDescontosPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: AumentosDescontosPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Aumentos e Descontos | ${company.name}` : "Aumentos e Descontos" };
}

export default async function AumentosDescontosRoute({ params }: AumentosDescontosPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) notFound();

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <AumentosDescontosPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
