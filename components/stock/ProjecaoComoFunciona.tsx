"use client";

import { useState } from "react";

import {
  INDICE_MAX,
  INDICE_MIN,
  MESES_JANELA_ATIVIDADE,
  PESO_JANELA_RECENTE,
  type PerfilProjecao,
} from "@/lib/utils/projecao-realista";
import {
  MESES_RECENTES_SAZONAL,
  PESO_RECENTE_SAZONAL,
  type CurvaSazonal,
  type PerfilSazonal,
} from "@/lib/utils/projecao-sazonal";
import type { RegraProjecao } from "@/lib/utils/projecao-regras";

import styles from "./ProjecaoCompraPage.module.css";

/**
 * "Como esta projeção é calculada" — a régua ESCOLHIDA, explicada para quem compra.
 *
 * Duas versões ficaram para trás e vale saber por quê. A primeira era um texto corrido que
 * começava pela régua `realista` e tratava as outras como rodapé. A segunda explicava as
 * quatro de uma vez, com tabela comparativa — ficou completa e ninguém leu: quem abre o
 * bloco quer entender O NÚMERO QUE ESTÁ NA TELA, não estudar o catálogo de réguas.
 *
 * Agora o bloco mostra só a régua ativa. Trocar o select troca a explicação. O quadro segue
 * sempre a mesma ordem — a pergunta que ela responde, a conta, os números DESTE escopo, e
 * ONDE ELA ERRA. A última parte é a que mais importa: régua sem limite declarado vira fé.
 *
 * Sobram dois blocos comuns, e os dois são sobre o número exibido, não sobre as réguas: as
 * mecânicas de horizonte (por que setembro não entra inteiro) e a passagem de projeção para
 * decisão de compra (por que projetar 1.000 não é comprar 1.000).
 */

interface Props {
  /** Perfil do escopo já gerado — sem ele o bloco mostra só a regra geral. */
  perfil?: PerfilProjecao | null;
  anoBase: number;
  /** Curva sazonal da categoria, quando ela foi medida. */
  curvaSazonal?: CurvaSazonal | null;
  /** Patamar do escopo na régua sazonal, quando ela foi medida. */
  perfilSazonal?: PerfilSazonal | null;
  /** Régua escolhida no select — é a única que este bloco explica. */
  regra?: RegraProjecao;
  /** Unidades vendidas por janela de dias (30/60/90/120/365) no escopo gerado. */
  janelas?: Record<number, number> | null;
  /** Consumo/dia do escopo pela régua da Compra Ideal, quando medido. */
  consumoIdeal?: number | null;
  /** 'yyyy-MM-dd' */
  dataBase?: string;
  /** 'yyyy-MM-dd' */
  venderAte?: string;
  diasHorizonte?: number;
  /** Dias de cobertura da regra de Ciclo de Compra do escopo (não é 90 fixo). */
  coberturaDias?: number;
  /** Nome da regra que definiu a cobertura ("Seda", "Lenços Brasil"…). */
  coberturaGrupo?: string;
}

function fmtDec(n: number | null | undefined, dec = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function fmtPct(v: number | null | undefined, dec = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${(v * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })}%`;
}
function ymdToBr(ymd?: string): string {
  if (!ymd) return "a data alvo";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
const MES_NOME = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const JANELAS_DIAS = [30, 60, 90, 120, 365];

/** Identidade de cada régua: o nome, para que serve e o que ela mostra em uma linha. */
const REGUAS: Array<{
  chaves: RegraProjecao[];
  nome: string;
  uso: string;
  mostra: string;
}> = [
  {
    chaves: ["sazonalCategoria"],
    nome: "Sazonal da categoria",
    uso: "compra de fim de ano",
    mostra: "Ritmo atual ajustado pela força histórica de cada mês",
  },
  {
    chaves: ["realista", "mais10"],
    nome: "Realista (índice YoY)",
    uso: "cenário conservador",
    mostra: "Repete o comportamento do ano passado, corrigido pelo crescimento deste ano",
  },
  {
    chaves: ["compraIdeal"],
    nome: "Ritmo Compra Ideal",
    uso: "reposição item a item",
    mostra: "Reposição item a item, medida nos períodos em que havia estoque",
  },
  {
    chaves: ["30", "60", "90", "120", "365"],
    nome: "Ritmo 30/60/90/120 dias · 12 meses",
    uso: "conferência",
    mostra: "Repete a média diária da janela escolhida, sem sazonalidade",
  },
];

export default function ProjecaoComoFunciona({
  perfil,
  anoBase,
  curvaSazonal,
  perfilSazonal,
  regra,
  janelas,
  consumoIdeal,
  dataBase,
  venderAte,
  diasHorizonte,
  coberturaDias,
  coberturaGrupo,
}: Props) {
  const [aberto, setAberto] = useState(false);

  const regraAtual: RegraProjecao = regra ?? "sazonalCategoria";
  const identidade = REGUAS.find((r) => r.chaves.includes(regraAtual)) ?? REGUAS[0];

  const ehSazonal = regraAtual === "sazonalCategoria";
  const ehRealista = regraAtual === "realista" || regraAtual === "mais10";
  const ehIdeal = regraAtual === "compraIdeal";
  const ehJanela = !ehSazonal && !ehRealista && !ehIdeal;
  /** Nas réguas de janela, qual delas está escolhida (30, 60, …). */
  const janelaEscolhida = ehJanela ? Number(regraAtual) : 0;

  const pesoPatamarAno = Math.round((1 - PESO_RECENTE_SAZONAL) * 100);
  const pesoPatamarRecente = Math.round(PESO_RECENTE_SAZONAL * 100);
  const pesoAno = Math.round((1 - PESO_JANELA_RECENTE) * 100);
  const pesoRecente = Math.round(PESO_JANELA_RECENTE * 100);

  /** A curva foi medida e tem pelo menos um ano completo de base. */
  const temCurva = (curvaSazonal?.anosUsados ?? 0) > 0;
  const fechados = perfil ? perfil.ultimoMesReal : 0;
  const temPerfil = !!perfil && fechados > 0;

  // Soma dos meses fechados: é a razão de somas do índice, com os números reais do escopo.
  let somaAtual = 0;
  let somaPassada = 0;
  if (perfil) {
    for (let m = 1; m <= fechados; m += 1) {
      somaAtual += perfil.reais[m] ?? 0;
      somaPassada += perfil.anoAnterior[m] ?? 0;
    }
  }
  const janelaLabel = perfil?.mesesJanela.length
    ? perfil.mesesJanela.map((m) => MES_NOME[m - 1]).join(" + ")
    : "—";

  /**
   * Os meses que o horizonte atravessa e quanto de cada um entra. É a explicação do
   * pro-rata falando das datas de verdade, em vez de "o mês da data base entra parcial".
   */
  const mesesDoHorizonte = (() => {
    if (!dataBase || !diasHorizonte) return [] as Array<{
      ano: number;
      mes: number;
      dias: number;
      inteiro: boolean;
      primeiro: boolean;
    }>;
    const partes: Array<{ ano: number; mes: number; dias: number; inteiro: boolean; primeiro: boolean }> = [];
    let ano = Number(dataBase.slice(0, 4));
    let mes = Number(dataBase.slice(5, 7));
    let dia = Number(dataBase.slice(8, 10));
    let restantes = diasHorizonte;
    for (let guard = 0; restantes > 0 && guard < 48; guard += 1) {
      const dm = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
      const usados = Math.min(restantes, dm - dia + 1);
      partes.push({ ano, mes, dias: usados, inteiro: usados >= dm, primeiro: guard === 0 });
      restantes -= usados;
      dia = 1;
      if (mes === 12) {
        ano += 1;
        mes = 1;
      } else {
        mes += 1;
      }
    }
    return partes;
  })();

  /**
   * O escopo acelerou ou desacelerou no ano? Decide a frase do passo 1 — dizer "vinha fraco
   * e cresceu" para um item que está caindo seria mentira escrita na tela.
   */
  const tendencia: "subiu" | "caiu" | "estavel" = (() => {
    if (!perfilSazonal || perfilSazonal.patamarAno <= 0) return "estavel";
    const razao = perfilSazonal.patamarRecente / perfilSazonal.patamarAno;
    if (razao >= 1.1) return "subiu";
    if (razao <= 0.9) return "caiu";
    return "estavel";
  })();

  /** Dias que o estoque da virada precisa cobrir — da regra da categoria, não fixo. */
  const cobertura = coberturaDias && coberturaDias > 0 ? coberturaDias : 90;

  /** Ritmo/dia de uma janela — a conta da régua mais simples, com o número do escopo. */
  const ritmoJanela = (dias: number) => {
    const un = Number(janelas?.[dias] ?? 0);
    return un > 0 ? un / dias : 0;
  };

  return (
    <div className={styles.comoCard}>
      <button
        type="button"
        className={styles.comoToggle}
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <span className={styles.comoCaret}>{aberto ? "▾" : "▸"}</span>
        Como esta projeção é calculada
        <span className={styles.comoResumo}>
          {identidade.nome} · {identidade.uso}
        </span>
      </button>

      {aberto && (
        <div className={styles.comoCorpo}>
          {/* ── 1. Sazonal ─────────────────────────────────────────────────── */}
          {ehSazonal && (
            <div className={`${styles.comoRegra} ${styles.comoRegraAtiva}`}>
              <div className={styles.comoRegraTitulo}>
                Sazonal da categoria
                <span className={styles.comoSelo}>compra de fim de ano</span>
              </div>
              <p>Esta projeção considera duas coisas:</p>
              <ul className={styles.comoLista}>
                <li>
                  <strong>Como o produto está vendendo agora</strong>
                </li>
                <li>
                  <strong>Quanto cada mês costuma crescer na categoria</strong>
                </li>
              </ul>

              {/* ── 1. O ritmo ── */}
              <div className={styles.comoPasso}>1. Ritmo atual do produto</div>
              <p>
                {/* A frase acompanha o que os números DIZEM. Fixá-la em "vinha fraco e
                    cresceu" mentiria no item que desacelerou. */}
                {tendencia === "subiu"
                  ? "O produto vinha mais fraco no começo do ano e cresceu nos últimos meses. Por isso, usamos:"
                  : tendencia === "caiu"
                  ? "O produto vinha mais forte no começo do ano e desacelerou nos últimos meses. Por isso, usamos:"
                  : "O produto vem mantendo o mesmo ritmo ao longo do ano. A conta mistura as duas leituras:"}
              </p>
              {temPerfil && perfilSazonal && perfilSazonal.ultimoMesReal > 0 && (
                <div className={styles.comoCalc}>
                  <div className={styles.comoCalcLinha}>
                    <span>{pesoPatamarAno}% do ritmo do ano</span>
                    <span>{fmt(perfilSazonal.patamarAno)} un/mês</span>
                  </div>
                  <div className={styles.comoCalcLinha}>
                    <span>
                      {pesoPatamarRecente}% dos últimos {MESES_RECENTES_SAZONAL} meses
                    </span>
                    <span>{fmt(perfilSazonal.patamarRecente)} un/mês</span>
                  </div>
                  <div className={`${styles.comoCalcLinha} ${styles.comoCalcTotal}`}>
                    <span>Ritmo atual estimado</span>
                    <span>
                      <strong>{fmt(perfilSazonal.patamar)} un/mês</strong>
                    </span>
                  </div>
                </div>
              )}
              <p className={styles.comoNota}>
                Assim, a projeção reconhece o movimento recente sem ignorar o restante do ano.
              </p>

              {/* ── 2. A força do mês ── */}
              <div className={styles.comoPasso}>2. Crescimento de novembro e dezembro</div>
              <p>
                Para descobrir a força de cada mês, olhamos a <strong>categoria inteira</strong>
                {temCurva && curvaSazonal ? (
                  <>
                    {" "}
                    nos últimos <strong>{curvaSazonal.anosUsados} anos</strong>
                  </>
                ) : (
                  " nos últimos anos"
                )}
                :
              </p>
              <ul className={styles.comoLista}>
                <li>
                  Novembro é comparado com os{" "}
                  <strong>
                    {curvaSazonal?.anosUsados ?? 3} últimos novembros
                  </strong>
                </li>
                <li>
                  Dezembro é comparado com os{" "}
                  <strong>
                    {curvaSazonal?.anosUsados ?? 3} últimos dezembros
                  </strong>
                </li>
              </ul>
              <p>
                Não usamos a quantidade bruta vendida: verificamos quanto cada mês ficou{" "}
                <strong>acima ou abaixo da média do seu próprio ano</strong>. É isso que impede
                um ano grande de virar “sazonalidade”.
              </p>
              {temCurva && curvaSazonal && (
                <div className={styles.comoTabWrap}>
                  <table className={styles.comoTab}>
                    <thead>
                      <tr>
                        <th>Mês</th>
                        <th>Comportamento histórico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[11, 12].map((m) => {
                        const f = curvaSazonal.fatores[m] ?? 1;
                        return (
                          <tr key={m}>
                            <td>{MES_LONGO[m - 1]}</td>
                            <td>
                              Vende cerca de <strong>{fmtDec(f)}×</strong> um mês normal
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── A projeção ── */}
              {temCurva && curvaSazonal && perfilSazonal && perfilSazonal.ultimoMesReal > 0 && (
                <>
                  <div className={styles.comoPasso}>Projeção</div>
                  <p>Aplicamos esse crescimento sobre o ritmo atual do produto:</p>
                  <div className={styles.comoCalc}>
                    {[11, 12].map((m) => {
                      const f = curvaSazonal.fatores[m] ?? 1;
                      return (
                        <div key={m} className={styles.comoCalcLinha}>
                          <span>
                            {MES_LONGO[m - 1]}: {fmt(perfilSazonal.patamar)} × {fmtDec(f)}
                          </span>
                          <span>
                            <strong>{fmt(perfilSazonal.patamar * f)} un</strong>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className={styles.comoNota}>
                    {tendencia === "subiu"
                      ? "Portanto, mesmo que o ano tenha começado fraco, a projeção considera a melhora recente e o crescimento esperado para o fim do ano."
                      : "A projeção junta o ritmo que o produto tem hoje com o crescimento que a categoria costuma ter no fim do ano."}
                  </p>
                  {!curvaSazonal.confiavel && (
                    <div className={styles.comoAviso}>
                      A curva saiu de {curvaSazonal.anosUsados}{" "}
                      {curvaSazonal.anosUsados === 1 ? "ano fechado" : "anos fechados"} — pouca
                      base. Trate novembro e dezembro como indicação, não como número fechado.
                    </div>
                  )}
                </>
              )}

              {/* Fica porque o KPI "Crescimento vs ano passado" está na tela ao lado e a
                  dúvida aparece sozinha: "por que esse número não entrou na conta?" */}
              <p className={styles.comoOnde}>
                <strong>O crescimento contra {anoBase - 1} não é multiplicado por cima:</strong>{" "}
                o ritmo atual já foi medido nas vendas de {anoBase}. Se o produto cresceu neste
                ano, o crescimento já está dentro desse ritmo — aplicá-lo de novo contaria a
                mesma coisa duas vezes. Ele continua no painel, como informação.
              </p>
            </div>
          )}

          {/* ── 2. Realista ────────────────────────────────────────────────── */}
          {ehRealista && (
            <div className={`${styles.comoRegra} ${styles.comoRegraAtiva}`}>
              <div className={styles.comoRegraTitulo}>
                {regraAtual === "mais10" ? "Conservadora (+10%)" : "Realista (índice YoY)"}
                <span className={styles.comoSelo}>cenário conservador</span>
              </div>
              <p className={styles.comoPergunta}>
                {regraAtual === "mais10"
                  ? `“E se repetirmos ${anoBase - 1} com 10% a mais, ignorando o que o escopo está entregando?”`
                  : `“Se repetirmos os meses de ${anoBase - 1}, corrigidos pelo crescimento deste ano, quanto venderemos?”`}
              </p>
              <p className={styles.comoFormula}>
                projeção do mês = <strong>o mesmo mês de {anoBase - 1}</strong> ×{" "}
                <strong>{regraAtual === "mais10" ? "1,10 (fixo)" : "índice de crescimento"}</strong>
              </p>
              {regraAtual === "mais10" ? (
                <p>
                  O índice é <strong>fixo em 1,10</strong>: não olha o que o escopo está
                  entregando. Serve de piso de comparação — se a régua principal projeta bem
                  acima disto, o crescimento medido é que está mandando.
                </p>
              ) : (
                <p>
                  O índice mistura meio a meio o crescimento do <strong>ano corrido</strong> e o
                  dos <strong>últimos {MESES_JANELA_ATIVIDADE} meses fechados</strong> — essa
                  segunda metade é o que faz a projeção reagir a uma virada recente em vez de
                  ficar presa na média do ano. Os dois são <strong>soma ÷ soma</strong>, não média
                  de percentuais: média de taxas daria o mesmo peso a um mês de base 3 e a um de
                  base 3.000. E o índice fica travado entre {fmtDec(INDICE_MIN)}× e{" "}
                  {fmtDec(INDICE_MAX)}×, senão um item que vendeu 1 peça no ano passado e 40 neste
                  projetaria 40× para o resto do ano.
                </p>
              )}

              {temPerfil && perfil && regraAtual !== "mais10" && (
                <div className={styles.comoNumeros}>
                  <div className={styles.comoNumerosTitulo}>Neste escopo</div>
                  <div className={styles.comoLinha}>
                    <span>
                      Ano corrido ({fechados} {fechados === 1 ? "mês fechado" : "meses fechados"})
                    </span>
                    <span>
                      {fmt(somaAtual)} ÷ {fmt(somaPassada)} ={" "}
                      <strong>{fmtDec(perfil.yoyAno)}×</strong>{" "}
                      <span className={styles.comoDica}>
                        ({fmtPct(perfil.yoyAno == null ? null : perfil.yoyAno - 1)})
                      </span>
                    </span>
                  </div>
                  <div className={styles.comoLinha}>
                    <span>
                      Últimos {MESES_JANELA_ATIVIDADE} meses ({janelaLabel})
                    </span>
                    <span>
                      <strong>{fmtDec(perfil.yoyRecente)}×</strong>{" "}
                      <span className={styles.comoDica}>
                        ({fmtPct(perfil.yoyRecente == null ? null : perfil.yoyRecente - 1)})
                      </span>
                    </span>
                  </div>
                  <div className={styles.comoLinha}>
                    <span>
                      Índice = {pesoAno}% × {fmtDec(perfil.yoyAno)} + {pesoRecente}% ×{" "}
                      {fmtDec(perfil.yoyRecente)}
                    </span>
                    <span>
                      <strong>{fmtDec(perfil.indice)}×</strong>
                    </span>
                  </div>
                  {perfil.anoAnterior[12] > 0 && perfil.indice != null && (
                    <div className={styles.comoLinha}>
                      <span>
                        Dezembro = {fmt(perfil.anoAnterior[12])} (dez/{anoBase - 1}) ×{" "}
                        {fmtDec(perfil.indice)}
                      </span>
                      <span>
                        <strong>{fmt(perfil.anoAnterior[12] * perfil.indice)}</strong> un
                      </span>
                    </div>
                  )}
                  {perfil.indice != null && perfil.indice >= INDICE_MAX && (
                    <div className={styles.comoAviso}>
                      O índice bateu o teto de {fmtDec(INDICE_MAX)}× — o crescimento medido é
                      maior, mas a projeção não passa daí de propósito.
                    </div>
                  )}
                  {perfil.indice != null && perfil.indice <= INDICE_MIN && (
                    <div className={styles.comoAviso}>
                      O índice bateu o piso de {fmtDec(INDICE_MIN)}× — a queda medida é maior, mas
                      a projeção não desce mais de propósito.
                    </div>
                  )}
                </div>
              )}

              <p className={styles.comoOnde}>
                <strong>Onde ela erra:</strong> só conhece <em>um</em> dezembro — o de{" "}
                {anoBase - 1}. Se aquele dezembro foi fraco por acaso, a projeção herda o mês fraco
                e manda comprar de menos bem na virada. “Realista” aqui quer dizer{" "}
                <strong>cenário baseado no desenho do ano passado</strong>, não “mais certa”.
              </p>
            </div>
          )}

          {/* ── 3. Compra Ideal ────────────────────────────────────────────── */}
          {ehIdeal && (
            <div className={`${styles.comoRegra} ${styles.comoRegraAtiva}`}>
              <div className={styles.comoRegraTitulo}>
                Ritmo Compra Ideal
                <span className={styles.comoSelo}>reposição item a item</span>
              </div>
              <p className={styles.comoPergunta}>
                “Enquanto o item estava <em>disponível</em>, quantas unidades ele vendia por dia?”
              </p>
              <p className={styles.comoFormula}>
                projeção = <strong>consumo/dia com estoque</strong> ×{" "}
                <strong>dias do horizonte</strong>
              </p>
              <p>
                Estoque zerado impede venda, e dividir por dias corridos joga essa falta contra o
                produto. Um item que vendeu 140 peças em 35 dias com estoque consome{" "}
                <strong>4/dia</strong>; dividido pelos 60 dias corridos do período pareceria vender{" "}
                <strong>2,3/dia</strong> — e a reposição viria pela metade. Por isso a conta usa{" "}
                <strong>o maior trecho contínuo com estoque</strong> (teto de 60 dias), com divisor
                mínimo de 30 para que duas vendas numa semana não virem ritmo de foguete.
              </p>
              <p>
                É a mesma régua da <strong>Curva ABC</strong> e do “comprar agora” — existe para as
                duas telas falarem a mesma língua. Vêm de carona os resgates dela: trecho que ficou
                velho cede lugar ao trecho recente, e trecho sem venda cede lugar à venda recente,
                em vez de zerar o consumo de um item que está vendendo.
              </p>
              {consumoIdeal != null && consumoIdeal > 0 && !!diasHorizonte && (
                <div className={styles.comoNumeros}>
                  <div className={styles.comoNumerosTitulo}>Neste escopo</div>
                  <div className={styles.comoLinha}>
                    <span>Consumo do escopo (soma dos itens) × {fmt(diasHorizonte)} dias</span>
                    <span>
                      <strong>{fmtDec(consumoIdeal)}</strong>/dia ={" "}
                      <strong>{fmt(consumoIdeal * diasHorizonte)}</strong> un
                    </span>
                  </div>
                </div>
              )}
              <p className={styles.comoOnde}>
                <strong>Onde ela erra:</strong> não sabe que dezembro vende mais que fevereiro —
                são 4/dia nos dois. Ótima para repor item a item no dia a dia, incompleta para uma
                compra de Natal.
              </p>
            </div>
          )}

          {/* ── 4. Janelas ─────────────────────────────────────────────────── */}
          {ehJanela && (
            <div className={`${styles.comoRegra} ${styles.comoRegraAtiva}`}>
              <div className={styles.comoRegraTitulo}>
                {janelaEscolhida === 365 ? "Ritmo 12 meses" : `Ritmo ${janelaEscolhida} dias`}
                <span className={styles.comoSelo}>conferência</span>
              </div>
              <p className={styles.comoPergunta}>
                “E se os próximos {diasHorizonte ? fmt(diasHorizonte) : "N"} dias forem iguais aos
                últimos {janelaEscolhida}?”
              </p>
              <p className={styles.comoFormula}>
                projeção = <strong>vendas dos últimos {janelaEscolhida} dias ÷ {janelaEscolhida}</strong>{" "}
                × <strong>dias do horizonte</strong>
              </p>
              <p>
                A janela cobre os {janelaEscolhida} dias <strong>anteriores</strong> à data base —
                o próprio dia da base fica de fora, porque costuma ser um “hoje” pela metade.
              </p>
              {janelas && !!diasHorizonte && (
                <div className={styles.comoNumeros}>
                  <div className={styles.comoNumerosTitulo}>
                    Neste escopo — as outras janelas ficam para comparação
                  </div>
                  {JANELAS_DIAS.map((dias) => {
                    const un = Number(janelas?.[dias] ?? 0);
                    if (!un) return null;
                    return (
                      <div
                        key={dias}
                        className={`${styles.comoLinha} ${
                          dias === janelaEscolhida ? styles.comoLinhaDestaque : ""
                        }`}
                      >
                        <span>
                          {fmt(un)} un ÷ {dias} dias = {fmtDec(ritmoJanela(dias))}/dia
                        </span>
                        <span>
                          <strong>{fmt(ritmoJanela(dias) * diasHorizonte)}</strong> un
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className={styles.comoOnde}>
                <strong>Onde ela erra:</strong> não enxerga falta de estoque, crescimento, novembro
                forte, Natal nem janeiro fraco — todo dia vale igual. Serve de termômetro: “a régua
                principal está longe demais do ritmo que estamos vendo agora?”. Se a data base
                fosse dezembro, ela projetaria janeiro no ritmo do Natal.
              </p>
            </div>
          )}

          {/* ── Como o horizonte é somado ──────────────────────────────────── */}
          <div className={styles.comoNumerosTitulo}>Como calculamos a venda até {ymdToBr(venderAte)}</div>
          <p>
            A projeção é feita <strong>mês a mês</strong>.
            {dataBase && diasHorizonte ? (
              <>
                {" "}
                De {ymdToBr(dataBase)} a {ymdToBr(venderAte)} são{" "}
                <strong>{fmt(diasHorizonte)} dias</strong>:
              </>
            ) : null}
          </p>
          {dataBase && venderAte && diasHorizonte ? (
            <div className={styles.comoTabWrap}>
              <table className={styles.comoTab}>
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Como entra na conta</th>
                  </tr>
                </thead>
                <tbody>
                  {mesesDoHorizonte.map((m) => (
                    <tr key={`${m.ano}-${m.mes}`}>
                      <td>
                        {MES_LONGO[m.mes - 1]}
                        {m.ano !== Number(dataBase.slice(0, 4)) ? ` de ${m.ano}` : ""}
                      </td>
                      <td>
                        {m.inteiro ? (
                          "Mês inteiro"
                        ) : (
                          <>
                            Somente os <strong>{m.dias} dias</strong>{" "}
                            {m.primeiro ? "restantes" : "iniciais"}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p>
            No mês atual, o sistema <strong>nunca projeta menos do que já foi vendido</strong>.
          </p>
          <div className={styles.comoCalc}>
            <div className={styles.comoCalcLinha}>
              <span>Projeção do mês</span>
              <span>100 un</span>
            </div>
            <div className={styles.comoCalcLinha}>
              <span>Já vendido no mês</span>
              <span>120 un</span>
            </div>
            <div className={`${styles.comoCalcLinha} ${styles.comoCalcTotal}`}>
              <span>Valor considerado</span>
              <span>
                <strong>120 un</strong>
              </span>
            </div>
          </div>
          <p className={styles.comoNota}>
            E se o produto não vendeu nada nos últimos {MESES_RECENTES_SAZONAL} meses fechados, a
            projeção é <strong>zero</strong> — o sistema não sugere compra para o que deixou de
            vender.
          </p>

          {/* ── Da projeção para a compra ──────────────────────────────────── */}
          <div className={styles.comoNumerosTitulo}>Da projeção para a compra</div>
          <p className={styles.comoDestaque}>
            Projetar 1.000 vendas não significa comprar 1.000 peças.
          </p>
          <p>
            A projeção mostra quantas peças devem <strong>sair</strong>. Para saber quanto
            comprar, entram também o estoque atual, o que já está em trânsito e o estoque
            necessário para os {fmt(cobertura)} dias seguintes:
          </p>
          <p className={styles.comoFormula}>
            comprar = <strong>venda até {ymdToBr(venderAte)}</strong> +{" "}
            <strong>venda dos {fmt(cobertura)} dias seguintes</strong> −{" "}
            <strong>estoque atual</strong> − <strong>em trânsito</strong>
          </p>
          <div className={styles.comoCalc}>
            <div className={styles.comoCalcLinha}>
              <span>Venda prevista até {ymdToBr(venderAte)}</span>
              <span>1.000</span>
            </div>
            <div className={styles.comoCalcLinha}>
              <span>Necessidade para os próximos {fmt(cobertura)} dias</span>
              <span>+ 600</span>
            </div>
            <div className={styles.comoCalcLinha}>
              <span>Estoque atual</span>
              <span>− 400</span>
            </div>
            <div className={styles.comoCalcLinha}>
              <span>Em trânsito</span>
              <span>− 300</span>
            </div>
            <div className={`${styles.comoCalcLinha} ${styles.comoCalcTotal}`}>
              <span>Compra necessária</span>
              <span>
                <strong>900</strong>
              </span>
            </div>
          </div>
          <ul className={styles.comoLista}>
            <li>
              As <strong>1.000</strong> atravessam o fim do ano sem faltar produto.
            </li>
            <li>
              As <strong>600</strong> são o estoque que deve <em>permanecer</em> em{" "}
              {ymdToBr(venderAte)} para sustentar os {fmt(cobertura)} dias seguintes.
            </li>
            <li>
              {/* O número mais mal-entendido da tela: parecia constante do sistema. */}
              Os <strong>{fmt(cobertura)} dias</strong> não são fixos — vêm da regra{" "}
              <strong>{coberturaGrupo ?? "padrão"}</strong> da tela{" "}
              <strong>Ciclo de Compra</strong>, que é editável e vale por categoria (Seda 90,
              Lenços Brasil 60, Eletrônicos 30…).
            </li>
            <li>
              Estoque e trânsito são descontados porque essas peças já existem ou já foram
              compradas. Resultado negativo vira <strong>zero</strong>.
            </li>
          </ul>

          {/* ── As outras réguas, em uma linha cada ────────────────────────── */}
          <div className={styles.comoNumerosTitulo}>Outras réguas disponíveis</div>
          <div className={styles.comoTabWrap}>
            <table className={styles.comoTab}>
              <thead>
                <tr>
                  <th>Régua</th>
                  <th>O que mostra</th>
                </tr>
              </thead>
              <tbody>
                {REGUAS.map((r) => (
                  <tr key={r.nome} className={r === identidade ? styles.comoLinhaAtiva : ""}>
                    <td>
                      <strong>{r.nome}</strong>
                      {r === identidade && <span className={styles.comoSelo}>escolhida</span>}
                    </td>
                    <td>{r.mostra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.comoNota}>
            Ao trocar a régua, mudam a projeção e esta explicação.
          </p>
        </div>
      )}
    </div>
  );
}
