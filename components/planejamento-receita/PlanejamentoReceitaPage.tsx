"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import type { PlanejamentoReceitaResponse } from "@/lib/types/planejamento-receita";

import {
  type Canal,
  calcularMeses,
  calcularResumo,
  CANAIS,
  brl,
  compacto,
  MESES_CURTOS,
  percentual,
  variacao,
} from "./calc";
import EditorOrcado from "./EditorOrcado";
import GraficoMensal, { classeAtingimento, iconeAtingimento } from "./GraficoMensal";
import TabelaPlanejamento from "./TabelaPlanejamento";
import styles from "./PlanejamentoReceita.module.css";

interface Props {
  companyKey: string;
  companyName: string;
  anos: number[];
}

function anoPadrao(anos: number[]): number {
  const atual = new Date().getFullYear();
  if (anos.includes(atual)) return atual;
  return anos.find((a) => a > atual) ?? anos[anos.length - 1];
}

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function PlanejamentoReceitaPage({ companyKey, companyName, anos }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [ano, setAno] = useState(() => anoPadrao(anos));
  const [canal, setCanal] = useState<Canal>("total");
  const [data, setData] = useState<PlanejamentoReceitaResponse | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [novoAnoAberto, setNovoAnoAberto] = useState(false);

  const carregar = useCallback(
    async (anoAlvo: number, fresh = false) => {
      if (!username) return;
      setCarregando(true);
      setErro(null);
      try {
        const qs = new URLSearchParams({ company: companyKey, year: String(anoAlvo) });
        if (fresh) qs.set("fresh", "1");
        const res = await fetch(`/api/planejamento-receita?${qs}`, {
          headers: { "x-auth-username": username },
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Erro ao carregar");
        setData(body as PlanejamentoReceitaResponse);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao carregar");
      } finally {
        setCarregando(false);
      }
    },
    [companyKey, username]
  );

  useEffect(() => {
    void carregar(ano);
  }, [ano, carregar]);

  // A lista de anos vem da API (planilha + anos criados na tela); a da rota é só o começo.
  const anosLista = data?.anosDisponiveis ?? anos;
  const proximoAno = Math.max(...anosLista) + 1;

  const trocarAno = (a: number) => {
    setEditando(false);
    setAno(a);
  };

  // A resposta em tela pode ser do ano anterior enquanto o novo carrega: as contas usam
  // sempre o ano DA RESPOSTA, nunca o do seletor.
  const calc = useMemo(() => (data ? calcularTudo(data, canal) : null), [data, canal]);

  const canalLabel = CANAIS.find((c) => c.key === canal)?.label ?? "";

  return (
    <div className={styles.wrapper}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.titulo}>Planejamento de Receita</h1>
          <p className={styles.subtitulo}>
            {companyName} · Lojas + Web · orçado × realizado × ano anterior
          </p>
        </div>
        <div className={styles.headTools}>
          <div className={styles.segmented} role="tablist" aria-label="Canal">
            {CANAIS.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={canal === c.key}
                className={canal === c.key ? styles.segAtivo : undefined}
                onClick={() => setCanal(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className={styles.segmented} role="tablist" aria-label="Ano">
            {anosLista.map((a) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={ano === a}
                className={ano === a ? styles.segAtivo : undefined}
                onClick={() => trocarAno(a)}
              >
                {a}
              </button>
            ))}
            {data?.podeEditar && (
              <button
                type="button"
                title={`Criar o orçado de ${proximoAno}`}
                onClick={() => setNovoAnoAberto((v) => !v)}
              >
                + {proximoAno}
              </button>
            )}
          </div>
          {data?.podeEditar && (
            <button
              type="button"
              className={`${styles.btn} ${editando ? "" : styles.btnPrimary}`}
              onClick={() => setEditando((v) => !v)}
            >
              {editando ? "Fechar edição" : "Editar orçado"}
            </button>
          )}
          <button
            type="button"
            className={styles.btn}
            disabled={carregando}
            onClick={() => void carregar(ano, true)}
            title="Consulta o realizado no Linx de novo, ignorando o cache de 5 minutos"
          >
            {carregando ? "Carregando…" : "Atualizar"}
          </button>
        </div>
      </div>

      {novoAnoAberto && data?.podeEditar && (
        <NovoAno
          companyKey={companyKey}
          username={username}
          ano={proximoAno}
          onFechar={() => setNovoAnoAberto(false)}
          onCriado={(a) => {
            setNovoAnoAberto(false);
            trocarAno(a);
            setEditando(true);
          }}
        />
      )}

      {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}
      {!data && !erro && (
        <div className={styles.aviso}>Consultando o realizado no Linx mês a mês… pode levar alguns segundos.</div>
      )}

      {data && calc && (
        <div className={`${styles.corpo} ${carregando ? styles.carregando : ""}`}>
          {editando && data.podeEditar && (
            <EditorOrcado
              key={`${data.ano}-${data.edicoes.map((e) => e.updatedAt).join()}`}
              data={data}
              companyKey={companyKey}
              username={username}
              onFechar={() => setEditando(false)}
              onSalvo={() => {
                setEditando(false);
                void carregar(data.ano);
              }}
            />
          )}

          <Kpis data={data} canal={canal} calc={calc} />

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>
                {canalLabel} · mês a mês em {data.ano}
              </h2>
              <span className={styles.cardNote}>
                Atingimento do mês corrente é proporcional aos dias decorridos
              </span>
            </div>
            <GraficoMensal meses={calc.meses} ano={data.ano} diaHoje={calc.resumo.diaHoje} />
          </section>

          <Cenarios data={data} canalLabel={canalLabel} calc={calc} />

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Quadro {data.ano} por canal</h2>
              <span className={styles.cardNote}>
                Valores em R$ · ● mês em andamento · clique no canal para recolher
              </span>
            </div>
            <TabelaPlanejamento ano={data.ano} grupos={calc.grupos} />
          </section>

          <Rodape data={data} />
        </div>
      )}
    </div>
  );
}

type Calc = ReturnType<typeof calcularTudo>;

function calcularTudo(data: PlanejamentoReceitaResponse, canal: Canal) {
  const meses = calcularMeses(data, canal);
  const resumo = calcularResumo(data, meses);
  return {
    meses,
    resumo,
    grupos: CANAIS.map((c) => {
      const m = calcularMeses(data, c.key);
      return { canal: c.key, label: c.label, meses: m, resumo: calcularResumo(data, m) };
    }),
  };
}

function Kpis({ data, canal, calc }: { data: PlanejamentoReceitaResponse; canal: Canal; calc: Calc }) {
  const r = calc.resumo;
  const aa = data.ano - 1;
  const yy = String(data.ano).slice(2);
  const naoIniciado = r.status === "nao-iniciado";
  const lojas = calc.grupos.find((g) => g.canal === "lojas")?.resumo.orcadoAno ?? 0;
  const web = calc.grupos.find((g) => g.canal === "web")?.resumo.orcadoAno ?? 0;

  // Crescimento planejado contra os meses do ano anterior que já fecharam.
  const fechadosAA = calc.meses.filter((m) => m.aaStatus === "fechado");
  const orcFechados = fechadosAA.reduce((s, m) => s + m.orcado, 0);
  const aaFechados = fechadosAA.reduce((s, m) => s + (m.aa ?? 0), 0);
  const crescPlanejado = aaFechados > 0 ? orcFechados / aaFechados - 1 : null;
  const intervaloAA =
    fechadosAA.length === 12
      ? `${aa} inteiro`
      : fechadosAA.length > 0
        ? `${MESES_CURTOS[fechadosAA[0].mes - 1]}–${MESES_CURTOS[fechadosAA[fechadosAA.length - 1].mes - 1]}/${String(aa).slice(2)}`
        : "";

  const projVsOrc = r.orcadoAno > 0 ? r.projecaoRitmo / r.orcadoAno - 1 : null;

  return (
    <div className={styles.kpis}>
      <div className={`${styles.kpi} ${styles.kpiAccent}`}>
        <span className={styles.kpiLabel}>Orçado {data.ano}</span>
        <span className={styles.kpiValue}>{brl(r.orcadoAno)}</span>
        <span className={styles.kpiFoot}>
          {canal === "total" ? (
            <>
              Lojas <b>{compacto(lojas)}</b> · Web <b>{compacto(web)}</b>
            </>
          ) : (
            <>{percentual(r.orcadoAno / (lojas + web || 1))} de Lojas + Web</>
          )}
          {r.crescOrcadoVsOrcadoAA != null && (
            <>
              <br />
              {variacao(r.crescOrcadoVsOrcadoAA)} vs orçado {aa}
            </>
          )}
        </span>
      </div>

      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Realizado {data.ano}</span>
        <span className={styles.kpiValue}>{naoIniciado ? "—" : brl(r.realizadoAno)}</span>
        {naoIniciado ? (
          <span className={styles.kpiFoot}>Começa a contar em jan/{yy}</span>
        ) : (
          <>
            <div className={styles.meter} aria-hidden>
              <i style={{ width: `${Math.min(100, (r.realizadoAno / (r.orcadoAno || 1)) * 100)}%` }} />
            </div>
            <span className={styles.kpiFoot}>
              <b>{percentual(r.realizadoAno / (r.orcadoAno || 1))}</b> do orçado do ano
              {r.status === "em-andamento" ? ` · até ${dataCurta(data.hoje)}` : ""}
            </span>
          </>
        )}
      </div>

      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>Atingimento até hoje</span>
        <span className={styles.kpiValue}>
          {naoIniciado ? (
            "—"
          ) : (
            <span className={`${styles.status} ${classeAtingimento(r.atingimento)}`}>
              {iconeAtingimento(r.atingimento)} {percentual(r.atingimento)}
            </span>
          )}
        </span>
        <span className={styles.kpiFoot}>
          {naoIniciado ? (
            "Realizado ÷ orçado do período"
          ) : (
            <>
              <b>{`${r.diferenca >= 0 ? "+" : ""}${brl(r.diferenca)}`}</b> vs orçado
              do período ({compacto(r.orcadoPeriodo)})
            </>
          )}
        </span>
      </div>

      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>{naoIniciado ? "Crescimento planejado" : `Crescimento vs ${aa}`}</span>
        <span className={styles.kpiValue}>
          {naoIniciado ? variacao(r.crescOrcadoVsAA ?? crescPlanejado) : variacao(r.crescimentoPeriodo)}
        </span>
        <span className={styles.kpiFoot}>
          {naoIniciado ? (
            intervaloAA ? (
              <>Orçado vs realizado de {intervaloAA}</>
            ) : (
              <>Sem realizado de {aa} para comparar</>
            )
          ) : (
            <>
              {aa} no mesmo período: <b>{compacto(r.aaPeriodo)}</b>
            </>
          )}
        </span>
      </div>

      <div className={styles.kpi}>
        <span className={styles.kpiLabel}>
          {r.status === "encerrado" ? "Fechamento do ano" : "Projeção de fechamento"}
        </span>
        <span className={styles.kpiValue}>
          {r.status === "encerrado" ? brl(r.realizadoAno) : brl(r.projecaoRitmo)}
        </span>
        <span className={styles.kpiFoot}>
          {r.status === "em-andamento" ? (
            <>
              No ritmo atual: <b>{variacao(projVsOrc)}</b> vs orçado
              {r.ritmoNecessario != null && r.faltaParaOrcado > 0 && (
                <>
                  <br />
                  Para bater: <b>{percentual(r.ritmoNecessario)}</b> do orçado restante
                </>
              )}
            </>
          ) : r.status === "nao-iniciado" ? (
            "Sem realizado ainda: projeção = orçado"
          ) : (
            <>
              <b>{variacao(projVsOrc)}</b> vs orçado
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function Cenarios({
  data,
  canalLabel,
  calc,
}: {
  data: PlanejamentoReceitaResponse;
  canalLabel: string;
  calc: Calc;
}) {
  const r = calc.resumo;
  const valores = data.cenarios.map((c) => ({ ...c, valor: r.orcadoAno * (1 + c.fator) }));
  const min = Math.min(...valores.map((v) => v.valor));
  const max = Math.max(...valores.map((v) => v.valor));

  const referencia =
    r.status === "em-andamento" ? r.projecaoRitmo : r.status === "encerrado" ? r.realizadoAno : null;
  const lo = Math.min(min, referencia ?? min) * 0.98;
  const hi = Math.max(max, referencia ?? max) * 1.02;
  const pos = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;

  const maisPerto =
    referencia == null
      ? null
      : valores.reduce((a, b) => (Math.abs(b.valor - referencia) < Math.abs(a.valor - referencia) ? b : a));

  const corpAno = data.orcado.corporativo.reduce((s, v) => s + v, 0);
  const lojasWeb =
    data.orcado.lojas.reduce((s, v) => s + v, 0) + data.orcado.web.reduce((s, v) => s + v, 0);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Cenários {data.ano}</h2>
        <span className={styles.cardNote}>{canalLabel}</span>
      </div>
      <div className={`${styles.cardBody} ${styles.cenarios}`}>
        <div className={styles.cenarioLista}>
          {valores.map((c) => (
            <div
              key={c.key}
              className={`${styles.cenario} ${maisPerto?.key === c.key ? styles.cenarioAtivo : ""}`}
            >
              <span className={styles.cenarioNome}>{c.label}</span>
              <span className={styles.cenarioValor}>{compacto(c.valor)}</span>
              <span className={styles.cenarioFator}>
                {c.fator === 0 ? "orçado" : `${variacao(c.fator, 0)} no orçado`}
              </span>
            </div>
          ))}
        </div>

        <div className={styles.regua} aria-hidden>
          <div className={styles.reguaTrilho} style={{ left: pos(min), right: `calc(100% - ${pos(max)})` }} />
          {valores.map((c) => (
            <div key={c.key} className={styles.reguaTick} style={{ left: pos(c.valor) }} />
          ))}
          {referencia != null && (
            <>
              <div className={styles.reguaMarca} style={{ left: pos(referencia) }} />
              <span className={styles.reguaRotulo} style={{ left: pos(referencia) }}>
                {r.status === "encerrado" ? "realizado" : "projeção"} {compacto(referencia)}
              </span>
            </>
          )}
        </div>

        <p className={styles.reguaTexto}>
          {referencia == null ? (
            <>
              Os três cenários aplicam um crescimento uniforme sobre o orçado, como os blocos de DRE da
              planilha. A projeção aparece aqui assim que o ano começar.
            </>
          ) : (
            <>
              {r.status === "encerrado" ? "O ano fechou" : "No ritmo atual, o ano fecha"} em{" "}
              <b>{brl(referencia)}</b> — <b>{percentual(referencia / (r.orcadoAno || 1))}</b> do orçado, mais
              perto do cenário <b>{maisPerto?.label.toLowerCase()}</b>.
            </>
          )}
        </p>

        <div className={styles.corporativo}>
          <span>
            Corporativo (B2B) · orçado <b>{compacto(corpAno)}</b> — realizado ainda não conectado
          </span>
          <span>
            Total geral orçado <b>{compacto(lojasWeb + corpAno)}</b>
          </span>
        </div>
      </div>
    </section>
  );
}

function Rodape({ data }: { data: PlanejamentoReceitaResponse }) {
  const regras = data.orcado.regras;
  const regra = (canal: "lojas" | "web" | "corporativo") => {
    const n = data.edicoes.filter((e) => e.canal === canal).length;
    if (!data.planilha) return n > 0 ? "criado na tela." : "—";
    if (n === 0) return regras[canal] ?? "";
    return (
      <>
        {regras[canal]}{" "}
        <span className={styles.marcaEditado}>
          ({n} {n === 1 ? "mês alterado" : "meses alterados"} na tela)
        </span>
      </>
    );
  };
  return (
    <div className={styles.rodape}>
      <p>
        <b>Orçado:</b> {data.planilha ? data.fonte : `criado na tela a partir de ${data.ano - 1}`}. Lojas —{" "}
        {regra("lojas")} Web — {regra("web")} Corporativo — {regra("corporativo")}
      </p>
      <p>
        <b>Realizado:</b> Linx, regra única de venda (lojas com trocas abatidas; web = NFs de venda do
        e-commerce, grupo MSC/AKS inteiro). Mês corrente até {dataCurta(data.hoje)}; a projeção do mês segue o
        ritmo diário e os meses seguintes, o orçado × atingimento acumulado.
      </p>
      <p>
        <b>Crescimento:</b> só contra mês do ano anterior já fechado; no mês corrente, nos mesmos dias. Consulta de{" "}
        {new Date(data.consultadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
      </p>
    </div>
  );
}

function NovoAno({
  companyKey,
  username,
  ano,
  onFechar,
  onCriado,
}: {
  companyKey: string;
  username: string;
  ano: number;
  onFechar: () => void;
  onCriado: (ano: number) => void;
}) {
  const [pct, setPct] = useState({ lojas: "", web: "", corporativo: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const criar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const crescimento = Object.fromEntries(
        Object.entries(pct).map(([k, v]) => [k, (Number(String(v).replace(",", ".")) || 0) / 100])
      );
      const res = await fetch("/api/planejamento-receita/orcado", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, ano, crescimento }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Erro ao criar o ano");
      onCriado(ano);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar o ano");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className={styles.novoAno}>
      <span>
        Criar orçado <b>{ano}</b> copiando {ano - 1} com crescimento de:
      </span>
      {(["lojas", "web", "corporativo"] as const).map((c) => (
        <label key={c}>
          {c === "lojas" ? "Lojas" : c === "web" ? "Web" : "Corporativo"}
          <input
            className={styles.editorPctInput}
            inputMode="decimal"
            placeholder="0"
            value={pct[c]}
            onChange={(e) => setPct((p) => ({ ...p, [c]: e.target.value }))}
          />
          %
        </label>
      ))}
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={salvando} onClick={() => void criar()}>
        {salvando ? "Criando…" : `Criar ${ano}`}
      </button>
      <button type="button" className={styles.btn} onClick={onFechar} disabled={salvando}>
        Cancelar
      </button>
      {erro && <span className={styles.crit}>{erro}</span>}
    </div>
  );
}
