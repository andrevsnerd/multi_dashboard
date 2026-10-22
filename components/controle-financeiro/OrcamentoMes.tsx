"use client";

import { Fragment, useEffect, useState } from "react";

import { GRUPOS_ORCAMENTO } from "@/lib/config/orcamento-despesas";
import type { LinhaOrcamentoMes, OrcamentoMes as Resposta } from "@/lib/financeiro/orcamento-mes";

import { brl, compacto, dataBr, percentual, useFinanceiroApi } from "./shared";
import styles from "./ControleFinanceiro.module.css";

interface Props {
  companyKey: string;
  /** Até quando a planilha da Débora tem lançamentos (data de atualização das abas). */
  dataRef: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const nomeMes = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const diaMes = (iso: string) => dataBr(iso).slice(0, 5);

interface Totais {
  orcado: number;
  mtd: number;
  agendado: number;
}

const somar = (linhas: LinhaOrcamentoMes[]): Totais =>
  linhas.reduce(
    (t, l) => ({ orcado: t.orcado + (l.orcado ?? 0), mtd: t.mtd + l.mtd, agendado: t.agendado + l.agendado }),
    { orcado: 0, mtd: 0, agendado: 0 }
  );

/** Estourou = já passou do orçado; risco = passa com o que já está agendado. */
function situacao(t: Totais): "estourou" | "risco" | "ok" {
  if (t.mtd > t.orcado + 0.005) return "estourou";
  if (t.mtd + t.agendado > t.orcado + 0.005) return "risco";
  return "ok";
}

/**
 * Pedido do Hélio para a parte de despesa: MTD, saldo do mês e saldo por dia, por linha
 * do budget. Orçado = planilha do budget (cenário base); realizado = base do Controle
 * Financeiro pela data caixa.
 */
export default function OrcamentoMes({ companyKey, dataRef }: Props) {
  const api = useFinanceiroApi(companyKey);
  // A posição padrão é o último dia com dado real (data da planilha da Débora), não
  // hoje: entre a atualização e hoje não se sabe o que saiu do caixa.
  const ultimaAtualizacao = dataRef ? dataRef.slice(0, 10) : hojeLocal();
  const [posicao, setPosicao] = useState(ultimaAtualizacao);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!api.pronto || !/^\d{4}-\d{2}-\d{2}$/.test(posicao)) return;
    let vivo = true;
    api
      .get<Resposta>("/orcamento-mes", { posicao })
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro ao carregar"));
    return () => {
      vivo = false;
    };
  }, [api, posicao]);

  if (erro) return <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>;
  if (!dados) return <div className={styles.aviso}>Carregando o orçamento do mês…</div>;

  const carregando = dados.posicao !== posicao;
  const total = somar(dados.linhas);
  const saldo = total.orcado - total.mtd;
  const dias = dados.diasRestantes;
  const decorrido = (dados.diasNoMes - dias) / dados.diasNoMes;
  const ultimoDia = `${dados.mes.slice(0, 8)}${pad(dados.diasNoMes)}`;
  const amanha = `${dados.mes.slice(0, 8)}${pad(dados.diasNoMes - dias + 1)}`;
  const diasTexto =
    dias === 0
      ? "mês encerrado nesta posição"
      : dias === 1
        ? `1 dia restante (${diaMes(ultimoDia)})`
        : `${dias} dias restantes (${diaMes(amanha)} a ${diaMes(ultimoDia)})`;

  const alternar = (key: string) =>
    setAbertas((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div className={`${styles.corpo} ${carregando ? styles.carregando : ""}`}>
      <div className={styles.filtros}>
        <label className={styles.campo}>
          <span>Posição em</span>
          <input
            type="date"
            className={styles.input}
            value={posicao}
            max={ultimaAtualizacao}
            onChange={(e) => e.target.value && setPosicao(e.target.value)}
          />
        </label>
        {posicao !== ultimaAtualizacao && (
          <button type="button" className={styles.btn} onClick={() => setPosicao(ultimaAtualizacao)}>
            Última atualização
          </button>
        )}
      </div>

      {dataRef && (
        <div className={`${styles.aviso} ${styles.avisoInfo}`}>
          Dados reais até <b>{dataBr(ultimaAtualizacao)}</b>, a data da planilha da Débora. O MTD vai até a posição e o
          saldo por dia divide o saldo pelos dias do mês depois dela; o que saiu do caixa depois disso só aparece quando a
          planilha for atualizada.
        </div>
      )}

      {!dados.temOrcado ? (
        <div className={styles.aviso}>
          Sem orçado para {nomeMes(dados.mes)}: o budget cobre de outubro de 2026 a dezembro de 2027.
        </div>
      ) : (
        <>
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Orçado · {nomeMes(dados.mes)}</span>
              <span className={styles.kpiValue}>{compacto(total.orcado)}</span>
              <span className={styles.kpiFoot}>budget, cenário base</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>MTD · gasto até {diaMes(dados.posicao)}</span>
              <span className={styles.kpiValue}>{compacto(total.mtd)}</span>
              <span className={styles.kpiFoot}>
                <b>{percentual(total.orcado ? total.mtd / total.orcado : null)}</b> do orçado ·{" "}
                {percentual(decorrido, 0)} do mês decorrido
              </span>
            </div>
            <div className={`${styles.kpi} ${styles.kpiAccent}`}>
              <span className={styles.kpiLabel}>Saldo do mês</span>
              <span className={`${styles.kpiValue} ${saldo < 0 ? styles.neg : ""}`}>{compacto(saldo)}</span>
              <span className={styles.kpiFoot}>
                {saldo < 0 ? "acima do orçado" : "o que falta para estourar"} · agendado até o fim do mês{" "}
                <b>{compacto(total.agendado)}</b>
              </span>
            </div>
            <div className={`${styles.kpi} ${styles.kpiAccent}`}>
              <span className={styles.kpiLabel}>Meta diária</span>
              <span className={`${styles.kpiValue} ${saldo < 0 ? styles.neg : ""}`}>
                {dias === 0 ? "—" : saldo < 0 ? "estourado" : compacto(saldo / dias)}
              </span>
              <span className={styles.kpiFoot}>{dias === 0 ? diasTexto : `por dia · ${diasTexto}`}</span>
            </div>
          </div>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Despesas × orçado · {nomeMes(dados.mes)}</h2>
              <span className={styles.cardNote}>
                realizado pela data caixa das abas da planilha da Débora · clique numa linha para ver a abertura
              </span>
            </div>
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <i className={`${styles.swatch} ${styles.ocSegGasto}`} /> gasto até {diaMes(dados.posicao)} (MTD)
              </span>
              <span className={styles.legendItem}>
                <i className={`${styles.swatch} ${styles.ocSegAgendado}`} /> agendado até o fim do mês
              </span>
              <span className={styles.legendItem}>
                <i className={`${styles.swatch} ${styles.ocSegRisco}`} /> o que o agendado passa do orçado
              </span>
              <span className={styles.legendItem}>
                <i className={`${styles.swatch} ${styles.ocSegEstouro}`} /> o que o gasto já passou do orçado
              </span>
              <span className={styles.legendItem}>barra inteira = orçado da linha</span>
            </div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.ocTable}`}>
                <thead>
                  <tr>
                    <th>Linha do budget</th>
                    <th className={styles.num}>Orçado</th>
                    <th className={styles.num}>MTD</th>
                    <th className={styles.ocBarraCol}>Situação</th>
                    <th className={styles.num}>Saldo do mês</th>
                    <th className={styles.num}>Saldo por dia</th>
                    <th className={styles.num} title="Vence depois da posição, já lançado na planilha. Não entra no saldo.">
                      Agendado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {GRUPOS_ORCAMENTO.map((g) => {
                    const linhas = dados.linhas.filter((l) => l.grupo === g.key);
                    if (!linhas.length) return null;
                    return (
                      <Fragment key={g.key}>
                        <tr className={styles.ocGrupo}>
                          <td colSpan={7}>{g.label}</td>
                        </tr>
                        {linhas.map((l) => (
                          <Fragment key={l.key}>
                            <Linha
                              rotulo={l.label}
                              sub={l.referencia}
                              ressalva={l.ressalva}
                              t={{ orcado: l.orcado ?? 0, mtd: l.mtd, agendado: l.agendado }}
                              dias={dias}
                              aberta={abertas.has(l.key)}
                              onClick={l.itens.length ? () => alternar(l.key) : undefined}
                            />
                            {abertas.has(l.key) &&
                              l.itens.map((i) => (
                                <tr key={`${i.aba}|${i.classificacao}`} className={styles.ocItem}>
                                  <td>
                                    {i.classificacao || <span className={styles.muted}>(sem classificação)</span>}
                                    <span className={styles.ocSub}>
                                      aba {i.aba} · {i.n} lançamento(s)
                                    </span>
                                  </td>
                                  <td />
                                  <td className={styles.num}>{brl(i.mtd)}</td>
                                  <td />
                                  <td />
                                  <td />
                                  <td className={`${styles.num} ${styles.muted}`}>{i.agendado ? brl(i.agendado) : "—"}</td>
                                </tr>
                              ))}
                          </Fragment>
                        ))}
                        <Linha rotulo={`Total · ${g.label.toLowerCase()}`} t={somar(linhas)} dias={dias} subtotal />
                      </Fragment>
                    );
                  })}
                  <Linha rotulo="Total das despesas" t={total} dias={dias} total />
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {dados.fora.length > 0 && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Saídas fora do budget</h2>
            <span className={styles.cardNote}>lançamentos do mês que não caem em nenhuma linha acima</span>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Aba</th>
                  <th>Classificação</th>
                  <th className={styles.num}>MTD</th>
                  <th className={styles.num}>Agendado</th>
                </tr>
              </thead>
              <tbody>
                {dados.fora.map((i) => (
                  <tr key={`${i.aba}|${i.classificacao}`}>
                    <td>{i.aba}</td>
                    <td>{i.classificacao || <span className={styles.muted}>(sem classificação)</span>}</td>
                    <td className={styles.num}>{brl(i.mtd)}</td>
                    <td className={styles.num}>{brl(i.agendado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className={styles.ocNota}>
        Saldo do mês = orçado − MTD. Saldo por dia = saldo do mês ÷ dias que faltam depois da posição. “Estourou”: o gasto
        já passou do orçado. “Estoura com agendado”: ainda está dentro, mas passa do orçado se o que já está agendado
        sair. A taxa de cartão fica fora: não tem
        lançamento nas abas da planilha (sai calculada na DRE) e acompanha a receita.
      </p>
    </div>
  );
}

function Linha({
  rotulo,
  sub,
  ressalva,
  t,
  dias,
  aberta,
  onClick,
  subtotal,
  total,
}: {
  rotulo: string;
  sub?: string;
  ressalva?: string | null;
  t: Totais;
  dias: number;
  aberta?: boolean;
  onClick?: () => void;
  subtotal?: boolean;
  total?: boolean;
}) {
  const saldo = t.orcado - t.mtd;
  const sit = situacao(t);
  const consumo = t.orcado > 0 ? t.mtd / t.orcado : null;
  const cls = total ? styles.dreResultado : subtotal ? styles.dreTotal : onClick ? styles.rowClick : undefined;

  return (
    <tr className={cls} onClick={onClick}>
      <td>
        {onClick && <span className={styles.ocSeta}>{aberta ? "▾" : "▸"}</span>}
        {rotulo}
        {sub && <span className={styles.ocSub}>{sub}</span>}
        {ressalva && <span className={`${styles.ocSub} ${styles.warn}`}>{ressalva}</span>}
      </td>
      <td className={styles.num}>{brl(t.orcado)}</td>
      <td className={styles.num}>{brl(t.mtd)}</td>
      <td className={styles.ocBarraCol}>
        <Situacao t={t} sit={sit} consumo={consumo} />
      </td>
      <td className={`${styles.num} ${saldo < 0 ? styles.crit : ""}`}>{brl(saldo)}</td>
      <td className={`${styles.num} ${saldo < 0 ? styles.crit : ""}`}>
        {dias === 0 ? "—" : saldo < 0 ? "estourado" : brl(saldo / dias)}
      </td>
      <td className={`${styles.num} ${styles.muted}`}>{t.agendado ? brl(t.agendado) : "—"}</td>
    </tr>
  );
}

/**
 * Barra = orçado da linha. Quando gasto + agendado passa do orçado, a escala cresce e a
 * sobra aparece no fim da barra: vermelha se já foi gasta, âmbar se ainda vai sair.
 */
function Situacao({ t, sit, consumo }: { t: Totais; sit: ReturnType<typeof situacao>; consumo: number | null }) {
  const previsto = t.mtd + t.agendado;
  if (t.orcado <= 0 && previsto <= 0) return <span className={styles.muted}>—</span>;
  const escala = Math.max(t.orcado, previsto);
  const pct = (v: number) => `${(Math.max(0, v) / escala) * 100}%`;
  const gastoDentro = Math.min(t.mtd, t.orcado);
  const gastoFora = t.mtd - gastoDentro;
  const agendadoDentro = Math.min(previsto, t.orcado) - gastoDentro;
  const agendadoFora = previsto - Math.max(t.mtd, t.orcado);

  return (
    <div className={styles.ocSituacao}>
      <div className={styles.ocTrilho}>
        <i className={styles.ocSegGasto} style={{ width: pct(gastoDentro) }} />
        <i className={styles.ocSegEstouro} style={{ width: pct(gastoFora) }} />
        <i className={styles.ocSegAgendado} style={{ width: pct(agendadoDentro) }} />
        <i className={styles.ocSegRisco} style={{ width: pct(agendadoFora) }} />
      </div>
      <div className={styles.ocSituacaoTexto}>
        <span className={styles.muted}>{consumo == null ? "sem orçado" : `${percentual(consumo, 0)} gasto`}</span>
        {sit === "estourou" ? (
          <span className={`${styles.pill} ${styles.pillRemovido}`}>estourou +{compacto(t.mtd - t.orcado)}</span>
        ) : sit === "risco" ? (
          <span className={`${styles.pill} ${styles.pillPendente}`}>estoura com agendado +{compacto(previsto - t.orcado)}</span>
        ) : (
          <span className={`${styles.pill} ${styles.pillPago}`}>dentro</span>
        )}
      </div>
    </div>
  );
}
