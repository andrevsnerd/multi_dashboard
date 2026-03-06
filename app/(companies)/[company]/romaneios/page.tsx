import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import RomaneiosPage from "@/components/romaneios/RomaneiosPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface RomaneiosPageRouteProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: RomaneiosPageRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  if (!company) return { title: "Romaneios" };
  return { title: `Romaneios | ${company.name}` };
}

export default async function RomaneiosRoute({ params }: RomaneiosPageRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <RomaneiosPage companySlug={companySlug} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
