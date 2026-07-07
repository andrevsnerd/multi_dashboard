import { notFound } from "next/navigation";
import type { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import LojaRaioXPage from "@/components/loja-raio-x/LojaRaioXPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface LojaRaioXPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: LojaRaioXPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return { title: "Loja Raio X | Dashboard" };
  }

  return { title: `Loja Raio X | ${company.name}` };
}

export default async function LojaRaioXPageRoute({ params }: LojaRaioXPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <LojaRaioXPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
