"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CompanyKey } from "@/lib/config/company";
import type { ShopifyDiaMes } from "@/lib/shopify/dashboard";

import styles from "./ShopifyPage.module.css";

/**
 * "Venda por dia" da página Shopify: o mês inteiro dia a dia × META DO DIA (meta do mês da
 * loja Shopify ÷ dias do mês). A meta é própria do Shopify (não é a do dashboard por
 * filial) e fica em metas_paineis (escopo "shopify", chave YYYY-MM). Pedido do dono, 11/11/2026.
 */

interface Props {
  companyKey: CompanyKey;
  /** YYYY-MM */
  mes: string;
  comFrete: boolean;
  colors: { grid: string; axis: string; bar: string; tooltipBg: string; tooltipBorder: string; tooltipText: string };
  podeEditar: boolean;
  username: string | null;
}

interface MetaResposta {
  mes: string;
  meta: number;
  dias: ShopifyDiaMes[];
}

const REFRESH_MS = 60_000;

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function todayBrt(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Aceita "300000", "300.000", "300.000,50", "R$ 1.500" e "300 mil". NaN = inválido. */
function parseValorBR(raw: string): number {
  let s = raw.trim().toLowerCase().replace(/r\$|\s/g, "");
  let mult = 1;
  if (s.endsWith("mil")) {
    mult = 1000;
    s = s.slice(0, -3);
  }
  if (!s) return NaN;
  let n: string;
  if (s.includes(",")) n = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = s.replace(/\./g, "");
  else n = s;
  const v = Number(n) * mult;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : NaN;
}

export default function ShopifyVendaDia({ companyKey, mes, comFrete, colors, podeEditar, username }: Props) {
  const [resp, setResp] = useState<MetaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const hoje = todayBrt();
  const mesAtual = mes === hoje.slice(0, 7);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/shopify/meta?company=${companyKey}&mes=${mes}`, { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as { data?: MetaResposta; error?: string };
        if (!r.ok || !json.data) throw new Error(json.error || "Erro ao carregar a venda do mês.");
        if (ativo) {
          setResp(json.data);
          setErro(null);
        }
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : "Erro ao carregar a venda do mês.");
      });
    return () => {
      ativo = false;
    };
  }, [companyKey, mes, recarga]);

  // Mês em andamento: acompanha sozinho, como o resto da página.
  useEffect(() => {
    if (!mesAtual) return;
    const t = setInterval(() => setRecarga((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, [mesAtual]);

  const meta = resp?.meta ?? 0;
  const dias = resp?.dias ?? [];
  const metaDia = meta > 0 && dias.length > 0 ? meta / dias.length : 0;

  const pontos = useMemo(
    () =>
      dias.map((d) => {
        const [y, m, dd] = d.dia.split("-").map(Number);
        const semana = SEMANA[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
        return {
          dia: d.dia,
          label: d.dia.slice(8, 10),
          semana,
          futuro: d.futuro,
          valor: d.futuro ? null : d.venda + (comFrete ? d.frete : 0),
          pedidos: d.pedidos,
        };
      }),
    [dias, comFrete],
  );

  const vendido = pontos.reduce((s, p) => s + (p.valor ?? 0), 0);
  const vendidoHoje = pontos.find((p) => p.dia === hoje)?.valor ?? 0;
  const falta = Math.max(0, meta - vendido);
  // Dias que ainda dá pra vender, contando hoje.
  const diasRestantes = pontos.filter((p) => p.dia >= hoje).length;
  const precisaDia = diasRestantes > 0 ? falta / diasRestantes : null;
  const diasBatidos = metaDia > 0 ? pontos.filter((p) => p.valor !== null && p.valor >= metaDia).length : 0;
  const diasPassados = pontos.filter((p) => !p.futuro).length;

  /* ── edição da meta ── */
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroMeta, setErroMeta] = useState<string | null>(null);

  const salvar = useCallback(
    async (valor: number) => {
      setSalvando(true);
      setErroMeta(null);
      try {
        const res = await fetch("/api/shopify/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(username ? { "x-auth-username": username } : {}) },
          body: JSON.stringify({ company: companyKey, mes, valor }),
        });
        const json = (await res.json().catch(() => ({}))) as { data?: { meta: number }; error?: string };
        if (!res.ok || json.error) throw new Error(json.error || "Erro ao salvar a meta.");
        setResp((prev) => (prev ? { ...prev, meta: json.data?.meta ?? 0 } : prev));
        setEditando(false);
      } catch (e) {
        setErroMeta(e instanceof Error ? e.message : "Erro ao salvar a meta.");
      } finally {
        setSalvando(false);
      }
    },
    [companyKey, mes, username],
  );

  const nomeMes = MESES[Number(mes.slice(5, 7)) - 1] ?? mes;

  return (
    <>
      {editando ? (
        <div className={styles.metaBox}>
          <form
            className={styles.metaForm}
            onSubmit={(e) => {
              e.preventDefault();
              const v = parseValorBR(rascunho);
              if (!Number.isFinite(v)) {
                setErroMeta("Valor inválido. Ex.: 300000 ou 300 mil.");
                return;
              }
              void salvar(v);
            }}
          >
            <label>
              <span>Meta do Shopify em {nomeMes} (R${comFrete ? ", comparada com venda + frete" : ""})</span>
              <input
                autoFocus
                inputMode="decimal"
                placeholder="Ex.: 300000 ou 300 mil"
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditando(false);
                }}
              />
            </label>
            <button type="submit" className={`${styles.preset} ${styles.presetActive}`} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className={styles.preset} onClick={() => setEditando(false)} disabled={salvando}>
              Cancelar
            </button>
            {meta > 0 && (
              <button type="button" className={styles.preset} onClick={() => void salvar(0)} disabled={salvando}>
                Tirar meta
              </button>
            )}
          </form>
          {erroMeta && <span className={styles.metaErro}>{erroMeta}</span>}
          <span className={styles.muted}>Meta do dia = meta do mês ÷ {dias.length || 30} dias.</span>
        </div>
      ) : meta > 0 ? (
        <div className={styles.metaBox}>
          <div className={styles.metaTopo}>
            <div className={styles.metaNumeros}>
              <span className={styles.metaRotulo}>Meta de {nomeMes}</span>
              <strong>
                {brl(vendido)} <small>de {brl(meta)}</small>
              </strong>
              <span className={`${styles.metaPct} ${vendido >= meta ? styles.metaOk : ""}`}>{pct(vendido / meta)}</span>
            </div>
            <div className={styles.metaInfo}>
              <span>
                Meta do dia <strong>{brl(metaDia)}</strong>
              </span>
              {mesAtual && (
                <span>
                  Hoje <strong className={vendidoHoje >= metaDia ? styles.metaOk : undefined}>{brl(vendidoHoje)}</strong> (
                  {pct(vendidoHoje / metaDia)})
                </span>
              )}
              <span>
                Bateu em <strong>{diasBatidos}</strong> de {diasPassados} dias
              </span>
              <span>
                {falta <= 0 ? (
                  <strong className={styles.metaOk}>Meta batida</strong>
                ) : precisaDia !== null ? (
                  <>
                    Faltam <strong>{brl(falta)}</strong> → <strong>{brl(precisaDia)}/dia</strong>
                  </>
                ) : (
                  <>
                    Ficaram faltando <strong>{brl(falta)}</strong>
                  </>
                )}
              </span>
              {podeEditar && (
                <button
                  type="button"
                  className={styles.metaEditar}
                  onClick={() => {
                    setRascunho(String(Math.round(meta)));
                    setErroMeta(null);
                    setEditando(true);
                  }}
                >
                  Editar meta
                </button>
              )}
            </div>
          </div>
          <div className={styles.track} aria-hidden>
            <div className={styles.fill} style={{ width: `${Math.min(100, (vendido / meta) * 100)}%` }} />
          </div>
        </div>
      ) : (
        <div className={`${styles.metaBox} ${styles.metaVazia}`}>
          <span>
            Sem meta do Shopify para {nomeMes}. Vendido no mês: <strong>{brl(vendido)}</strong>
          </span>
          {podeEditar && (
            <button
              type="button"
              className={styles.preset}
              onClick={() => {
                setRascunho("");
                setErroMeta(null);
                setEditando(true);
              }}
            >
              + Definir meta do mês
            </button>
          )}
        </div>
      )}

      {erro && <div className={styles.error}>{erro}</div>}

      <div className={styles.chart}>
        {pontos.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pontos} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: colors.axis, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                tick={{ fill: colors.axis, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={72}
                domain={[0, (max: number) => Math.max(max, metaDia * 1.15)]}
                tickFormatter={(v: number) => (v >= 1000 ? `R$ ${Math.round(v / 1000)} mil` : `R$ ${v}`)}
              />
              <Tooltip
                cursor={{ fill: colors.grid }}
                contentStyle={{
                  background: colors.tooltipBg,
                  border: `1px solid ${colors.tooltipBorder}`,
                  borderRadius: 10,
                  color: colors.tooltipText,
                }}
                labelFormatter={(_label, payload) => {
                  const p = payload?.[0]?.payload as (typeof pontos)[number] | undefined;
                  return p ? `${p.semana} ${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}${p.dia === hoje ? " (até agora)" : ""}` : "";
                }}
                formatter={(value, _name, item) => {
                  const v = Number(value);
                  const p = item?.payload as (typeof pontos)[number] | undefined;
                  const extra = metaDia > 0 ? ` · ${pct(v / metaDia)} da meta do dia` : "";
                  return [`${brl(v)}${extra}${p ? ` · ${p.pedidos} pedidos` : ""}`, comFrete ? "Venda + frete" : "Venda"];
                }}
              />
              <Bar dataKey="valor" radius={[4, 4, 0, 0]} maxBarSize={28}>
                {pontos.map((p) => (
                  <Cell
                    key={p.dia}
                    fill={colors.bar}
                    // Bateu a meta do dia: cor cheia; abaixo: apagada. Sem meta: tudo cheio.
                    fillOpacity={metaDia <= 0 || (p.valor ?? 0) >= metaDia ? 1 : 0.4}
                  />
                ))}
              </Bar>
              {metaDia > 0 && (
                <ReferenceLine
                  y={metaDia}
                  stroke={colors.tooltipText}
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                  label={{
                    value: `meta do dia ${brl(metaDia)}`,
                    position: "insideTopRight",
                    fill: colors.tooltipText,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.empty}>{erro ? "—" : "Carregando…"}</div>
        )}
      </div>
    </>
  );
}
