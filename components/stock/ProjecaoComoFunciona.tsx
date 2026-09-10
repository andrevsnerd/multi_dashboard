"use client";

import { useState } from "react";

import {
  INDICE_MAX,
  INDICE_MIN,
  MESES_JANELA_ATIVIDADE,
  PESO_JANELA_RECENTE,
  type PerfilProjecao,
} from "@/lib/utils/projecao-realista";

import styles from "./ProjecaoCompraPage.module.css";

/**
 * "Como a projeção é calculada" — a régua da tela escrita em português, recolhível.
 *
 * Existe porque os números da Projeção Compra não são extrapolação de ritmo, e sem essa
 * explicação ninguém adivinha: um item que vendeu 20/mês pode projetar 60 em novembro
 * simplesmente porque novembro do ano passado foi três vezes maior que a média. O KPI do
 * índice também não se defende sozinho ("+100%" ao lado de "índice 2,00" parecia erro).
 *
 * Quando recebe o `perfil` do escopo, mostra a conta COM OS NÚMEROS DELE, não só a fórmula.
 */

interface Props {
  /** Perfil do escopo já gerado — sem ele o bloco mostra só a regra geral. */
  perfil?: PerfilProjecao | null;
  anoBase: number;
}

function fmtDec(n: number | null | undefined, dec = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
const MES_NOME = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function ProjecaoComoFunciona({ perfil, anoBase }: Props) {
  const [aberto, setAberto] = useState(false);

  const pesoAno = Math.round((1 - PESO_JANELA_RECENTE) * 100);
  const pesoRecente = Math.round(PESO_JANELA_RECENTE * 100);

  // Soma dos meses fechados, para mostrar a razão de somas com os números reais do escopo.
  const fechados = perfil ? perfil.ultimoMesReal : 0;
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

  return (
    <div className={styles.comoCard}>
      <button
        type="button"
        className={styles.comoToggle}
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <span className={styles.comoCaret}>{aberto ? "▾" : "▸"}</span>
        Como a projeção é calculada
        <span className={styles.comoResumo}>
          {aberto
            ? "a régua desta tela, em português"
            : "não é ritmo esticado — é a curva do ano anterior corrigida por um índice"}
        </span>
      </button>

      {aberto && (
        <div className={styles.comoCorpo}>
          <p>
            <strong>A projeção não estica o ritmo.</strong> Multiplicar a média dos últimos 60
            dias pelo horizonte daria errado em qualquer negócio sazonal: novembro e dezembro
            pesam muito mais que janeiro, e uma média não sabe disso. Em vez disso a conta
            mantém a <strong>curva do ano anterior</strong> — é ela que carrega a sazonalidade —
            e corrige só o <strong>patamar</strong>.
          </p>

          <p className={styles.comoFormula}>
            projeção de um mês = <strong>quanto vendeu naquele mês em {anoBase - 1}</strong> ×{" "}
            <strong>índice</strong>
          </p>

          <p>
            O <strong>índice</strong> é o quanto o escopo está entregando a mais (ou a menos) que
            no ano passado. Ele mistura duas leituras, meio a meio:
          </p>
          <ul className={styles.comoLista}>
            <li>
              <strong>{pesoAno}% — o ano corrido:</strong> tudo o que vendeu nos meses já
              fechados de {anoBase} dividido pelos mesmos meses de {anoBase - 1}.
            </li>
            <li>
              <strong>{pesoRecente}% — os últimos {MESES_JANELA_ATIVIDADE} meses fechados:</strong>{" "}
              a mesma divisão, só nesse trecho. É o que faz a projeção reagir a uma virada
              recente em vez de ficar presa na média do ano.
            </li>
          </ul>

          <p>
            As duas são <strong>razão de somas</strong>, não média de percentuais — média de
            taxas daria o mesmo peso a um mês de base 3 e a um de base 3.000. E o índice fica{" "}
            <strong>travado entre {fmtDec(INDICE_MIN)} e {fmtDec(INDICE_MAX)}</strong>: sem a
            trava, um item que vendeu 1 peça no ano passado e 40 neste ano projetaria um
            crescimento de 40× para o resto do ano.
          </p>

          {perfil && fechados > 0 && (
            <div className={styles.comoNumeros}>
              <div className={styles.comoNumerosTitulo}>Com os números deste escopo</div>
              <div className={styles.comoLinha}>
                <span>Ano corrido ({fechados} {fechados === 1 ? "mês fechado" : "meses fechados"})</span>
                <span>
                  {fmt(somaAtual)} ÷ {fmt(somaPassada)} ={" "}
                  <strong>{fmtDec(perfil.yoyAno)}</strong>
                </span>
              </div>
              <div className={styles.comoLinha}>
                <span>Últimos {MESES_JANELA_ATIVIDADE} meses ({janelaLabel})</span>
                <span>
                  <strong>{fmtDec(perfil.yoyRecente)}</strong>
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
              {perfil.indice != null && perfil.indice >= INDICE_MAX && (
                <div className={styles.comoAviso}>
                  O índice bateu o teto de {fmtDec(INDICE_MAX)}× — o crescimento medido é maior
                  que isso, mas a projeção não passa daí de propósito.
                </div>
              )}
              {perfil.indice != null && perfil.indice <= INDICE_MIN && (
                <div className={styles.comoAviso}>
                  O índice bateu o piso de {fmtDec(INDICE_MIN)}× — a queda medida é maior que
                  isso, mas a projeção não desce mais de propósito.
                </div>
              )}
            </div>
          )}

          <div className={styles.comoNumerosTitulo}>Os casos de exceção</div>
          <ul className={styles.comoLista}>
            <li>
              <strong>Mês sem base no ano anterior</strong> (item novo, coleção que não existia):
              não há curva para corrigir, então vale a <strong>média dos últimos{" "}
              {MESES_JANELA_ATIVIDADE} meses fechados</strong>.
            </li>
            <li>
              <strong>Escopo parado</strong> — nada vendido nos últimos{" "}
              {MESES_JANELA_ATIVIDADE} meses fechados: projeta <strong>0</strong>. Não se compra
              para o que morreu.
            </li>
            <li>
              <strong>Mês em curso</strong>: entra pela projeção do mês CHEIO, não pelo pedaço já
              realizado — e fica fora do índice, porque comparar meio mês com um mês inteiro do
              ano passado contamina a conta.
            </li>
            <li>
              <strong>Horizonte com ponta quebrada</strong>: o mês da data base entra só pelos
              dias que faltam dele (pro-rata), e o mesmo vale para o mês onde o horizonte termina.
            </li>
          </ul>

          <div className={styles.comoNumerosTitulo}>As outras regras do select</div>
          <ul className={styles.comoLista}>
            <li>
              <strong>Projeção conservadora (+10%)</strong>: mesma curva do ano anterior, mas com
              índice fixo em 1,10 — ignora o que o escopo está entregando. Serve de piso de
              comparação.
            </li>
            <li>
              <strong>Ritmo 30 / 60 / 90 / 120 dias / 12 meses</strong>: aí sim é ritmo esticado —
              o que saiu na janela dividido pelos dias dela, multiplicado pelo horizonte.{" "}
              <strong>Não tem sazonalidade</strong> e existe para conferência, não para decidir
              compra de fim de ano.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
