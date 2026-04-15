import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ListaLojaPage from "@/components/lista-loja/ListaLojaPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ListaLojaPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: ListaLojaPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Lista Loja | ${company.name}` : "Lista Loja" };
}

export default async function ListaLojaRoute({ params }: ListaLojaPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) notFound();

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ListaLojaPage companyKey={company.key} companyName={company.name} companySlug={companySlug} />
        </div>
      </div>
    </PageLayout>
  );
}
