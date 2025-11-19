import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProductDetailPage from "@/components/products/ProductDetailPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ProductDetailPageRouteProps {
  params: Promise<{
    company: string;
  }>;
}

export default async function ProductDetailPageRoute({
  params,
}: ProductDetailPageRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProductDetailPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}


