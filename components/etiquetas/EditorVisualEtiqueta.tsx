"use client";

/**
 * Editor visual da etiqueta — "arrastar e redimensionar" em vez de digitar mm
 * em uma dezena de campos. É a entrada PRINCIPAL para ajustar o modelo; o
 * painel completo (`ConfiguracaoEtiqueta`) continua existindo como segunda
 * opção, para quem precisa de um controle que não caiba aqui (impressora,
 * simbologia, etc).
 *
 * Cada elemento (linha de texto, código de barras) pode ser:
 *  - arrastado pelo corpo → grava xMm/yMm (posição manual);
 *  - redimensionado pela alça do canto → altura em mm (e, no código de
 *    barras, também a largura do módulo).
 * A posição/tamanho usa a MESMA conta de `lib/etiquetas/layout.ts` que o
 * preview e o ZPL usam — arrastar aqui é o que vai para o papel.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { calcularLayout, pontoParaModelo, type ElementoLayout } from "@/lib/etiquetas/layout";
import { textoDaLinha, type EtiquetaConfig, type ItemEtiqueta, type LinhaEtiqueta } from "@/lib/etiquetas/tipos";

import EtiquetaSvg from "./EtiquetaSvg";
import styles from "./ImprimirEtiquetasPage.module.css";

interface Props {
  config: EtiquetaConfig;
  onChange: (config: EtiquetaConfig) => void;
  item: ItemEtiqueta;
  podeConfigurar: boolean;
}

const ZOOM_MIN = 8;
const ZOOM_MAX = 24;
const ZOOM_PADRAO = 14;

type Modo = "mover" | "redimensionar";

interface EstadoArraste {
  modo: Modo;
  chave: string;
  pointerId: number;
  origemClienteXMm: number;
  origemClienteYMm: number;
  origemXMm: number;
  origemYMm: number;
  origemAlturaMm: number;
  origemModuloDots: number;
}

/** Estimativa grosseira da largura do texto renderizado — só para dar um alvo de clique/arraste coerente com o que se vê (a largura "de verdade" na etiqueta é sempre a útil, ver layout.ts). */
function estimarLarguraTextoMm(texto: string, alturaMm: number, tetoMm: number): number {
  const estimativa = Math.max(4, texto.length * alturaMm * 0.58);
  return Math.min(tetoMm, estimativa);
}

function arredondar(valor: number, passo: number): number {
  return Math.round(valor / passo) * passo;
}

export default function EditorVisualEtiqueta({ config, onChange, item, podeConfigurar }: Props) {
  const [zoom, setZoom] = useState(ZOOM_PADRAO);
  const [grade, setGrade] = useState(true);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const arrasteRef = useRef<EstadoArraste | null>(null);

  const layout = useMemo(() => calcularLayout(config, item), [config, item]);

  const { larguraEtiquetaMm: L, alturaEtiquetaMm: A } = config;
  const larguraPx = L * zoom;
  const alturaPx = A * zoom;

  const linhaPorId = useCallback(
    (id: string) => config.linhas.find((l) => l.id === id),
    [config.linhas]
  );

  const setLinha = useCallback(
    (id: string, patch: Partial<LinhaEtiqueta>) => {
      onChange({
        ...config,
        linhas: config.linhas.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      });
    },
    [config, onChange]
  );

  const setBarcode = useCallback(
    (patch: Partial<EtiquetaConfig["barcode"]>) => {
      onChange({ ...config, barcode: { ...config.barcode, ...patch } });
    },
    [config, onChange]
  );

  /**
   * Ponto do mouse convertido para mm NO MODELO (0,0 = canto superior esquerdo).
   * Já desfaz a calibração, senão arrastar com a escala fora de 100% gravaria
   * uma posição deslocada.
   */
  const clienteParaMm = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = overlayRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * L;
      const y = ((clientY - rect.top) / rect.height) * A;
      return pontoParaModelo(config, x, y);
    },
    [L, A, config]
  );

  const elementoAtivo = useCallback(
    (chave: string): { xMm?: number; yMm?: number; alturaMm: number; moduloDots?: number } | null => {
      if (chave === "barcode") {
        return {
          xMm: config.barcode.xMm,
          yMm: config.barcode.yMm,
          alturaMm: config.barcode.alturaMm,
          moduloDots: config.barcode.moduloDots,
        };
      }
      const id = chave.replace("linha-", "");
      const linha = linhaPorId(id);
      if (!linha) return null;
      return { xMm: linha.xMm, yMm: linha.yMm, alturaMm: linha.alturaMm };
    },
    [config.barcode, linhaPorId]
  );

  const aplicarPosicao = useCallback(
    (chave: string, xMm: number, yMm: number) => {
      const x = Math.round(xMm * 10) / 10;
      const y = Math.round(yMm * 10) / 10;
      if (chave === "barcode") {
        setBarcode({ xMm: x, yMm: y });
        return;
      }
      const id = chave.replace("linha-", "");
      setLinha(id, { xMm: x, yMm: y });
    },
    [setBarcode, setLinha]
  );

  const aplicarAltura = useCallback(
    (chave: string, alturaMm: number) => {
      const v = Math.round(Math.min(20, Math.max(0.8, alturaMm)) * 10) / 10;
      if (chave === "barcode") {
        setBarcode({ alturaMm: v });
        return;
      }
      const id = chave.replace("linha-", "");
      setLinha(id, { alturaMm: v });
    },
    [setBarcode, setLinha]
  );

  const resetarPosicao = useCallback(
    (chave: string) => {
      if (chave === "barcode") {
        setBarcode({ xMm: undefined, yMm: undefined });
        return;
      }
      const id = chave.replace("linha-", "");
      setLinha(id, { xMm: undefined, yMm: undefined });
    },
    [setBarcode, setLinha]
  );

  /* ── arraste (mover / redimensionar) ─────────────────────────────────── */

  const iniciarArraste = useCallback(
    (evento: React.PointerEvent<SVGRectElement | SVGCircleElement>, elemento: ElementoLayout, modo: Modo) => {
      // Sempre seleciona (inclusive somente-leitura, pra dar pra ver os números no
      // inspetor) — só o arraste de verdade é que exige permissão.
      evento.stopPropagation();
      setSelecionado(elemento.chave);
      if (!podeConfigurar) return;
      evento.preventDefault();
      const ativo = elementoAtivo(elemento.chave);
      if (!ativo) return;
      const ponto = clienteParaMm(evento.clientX, evento.clientY);
      // A caixa do layout vem calibrada; a origem do arraste tem que estar na
      // mesma régua do que será gravado — a do modelo.
      const origem = pontoParaModelo(config, elemento.xMm, elemento.yMm);
      (evento.target as Element).setPointerCapture(evento.pointerId);
      arrasteRef.current = {
        modo,
        chave: elemento.chave,
        pointerId: evento.pointerId,
        origemClienteXMm: ponto.x,
        origemClienteYMm: ponto.y,
        origemXMm: origem.x,
        origemYMm: origem.y,
        origemAlturaMm: ativo.alturaMm,
        origemModuloDots: ativo.moduloDots ?? config.barcode.moduloDots,
      };
    },
    [podeConfigurar, elementoAtivo, clienteParaMm, config]
  );

  const moverArraste = useCallback(
    (evento: React.PointerEvent<SVGRectElement | SVGCircleElement>) => {
      const arraste = arrasteRef.current;
      if (!arraste || evento.pointerId !== arraste.pointerId) return;
      const ponto = clienteParaMm(evento.clientX, evento.clientY);
      const passo = grade ? 0.5 : 0.1;

      if (arraste.modo === "mover") {
        const deltaX = ponto.x - arraste.origemClienteXMm;
        const deltaY = ponto.y - arraste.origemClienteYMm;
        const novoX = arredondar(Math.max(0, Math.min(L, arraste.origemXMm + deltaX)), passo);
        const novoY = arredondar(Math.max(0, Math.min(A, arraste.origemYMm + deltaY)), passo);
        aplicarPosicao(arraste.chave, novoX, novoY);
      } else {
        const deltaY = ponto.y - arraste.origemClienteYMm;
        const novaAltura = arredondar(arraste.origemAlturaMm + deltaY, Math.max(0.1, passo));
        aplicarAltura(arraste.chave, novaAltura);

        if (arraste.chave === "barcode") {
          const deltaX = ponto.x - arraste.origemClienteXMm;
          // ~0.3mm por dot a 203dpi — arredonda pro dot mais próximo (o módulo é discreto).
          const dotsDelta = Math.round(deltaX / 0.3);
          const novoModulo = Math.min(10, Math.max(1, arraste.origemModuloDots + dotsDelta));
          setBarcode({ moduloDots: novoModulo });
        }
      }
    },
    [grade, L, A, aplicarPosicao, aplicarAltura, clienteParaMm, setBarcode]
  );

  const finalizarArraste = useCallback((evento: React.PointerEvent<SVGRectElement | SVGCircleElement>) => {
    if (arrasteRef.current?.pointerId === evento.pointerId) arrasteRef.current = null;
  }, []);

  /* ── render ──────────────────────────────────────────────────────────── */

  const linhasVisiveis = config.linhas.filter((l) => l.visivel);

  return (
    <div className={styles.editorVisual}>
      <div className={styles.editorBarra}>
        <label className={styles.check}>
          zoom
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={grade} onChange={(e) => setGrade(e.target.checked)} />
          alinhar à grade (0,5mm)
        </label>
        {!podeConfigurar ? (
          <span className={styles.produtoMeta}>somente leitura — sua função não pode arrastar/salvar</span>
        ) : null}
      </div>

      <div className={styles.editorCanvasWrap}>
        <div className={styles.editorCanvas} style={{ width: larguraPx, height: alturaPx }}>
          <EtiquetaSvg item={item} config={config} comBorda larguraCss={`${larguraPx}px`} />

          <svg
            ref={overlayRef}
            className={styles.editorOverlay}
            width={larguraPx}
            height={alturaPx}
            viewBox={`0 0 ${L} ${A}`}
            onPointerDown={() => setSelecionado(null)}
          >
            {layout
              .filter((el) => el.tipo !== "numero")
              .map((el) => {
                const texto = el.tipo === "linha" ? textoDaLinha(item, linhaPorId(el.linhaId ?? "") ?? ({} as LinhaEtiqueta)) : "";
                const larguraAlvo =
                  el.tipo === "barcode" ? el.larguraMm : estimarLarguraTextoMm(texto || "•", el.alturaMm, el.larguraMm);
                const ativo = el.chave === selecionado;
                return (
                  <g key={el.chave}>
                    <rect
                      x={el.xMm}
                      y={el.yMm}
                      width={Math.max(2, larguraAlvo)}
                      height={el.alturaMm}
                      fill={ativo ? "rgba(37,99,235,0.16)" : "rgba(37,99,235,0.04)"}
                      stroke={ativo ? "#2563eb" : el.manual ? "#f59e0b" : "rgba(37,99,235,0.35)"}
                      strokeWidth={ativo ? 0.25 : 0.15}
                      strokeDasharray={ativo ? undefined : "0.6 0.4"}
                      style={{ cursor: podeConfigurar ? "move" : "default" }}
                      onPointerDown={(e) => iniciarArraste(e, el, "mover")}
                      onPointerMove={moverArraste}
                      onPointerUp={finalizarArraste}
                    />
                    {podeConfigurar ? (
                      <rect
                        x={el.xMm + Math.max(2, larguraAlvo) - 1.1}
                        y={el.yMm + el.alturaMm - 1.1}
                        width={1.4}
                        height={1.4}
                        fill={ativo ? "#2563eb" : "#94a3b8"}
                        style={{ cursor: "nwse-resize" }}
                        onPointerDown={(e) => iniciarArraste(e, el, "redimensionar")}
                        onPointerMove={moverArraste}
                        onPointerUp={finalizarArraste}
                      />
                    ) : null}
                  </g>
                );
              })}
          </svg>
        </div>
      </div>

      <div className={styles.editorLista}>
        {linhasVisiveis.map((linha) => {
          const chave = `linha-${linha.id}`;
          const el = layout.find((e) => e.chave === chave);
          const ativo = chave === selecionado;
          return (
            <button
              key={chave}
              type="button"
              className={`${styles.editorItem} ${ativo ? styles.editorItemAtivo : ""}`}
              onClick={() => setSelecionado(chave)}
            >
              <span>{textoDaLinha(item, linha) || <em>(vazio)</em>}</span>
              {el?.manual ? <span className={styles.tagFila}>arrastado</span> : null}
            </button>
          );
        })}
        {config.barcode.alturaMm > 0 ? (
          <button
            type="button"
            className={`${styles.editorItem} ${selecionado === "barcode" ? styles.editorItemAtivo : ""}`}
            onClick={() => setSelecionado("barcode")}
          >
            <span>Código de barras</span>
            {layout.find((e) => e.chave === "barcode")?.manual ? (
              <span className={styles.tagFila}>arrastado</span>
            ) : null}
          </button>
        ) : null}
      </div>

      {selecionado ? (
        <div className={styles.editorInspetor}>
          {(() => {
            const el = layout.find((e) => e.chave === selecionado);
            const ativo = el ? elementoAtivo(el.chave) : null;
            if (!el || !ativo) return null;
            return (
              <>
                <span className={styles.secaoTitulo}>
                  {el.tipo === "barcode" ? "Código de barras" : "Linha selecionada"}
                </span>
                <div className={styles.configGrid}>
                  <label className={styles.campo}>
                    <span>X (mm)</span>
                    <input
                      type="number"
                      step={0.5}
                      disabled={!podeConfigurar}
                      value={Number(el.xMm.toFixed(1))}
                      onChange={(e) => aplicarPosicao(el.chave, Number(e.target.value) || 0, el.yMm)}
                    />
                  </label>
                  <label className={styles.campo}>
                    <span>Y (mm)</span>
                    <input
                      type="number"
                      step={0.5}
                      disabled={!podeConfigurar}
                      value={Number(el.yMm.toFixed(1))}
                      onChange={(e) => aplicarPosicao(el.chave, el.xMm, Number(e.target.value) || 0)}
                    />
                  </label>
                  <label className={styles.campo}>
                    <span>Altura (mm)</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0.8}
                      max={20}
                      disabled={!podeConfigurar}
                      value={Number(el.alturaMm.toFixed(1))}
                      onChange={(e) => aplicarAltura(el.chave, Number(e.target.value) || 0.8)}
                    />
                  </label>
                  {el.tipo === "barcode" ? (
                    <label className={styles.campo}>
                      <span>Módulo (dots)</span>
                      <input
                        type="number"
                        step={1}
                        min={1}
                        max={10}
                        disabled={!podeConfigurar}
                        value={ativo.moduloDots ?? config.barcode.moduloDots}
                        onChange={(e) => setBarcode({ moduloDots: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                      />
                    </label>
                  ) : null}
                </div>
                {el.manual ? (
                  <button
                    type="button"
                    className={styles.botaoLink}
                    disabled={!podeConfigurar}
                    onClick={() => resetarPosicao(el.chave)}
                  >
                    voltar à posição automática
                  </button>
                ) : (
                  <span className={styles.produtoMeta}>posição automática (empilhada) — arraste para soltar aqui</span>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        <div className={styles.produtoMeta}>
          Arraste qualquer linha ou o código de barras para reposicionar; puxe o quadradinho no canto para
          redimensionar. Clique num item da lista acima para ajustar com precisão em mm.
        </div>
      )}
    </div>
  );
}
