import { NextResponse } from 'next/server';
import { readGoals, writeGoals } from '@/lib/utils/goals-storage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company');
  const month = searchParams.get('month');
  const year = searchParams.get('year');

  if (!companyKey || month === null || year === null) {
    return NextResponse.json(
      { error: 'Parâmetros company, month e year são obrigatórios' },
      { status: 400 }
    );
  }

  try {
    const allGoals = await readGoals();
    const companyGoals = allGoals[companyKey] || {};
    const yearGoals = companyGoals[year] || {};
    const monthGoals = yearGoals[month] || {};

    return NextResponse.json({ data: monthGoals });
  } catch (error) {
    console.error('Erro ao ler metas', error);
    return NextResponse.json(
      { error: 'Erro ao carregar metas' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyKey, month, year, goals } = body;

    if (!companyKey || month === null || month === undefined || year === null || year === undefined || !goals) {
      return NextResponse.json(
        { error: 'Parâmetros companyKey, month, year e goals são obrigatórios' },
        { status: 400 }
      );
    }

    const allGoals = await readGoals();

    if (!allGoals[companyKey]) {
      allGoals[companyKey] = {};
    }
    if (!allGoals[companyKey][year]) {
      allGoals[companyKey][year] = {};
    }

    allGoals[companyKey][year][month] = goals;

    await writeGoals(allGoals);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar metas', error);
    return NextResponse.json(
      { error: 'Erro ao salvar metas' },
      { status: 500 }
    );
  }
}

