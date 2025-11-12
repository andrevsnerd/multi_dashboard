export interface ProductRevenue {
  productId: string;
  productName: string;
  totalRevenue: number;
  totalQuantity: number;
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

export interface SalesSummary {
  totalRevenue: number;
  totalQuantity: number;
  totalTickets: number;
  averageTicket: number;
}


