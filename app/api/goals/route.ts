import { NextResponse } from 'next/server';
import { readGoals, writeGoals } from '@/lib/utils/goals-storage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company');
  const month = searchParams.get('month');
  const year = searchParams.get('year');
  const debug = searchParams.get('debug') === 'true';

  // Endpoint de debug para verificar configuração do Redis
  if (debug) {
    const redisEnv = {
      UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    };
    
    // Procurar variáveis com prefixo customizado
    const envKeys = Object.keys(process.env);
    const redisKeys = envKeys.filter(k => 
      k.includes('REDIS') || k.includes('UPSTASH')
    );
    
    // Tentar encontrar variáveis com diferentes padrões
    const urlKey = envKeys.find(key => 
      key.endsWith('_REDIS_REST_URL') || 
      key.endsWith('_REDIS_URL') ||
      (key.includes('UPSTASH') && key.includes('URL'))
    );
    const tokenKey = envKeys.find(key => 
      key.endsWith('_REDIS_REST_TOKEN') || 
      key.endsWith('_REDIS_TOKEN') ||
      (key.includes('UPSTASH') && key.includes('TOKEN'))
    );
    
    return NextResponse.json({
      status: 'debug',
      redisEnv,
      foundKeys: {
        urlKey: urlKey || null,
        tokenKey: tokenKey || null,
        hasUrl: urlKey ? !!process.env[urlKey] : false,
        hasToken: tokenKey ? !!process.env[tokenKey] : false,
      },
      allRedisKeys: redisKeys.map(k => ({
        key: k,
        hasValue: !!process.env[k],
        valueLength: process.env[k]?.length || 0,
        valuePreview: process.env[k]?.substring(0, 20) + '...' || null
      })),
      message: redisKeys.length === 0 
        ? '❌ Nenhuma variável de ambiente do Redis encontrada! Configure o Redis no Vercel.'
        : (!urlKey || !tokenKey)
        ? '⚠️ Variáveis encontradas mas não no formato esperado'
        : '✅ Variáveis encontradas!'
    });
  }

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

