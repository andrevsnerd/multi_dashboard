export interface ProductRevenue {
  productId: string;
  productName: string;
  totalRevenue: number;
  totalQuantity: number;
  stock: number;
}

export interface CategoryRevenue {
  categoryId: string;
  categoryName: string;
  totalRevenue: number;
  totalQuantity: number;
}

export interface DateRangeInput {
  start?: string | Date;
  end?: string | Date;
}

export interface MetricSummary {
  currentValue: number;
  previousValue: number;
  changePercentage: number | null;
}

export interface SalesSummary {
  totalRevenue: MetricSummary;
  totalQuantity: MetricSummary;
  totalTickets: MetricSummary;
  averageTicket: MetricSummary;
  totalStockQuantity: MetricSummary;
  totalStockValue: MetricSummary;
}


