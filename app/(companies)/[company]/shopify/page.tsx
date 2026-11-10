import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ShopifyPage from "@/components/shopify/ShopifyPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ShopifyRouteProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ShopifyRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  return {
    title: company ? `Shopify | ${company.name}` : "Shopify",
  };
}

export default async function ShopifyRoute({ params }: ShopifyRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // Só as duas operações de varejo têm loja Shopify.
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ShopifyPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
