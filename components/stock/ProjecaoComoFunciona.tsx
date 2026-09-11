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
  /** Curva sazonal da categoria, quando ela foi medida. */
  curvaSazonal?: CurvaSazonal | null;
  /** Patamar do escopo na régua sazonal, quando ela foi medida. */
  perfilSazonal?: PerfilSazonal | null;
}

function fmtDec(n: number | null | undefined, dec = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
const MES_NOME = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function ProjecaoComoFunciona({
  perfil,
  anoBase,
  curvaSazonal,
  perfilSazonal,
}: Props) {
  const [aberto, setAberto] = useState(false);

  const pesoPatamarAno = Math.round((1 - PESO_RECENTE_SAZONAL) * 100);
  const pesoPatamarRecente = Math.round(PESO_RECENTE_SAZONAL * 100);
  /** A curva foi medida e tem pelo menos um ano completo de base. */
  const temCurva = (curvaSazonal?.anosUsados ?? 0) > 0;

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

          <div className={styles.comoNumerosTitulo}>
            Sazonal da categoria — a régua de fim de ano
          </div>
          <p>
            As duas regras acima herdam a sazonalidade de <strong>uma única amostra</strong>: o
            mesmo mês do ano passado. Se o novembro passado foi fraco por acaso, a projeção manda
            comprar de menos justo na virada. A regra sazonal separa as duas perguntas e responde
            cada uma onde existe amostra para respondê-la:
          </p>
          <p className={styles.comoFormula}>
            projeção de um mês = <strong>patamar do escopo em {anoBase}</strong> ×{" "}
            <strong>fator daquele mês na categoria</strong>
          </p>
          <ul className={styles.comoLista}>
            <li>
              <strong>O patamar (quanto) sai do próprio escopo.</strong> Cada mês fechado de{" "}
              {anoBase} é dividido pelo fator sazonal dele — isso limpa o efeito do calendário e
              deixa o nível puro. A média desses meses é{" "}
              <strong>{pesoPatamarAno}% do ano corrido</strong> +{" "}
              <strong>
                {pesoPatamarRecente}% dos últimos {MESES_RECENTES_SAZONAL} meses fechados
              </strong>
              : a primeira metade é o que ele veio fazendo no ano, a segunda é o que ele está
              fazendo agora.
            </li>
            <li>
              <strong>A curva (quando) sai da CATEGORIA.</strong> Subgrupo (ou linha, ou grupo)
              inteiro, em anos-calendário fechados, cada ano normalizado sozinho e o mais recente
              pesando mais. Um produto sozinho não tem dezembros suficientes para provar nada; o
              subgrupo tem anos deles.
            </li>
            <li>
              <strong>O crescimento contra o ano passado não é multiplicado</strong> — o patamar
              já vem das vendas deste ano, então aplicá-lo por cima contaria o mesmo crescimento
              duas vezes. Ele continua no KPI, como leitura.
            </li>
            <li>
              Mês <strong>anterior à primeira venda</strong> fica fora do patamar (item que ainda
              não existia não é mês fraco). Escopo sem venda nos últimos{" "}
              {MESES_RECENTES_SAZONAL} meses fechados projeta <strong>0</strong>, igual às outras.
            </li>
          </ul>

          {temCurva && curvaSazonal && (
            <div className={styles.comoNumeros}>
              <div className={styles.comoNumerosTitulo}>
                Com os números deste escopo — categoria{" "}
                {curvaSazonal.chave === "__ESCOPO__" ? "do recorte" : curvaSazonal.chave}
              </div>
              <div className={styles.comoLinha}>
                <span>
                  Base da curva ({curvaSazonal.anosUsados}{" "}
                  {curvaSazonal.anosUsados === 1 ? "ano completo" : "anos completos"})
                </span>
                <span>
                  <strong>{fmt(curvaSazonal.volumeBase)}</strong> un
                </span>
              </div>
              <div className={styles.comoLinha}>
                <span>Novembro vale, contra o mês médio</span>
                <span>
                  <strong>{fmtDec(curvaSazonal.fatores[11])}×</strong>
                </span>
              </div>
              <div className={styles.comoLinha}>
                <span>Dezembro vale, contra o mês médio</span>
                <span>
                  <strong>{fmtDec(curvaSazonal.fatores[12])}×</strong>
                </span>
              </div>
              {perfilSazonal && perfilSazonal.ultimoMesReal > 0 && (
                <>
                  <div className={styles.comoLinha}>
                    <span>
                      Patamar = {pesoPatamarAno}% × {fmt(perfilSazonal.patamarAno)} +{" "}
                      {pesoPatamarRecente}% × {fmt(perfilSazonal.patamarRecente)}
                    </span>
                    <span>
                      <strong>{fmt(perfilSazonal.patamar)}</strong> un/mês
                    </span>
                  </div>
                  <div className={styles.comoLinha}>
                    <span>Dezembro projetado</span>
                    <span>
                      <strong>
                        {fmt(perfilSazonal.patamar * (curvaSazonal.fatores[12] ?? 1))}
                      </strong>{" "}
                      un
                    </span>
                  </div>
                </>
              )}
              {!curvaSazonal.confiavel && (
                <div className={styles.comoAviso}>
                  A curva saiu de {curvaSazonal.anosUsados}{" "}
                  {curvaSazonal.anosUsados === 1 ? "ano completo" : "anos completos"} — pouca base.
                  Trate o fator de novembro e dezembro como indicação, não como número fechado.
                </div>
              )}
            </div>
          )}

          <div className={styles.comoNumerosTitulo}>As outras regras do select</div>
          <ul className={styles.comoLista}>
            <li>
              <strong>Projeção conservadora (+10%)</strong>: mesma curva do ano anterior, mas com
              índice fixo em 1,10 — ignora o que o escopo está entregando. Serve de piso de
              comparação.
            </li>
            <li>
              <strong>Ritmo Compra Ideal (igual à Curva ABC)</strong>: <em>não olha o ano
              passado</em>. Usa o mesmo consumo/dia que decide a compra no dia a dia — as vendas
              do <strong>maior trecho contínuo com estoque positivo</strong> nos últimos 12 meses
              (teto de 60 dias), e não dias corridos, para que um item que ficou meses zerado não
              tenha o ritmo diluído. Vêm de carona os mesmos resgates da Compra Ideal: quando o
              maior trecho ficou velho, vale o trecho recente; quando ele teve zero venda mas o
              item vendeu há pouco, o consumo é reativado em vez de zerar. A projeção é{" "}
              <strong>consumo/dia × dias do horizonte</strong>, sem sazonalidade. Serve para a
              Projeção Compra falar a mesma língua da Curva ABC — e por medir item a item, ela
              liga o detalhe por item sozinha.
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
