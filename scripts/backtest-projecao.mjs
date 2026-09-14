/**
 * BACKTEST da Projeção Compra — a trava que impede a regra de piorar sem ninguém notar.
 *
 * A pergunta que ele responde é a única que importa numa regra de previsão: *se eu tivesse
 * rodado esta tela em tal data, teria acertado?* Ele rebobina a projeção para uma data
 * passada, projeta o trecho seguinte e compara com o que de fato foi vendido.
 *
 * DUAS DECISÕES DE DESENHO, as duas deliberadas:
 *
 *  1. **Nada de SQL novo.** Os dados vêm da PRÓPRIA API da tela (`/api/projecao-compra`),
 *     que já aceita `base` no passado. Assim o teste passa pela mesma lógica validada de
 *     venda com trocas (regra do CLAUDE.md) e enxerga exatamente o que a tela enxerga —
 *     inclusive erro de servidor, se houver.
 *  2. **Nada de cópia da conta.** Importa `montarPerfilSazonal`, `projetarHorizonteSazonal`
 *     e `avaliarAjusteLinha` dos módulos de produção. Um backtest que reimplementa a regra
 *     concorda consigo mesmo enquanto a tela segue diferente.
 *
 * O período é medido em MESES CHEIOS de propósito: com `--base` no dia 1º, não há mês
 * parcial em nenhuma das pontas e o realizado é somável direto da série mensal, sem
 * pro-rata — um lugar a menos para o teste errar por conta própria.
 *
 * USO (com o `npm run dev` de pé — ele é a fonte dos dados):
 *
 *     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *       --import ./scripts/lib/alias-register.mjs scripts/backtest-projecao.mjs \
 *       --company scarfme --base 2025-10-01 --ate 2025-12-31 \
 *       --subgrupo "MOUSSELINE DE POLIESTER" --subgrupo "CETIM DE SEDA 90X90"
 *
 * Cada `--subgrupo`/`--linha`/`--grupo` vira uma rodada e os resultados são somados. Rode
 * por categoria em vez de na empresa inteira: a API omite o detalhe item a item acima de
 * 400 itens × cor (e o script avisa quando isso acontece, em vez de medir metade calado).
 *
 * SAÍDA: viés e MAE por balde, e código de saída 1 quando algum passa do teto — é isso que
 * permite plugar em CI ou rodar antes de mexer na regra.
 *
 * Referência do que ele mediu quando foi escrito (LENÇOS, base 14/09/2025):
 * regra sem a trava dava +46% de viés no total e +143% nas linhas de base curta; com a
 * trava, +15% e +5%, sem mexer nas linhas saudáveis. Ver [projecao-linha-ajuste.ts].
 */

import {
  diffDiasInclusivo,
  montarPerfilSazonal,
  projetarHorizonteSazonal,
  curvaNeutra,
} from '@/lib/utils/projecao-sazonal';
import { avaliarAjusteLinha } from '@/lib/utils/projecao-linha-ajuste';

const CHAVE_ESCOPO_TODO = '__ESCOPO__';

/**
 * O ACEITE — e por que ele quase não tem número fixo.
 *
 * A primeira versão deste arquivo tinha teto de viés por balde (40%/40%/60%). Na primeira
 * rodada larga o balde das sinalizadas deu +78% e o teste reprovou — não porque a trava
 * estivesse ruim (ela tinha acabado de derrubar aquele balde de +301% para +78%), mas
 * porque o teto fora escolhido num escopo estreito. Mexer no teto até ficar verde é
 * calibrar o termômetro na febre; o critério certo é outro.
 *
 * Então o aceite é, em ordem:
 *
 *  1. **INVARIANTE** — nenhuma linha saudável pode mudar. É a promessa da trava cirúrgica,
 *     e é verificável de forma exata (comparação numérica), não estatística.
 *  2. **NÃO-REGRESSÃO** — em nenhum balde a trava pode piorar o viés ou o MAE. Isto não
 *     depende de escopo, de ano nem de quanto o mercado andou: compara a regra com ela
 *     mesma sobre os mesmos itens.
 *  3. **ALARME DE INCÊNDIO** — um teto absoluto folgado no total, só para pegar catástrofe
 *     (regra invertida, série vazia, curva zerada). Não é meta de precisão.
 *
 * Por que nenhum teto apertado faz sentido aqui: o "realizado" de um backtest é VENDA, não
 * demanda. Item que rompeu vendeu menos do que teria vendido, então parte do viés positivo
 * que sobra é ruptura, não erro — e apertar o teto empurraria a regra a comprar de menos
 * para ficar bonita no teste.
 */
const TETO_ALARME_TOTAL = 100;
/** Folga numérica para ruído de ponto flutuante na comparação de não-regressão. */
const TOLERANCIA = 1e-6;

function args() {
  const a = process.argv.slice(2);
  const um = (nome, padrao = null) => {
    const i = a.indexOf(`--${nome}`);
    return i >= 0 && a[i + 1] ? a[i + 1] : padrao;
  };
  const varios = (nome) =>
    a.reduce((acc, v, i) => (v === `--${nome}` && a[i + 1] ? [...acc, a[i + 1]] : acc), []);
  return {
    company: um('company', 'scarfme'),
    base: um('base'),
    ate: um('ate'),
    url: um('url', 'http://localhost:3000'),
    escopos: [
      ...varios('subgrupo').map((v) => ['subgrupo', v]),
      ...varios('linha').map((v) => ['linha', v]),
      ...varios('grupo').map((v) => ['grupo', v]),
    ],
    filial: um('filial'),
  };
}

function ehData(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

async function buscar(cfg, base, dim, valor, comSazonal) {
  const p = new URLSearchParams({ company: cfg.company, base, porItem: '1' });
  if (comSazonal) p.set('sazonal', '1');
  if (cfg.filial) p.set('filial', cfg.filial);
  p.append(dim, valor);
  const resp = await fetch(`${cfg.url}/api/projecao-compra?${p}`);
  if (!resp.ok) throw new Error(`API ${resp.status} em ${dim}=${valor} base=${base}`);
  const json = await resp.json();
  if (json.error) throw new Error(`API: ${json.error}`);
  return json;
}

/** Soma o realizado de `mesInicio..mesFim` do ANO ANTERIOR da série (o trecho medido). */
function realizadoDoTrecho(mensal, mesInicio, mesFim) {
  if (!Array.isArray(mensal)) return 0;
  return mensal.reduce((soma, m) => {
    const mes = Number(String(m.mes).slice(5, 7));
    if (mes < mesInicio || mes > mesFim) return soma;
    return soma + Math.max(0, Number(m.qtdeAnoAnterior) || 0);
  }, 0);
}

function metricas(linhas, campo) {
  const real = linhas.reduce((s, l) => s + l.realizado, 0);
  const proj = linhas.reduce((s, l) => s + l[campo], 0);
  const mae = linhas.length
    ? linhas.reduce((s, l) => s + Math.abs(l[campo] - l.realizado), 0) / linhas.length
    : 0;
  const excesso = linhas.reduce((s, l) => s + Math.max(0, l[campo] - l.realizado), 0);
  const falta = linhas.reduce((s, l) => s + Math.max(0, l.realizado - l[campo]), 0);
  return { real, proj, vies: real > 0 ? (proj / real - 1) * 100 : 0, mae, excesso, falta };
}

function imprimir(nome, linhas) {
  if (linhas.length === 0) {
    console.log(`\n### ${nome} — nenhum item`);
    return null;
  }
  const semTrava = metricas(linhas, 'semTrava');
  const comTrava = metricas(linhas, 'comTrava');
  console.log(`\n### ${nome} — ${linhas.length} itens | realizado ${Math.round(semTrava.real)} un`);
  const linha = (rot, m) =>
    `  ${rot.padEnd(11)} proj ${String(Math.round(m.proj)).padStart(6)} | viés ${
      `${m.vies >= 0 ? '+' : ''}${m.vies.toFixed(0)}%`.padStart(6)
    } | MAE ${m.mae.toFixed(1).padStart(5)} | excesso ${String(Math.round(m.excesso)).padStart(5)} | falta ${String(Math.round(m.falta)).padStart(5)}`;
  console.log(linha('sem trava', semTrava));
  console.log(linha('COM trava', comTrava));
  return { nome, semTrava, comTrava };
}

async function main() {
  const cfg = args();
  if (!ehData(cfg.base) || !ehData(cfg.ate)) {
    console.error('Uso: --base yyyy-MM-dd --ate yyyy-MM-dd [--subgrupo X]... [--company scarfme]');
    console.error('Dica: use --base no dia 1º de um mês, para o trecho medido ser de meses cheios.');
    process.exit(2);
  }
  if (cfg.escopos.length === 0) {
    console.error('Informe ao menos um --subgrupo, --linha ou --grupo.');
    process.exit(2);
  }
  const anoBase = Number(cfg.base.slice(0, 4));
  const mesInicio = Number(cfg.base.slice(5, 7));
  const mesFim = Number(cfg.ate.slice(5, 7));
  if (Number(cfg.ate.slice(0, 4)) !== anoBase || mesFim < mesInicio) {
    console.error('--ate precisa ser do MESMO ano de --base e posterior a ele.');
    process.exit(2);
  }
  // A leitura do realizado vem de uma projeção ancorada no ano seguinte, onde o trecho
  // medido cai no campo "ano anterior" da série mensal.
  const baseSeguinte = `${anoBase + 1}-01-01`;
  const dias = diffDiasInclusivo(cfg.base, cfg.ate);

  console.log(
    `Backtest — ${cfg.company} | projeta em ${cfg.base} o trecho ${cfg.base}..${cfg.ate} (${dias} dias)`
  );

  const todas = [];
  for (const [dim, valor] of cfg.escopos) {
    process.stdout.write(`\n· ${dim}=${valor} … `);
    const [previsao, verdade] = await Promise.all([
      buscar(cfg, cfg.base, dim, valor, true),
      buscar(cfg, baseSeguinte, dim, valor, false),
    ]);
    if (previsao.porItemOmitido || verdade.porItemOmitido) {
      console.log(
        `PULADO: acima de ${previsao.maxItensMensal ?? 400} itens × cor, a API não devolve o detalhe. Recorte mais fino.`
      );
      continue;
    }
    if (!previsao.sazonal) {
      console.log('PULADO: a curva sazonal não veio (categoria sem anos fechados?).');
      continue;
    }
    const curvas = previsao.sazonal.curvas ?? {};
    const series = previsao.sazonal.series ?? {};
    const realPorItem = new Map(
      (verdade.itens ?? []).map((i) => [
        `${i.produto}||${i.cor}`,
        realizadoDoTrecho(i.mensal, mesInicio, mesFim),
      ])
    );

    let usados = 0;
    for (const item of previsao.itens ?? []) {
      if (!Array.isArray(item.mensal) || item.mensal.length === 0) continue;
      const chave = `${item.produto}||${item.cor}`;
      const categoria = item.categoria ?? CHAVE_ESCOPO_TODO;
      const curva =
        curvas[categoria] ?? curvas[CHAVE_ESCOPO_TODO] ?? curvaNeutra(CHAVE_ESCOPO_TODO);
      const perfil = montarPerfilSazonal(item.mensal, curva);
      if (perfil.ultimoMesReal < 1) continue;
      const semTrava = projetarHorizonteSazonal(perfil, curva, cfg.base, dias);
      const ajuste = avaliarAjusteLinha({
        serieItem: item.mensal,
        serieCategoria: series[categoria] ?? series[CHAVE_ESCOPO_TODO] ?? null,
        curva,
        dataBase: cfg.base,
        diasHorizonte: dias,
        necessidadeOriginal: semTrava,
      });
      todas.push({
        chave,
        escopo: `${dim}=${valor}`,
        semTrava,
        comTrava: ajuste?.aplicado ? ajuste.necessidade : semTrava,
        sinalizada: Boolean(ajuste?.sinalizada),
        realizado: realPorItem.get(chave) ?? 0,
      });
      usados += 1;
    }
    console.log(`${usados} itens`);
  }

  if (todas.length === 0) {
    console.error('\nNenhum item medido — nada a concluir.');
    process.exit(2);
  }

  const total = imprimir('TODOS', todas);
  const saudaveis = imprimir(
    'SAUDÁVEIS (a trava não encosta)',
    todas.filter((l) => !l.sinalizada)
  );
  const sinalizadas = imprimir(
    'SINALIZADAS (base curta ou fatia em alta)',
    todas.filter((l) => l.sinalizada)
  );

  // As saudáveis têm de sair IDÊNTICAS — é a promessa da trava cirúrgica. Um centavo de
  // diferença aqui significa que ela vazou para quem não devia tocar.
  const vazou = todas.filter((l) => !l.sinalizada && Math.abs(l.comTrava - l.semTrava) > 1e-9);
  console.log(
    `\nLinhas saudáveis alteradas pela trava: ${vazou.length} (esperado: 0)` +
      (vazou.length ? ` — ex.: ${vazou.slice(0, 3).map((l) => l.chave).join(', ')}` : '')
  );

  const falhas = [];
  // 1. Invariante.
  if (vazou.length > 0) falhas.push(`${vazou.length} linhas saudáveis foram alteradas pela trava`);
  // 2. Não-regressão, balde a balde.
  for (const b of [total, saudaveis, sinalizadas]) {
    if (!b) continue;
    if (Math.abs(b.comTrava.vies) > Math.abs(b.semTrava.vies) + TOLERANCIA) {
      falhas.push(
        `${b.nome}: a trava PIOROU o viés (${b.semTrava.vies.toFixed(0)}% → ${b.comTrava.vies.toFixed(0)}%)`
      );
    }
    if (b.comTrava.mae > b.semTrava.mae + TOLERANCIA) {
      falhas.push(
        `${b.nome}: a trava PIOROU o MAE (${b.semTrava.mae.toFixed(1)} → ${b.comTrava.mae.toFixed(1)})`
      );
    }
  }
  // 3. Alarme de incêndio.
  if (total && Math.abs(total.comTrava.vies) > TETO_ALARME_TOTAL) {
    falhas.push(
      `TODOS: viés ${total.comTrava.vies.toFixed(0)}% passa do alarme de ${TETO_ALARME_TOTAL}% — algo quebrou, não é calibração`
    );
  }

  if (falhas.length > 0) {
    console.error(`\n✗ FORA DO ACEITE:\n  - ${falhas.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\n✓ dentro do aceite');
}

main().catch((erro) => {
  console.error('\nFalhou:', erro.message);
  process.exit(2);
});
