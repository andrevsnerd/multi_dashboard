"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { StateData } from "@/app/api/mapa-clientes/route";

import styles from "./BrazilMap.module.css";

/**
 * IBGE official API — state boundaries (resolucao=3 = UF/state level).
 * Returns GeoJSON with properties.codarea = IBGE state numeric code.
 */
const GEO_URL =
  "https://servicodados.ibge.gov.br/api/v2/malhas/BR?resolucao=2&formato=application/vnd.geo+json";

const IBGE_TO_UF: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE",
  "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

const UF_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas",
  BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

function getStateColor(percent: number | undefined): string {
  if (!percent || percent === 0) return "#e8eef6";
  if (percent < 1)  return "#c8ddf0";
  if (percent < 5)  return "#93bfe6";
  if (percent < 10) return "#4a93d0";
  if (percent < 20) return "#2169b8";
  return "#0e449a";
}

function getHoverColor(percent: number | undefined): string {
  if (!percent || percent === 0) return "#cfdde9";
  if (percent < 1)  return "#a9ccdf";
  if (percent < 5)  return "#71abda";
  if (percent < 10) return "#2878bf";
  if (percent < 20) return "#1455a3";
  return "#083482";
}

interface TooltipState {
  uf: string;
  x: number;
  y: number;
  pedidos: number;
  percent: number;
}

interface BrazilMapProps {
  dataByUF: Record<string, StateData>;
  total: number;
}

function resolveUF(geo: any): string {
  // Try multiple property names IBGE may use
  const raw =
    geo?.properties?.codarea ??
    geo?.properties?.cod_uf ??
    geo?.properties?.CD_GEOCUF ??
    geo?.properties?.id ??
    "";
  const code = String(raw).trim();
  return IBGE_TO_UF[code] ?? code.toUpperCase();
}

export default function BrazilMap({ dataByUF, total }: BrazilMapProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const handleMouseEnter = useCallback(
    (geo: any, event: any) => {
      const uf = resolveUF(geo);
      const stateData = dataByUF[uf];
      setTooltip({
        uf,
        x: event.clientX,
        y: event.clientY,
        pedidos: stateData?.totalCompradores ?? 0,
        percent: stateData?.percentTotal ?? 0,
      });
    },
    [dataByUF]
  );

  const handleMouseMove = useCallback((event: any) => {
    setTooltip((prev) =>
      prev ? { ...prev, x: event.clientX, y: event.clientY } : null
    );
  }, []);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className={styles.wrapper}>
      {/*
        width/height define the SVG internal canvas (and viewBox).
        react-simple-maps translates the projection to [width/2, height/2].
        scale ~1000 + center [-54,-14] frames Brazil nicely in 800×560.
      */}
      <ComposableMap
        width={600}
        height={620}
        projection="geoMercator"
        projectionConfig={{
          scale: 750,
          center: [-52, -15],
        } as any}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: any) =>
            geographies.map((geo: any) => {
              const uf = resolveUF(geo);
              const stateData = dataByUF[uf];
              const fill = getStateColor(stateData?.percentTotal);
              const hoverFill = getHoverColor(stateData?.percentTotal);
              const hasData = Boolean(stateData?.totalCompradores);

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={0.8}
                  style={{
                    default: {
                      outline: "none",
                      cursor: hasData ? "pointer" : "default",
                      transition: "fill 0.18s ease",
                    },
                    hover: {
                      outline: "none",
                      fill: hoverFill,
                      filter: hasData ? "drop-shadow(0 2px 6px rgba(0,0,0,0.18))" : "none",
                      cursor: hasData ? "pointer" : "default",
                    },
                    pressed: { outline: "none" },
                  }}
                  onMouseEnter={(event: any) => handleMouseEnter(geo, event)}
                  onMouseMove={(event: any) => handleMouseMove(event)}
                  onMouseLeave={handleMouseLeave}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {tooltip && (
        <div
          className={styles.tooltip}
          style={{
            left: tooltip.x + 16,
            top: tooltip.y - 12,
            position: "fixed",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <div className={styles.tooltipTitle}>
            {UF_NAMES[tooltip.uf] ?? tooltip.uf}
            <span className={styles.tooltipUf}> ({tooltip.uf})</span>
          </div>
          {tooltip.pedidos > 0 ? (
            <>
              <div className={styles.tooltipRow}>
                <span className={styles.tooltipPercent}>
                  {tooltip.percent.toFixed(1)}%
                </span>
                <span className={styles.tooltipSub}> dos pedidos</span>
              </div>
              <div className={styles.tooltipCount}>
                {(tooltip.pedidos ?? 0).toLocaleString("pt-BR")} pedidos
              </div>
            </>
          ) : (
            <div className={styles.tooltipSub}>Sem pedidos no período</div>
          )}
        </div>
      )}

      {total === 0 && (
        <div className={styles.noData}>
          Nenhum dado encontrado para o período selecionado.
        </div>
      )}
    </div>
  );
}
