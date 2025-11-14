import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const GOALS_FILE_PATH = path.join(process.cwd(), 'data', 'goals.json');

interface GoalData {
  [companyKey: string]: {
    [year: string]: {
      [month: string]: {
        [filial: string]: number;
      };
    };
  };
}

async function ensureGoalsFile(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }

  try {
    await fs.access(GOALS_FILE_PATH);
  } catch {
    await fs.writeFile(GOALS_FILE_PATH, JSON.stringify({}), 'utf-8');
  }
}

async function readGoals(): Promise<GoalData> {
  await ensureGoalsFile();
  try {
    const content = await fs.readFile(GOALS_FILE_PATH, 'utf-8');
    return JSON.parse(content) as GoalData;
  } catch {
    return {};
  }
}

async function writeGoals(goals: GoalData): Promise<void> {
  await ensureGoalsFile();
  await fs.writeFile(GOALS_FILE_PATH, JSON.stringify(goals, null, 2), 'utf-8');
}

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

