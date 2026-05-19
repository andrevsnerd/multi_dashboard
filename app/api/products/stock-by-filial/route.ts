import { NextResponse } from "next/server";
import { endOfMonth, startOfMonth } from "date-fns";

import { fetchProductStockByFilial } from "@/lib/repositories/productDetail";

const NO_COLOR_PARAM = "__SEM_COR__";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const company = searchParams.get("company") ?? undefined;
  const colorsParam = searchParams.get("colors");

  if (!productId) {
    return NextResponse.json(
      { error: "Parâmetro productId é obrigatório" },
      { status: 400 }
    );
  }

  const colors = colorsParam
    ? colorsParam
        .split(",")
        .map((color) => (color.trim() === NO_COLOR_PARAM ? "" : color.trim()))
    : undefined;

  const now = new Date();
  const range = {
    start: startOfMonth(now).toISOString(),
    end: endOfMonth(now).toISOString(),
  };

  try {
    const data = await fetchProductStockByFilial({
      productId,
      company,
      range,
      filial: null,
      colors,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar estoque por filial", error);
    return NextResponse.json(
      { error: "Erro ao carregar estoque por filial" },
      { status: 500 }
    );
  }
}
