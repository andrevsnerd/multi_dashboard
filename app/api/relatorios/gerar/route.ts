import { spawn } from 'node:child_process';
import path from 'node:path';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // a geracao completa (estoque) leva minutos

const RELATORIOS_VALIDOS = [
  'produtos',
  'estoque',
  'vendas',
  'ecommerce',
  'entradas',
  'saidas',
] as const;

type RelatorioValido = (typeof RELATORIOS_VALIDOS)[number];

interface ArquivoGerado {
  relatorio: RelatorioValido;
  base: string;
  registros: number | null;
  xlsx?: { arquivo: string; tamanho: number };
  csv?: { arquivo: string; tamanho: number };
}

interface ResultadoScript {
  ok: boolean;
  erro: string | null;
  selecao: RelatorioValido[];
  arquivos: ArquivoGerado[];
}

function getScriptDir(): string {
  return (process.env.RELATORIOS_SCRIPT_DIR || 'C:\\NERD\\AUTOMACOES').trim();
}

function getPythonBin(): string {
  return (process.env.PYTHON_BIN || 'python').trim();
}

/** Extrai o bloco JSON delimitado pelos marcadores emitidos pelo wrapper. */
function extrairResultado(stdout: string): ResultadoScript | null {
  const inicio = stdout.lastIndexOf('@@RESULT_BEGIN@@');
  const fim = stdout.lastIndexOf('@@RESULT_END@@');
  if (inicio === -1 || fim === -1 || fim < inicio) return null;

  const bloco = stdout.slice(inicio + '@@RESULT_BEGIN@@'.length, fim).trim();
  try {
    return JSON.parse(bloco) as ResultadoScript;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let relatorios: string[];
  try {
    const body = await request.json();
    relatorios = Array.isArray(body?.relatorios) ? body.relatorios : [];
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 });
  }

  const selecionados = relatorios.filter((r): r is RelatorioValido =>
    (RELATORIOS_VALIDOS as readonly string[]).includes(r)
  );

  if (selecionados.length === 0) {
    return NextResponse.json(
      { error: 'Selecione pelo menos um relatório válido' },
      { status: 400 }
    );
  }

  const scriptDir = getScriptDir();
  const scriptPath = path.join(scriptDir, 'exportar_relatorios_api.py');
  const argumento =
    selecionados.length === RELATORIOS_VALIDOS.length
      ? 'todos'
      : selecionados.join(',');

  const inicio = Date.now();

  const resultado = await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    erroSpawn?: string;
  }>((resolve) => {
    const child = spawn(getPythonBin(), [scriptPath, argumento], {
      cwd: scriptDir,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      resolve({ code: null, stdout, stderr, erroSpawn: err.message });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });

  const tempoTotal = (Date.now() - inicio) / 1000;

  if (resultado.erroSpawn) {
    return NextResponse.json(
      {
        error: 'Não foi possível iniciar o Python',
        details: `${resultado.erroSpawn}. Verifique PYTHON_BIN e RELATORIOS_SCRIPT_DIR.`,
      },
      { status: 500 }
    );
  }

  const parsed = extrairResultado(resultado.stdout);

  if (!parsed) {
    const cauda = (resultado.stderr || resultado.stdout || '').slice(-1500);
    return NextResponse.json(
      {
        error: 'Falha ao executar o exportador',
        details: cauda || 'Sem saída do processo Python.',
      },
      { status: 500 }
    );
  }

  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: 'O exportador retornou erro',
        details: parsed.erro || 'Erro desconhecido no script.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    tempoTotal,
    arquivos: parsed.arquivos,
  });
}
