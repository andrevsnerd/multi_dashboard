"use client";

/**
 * Painel de configuração do modelo da etiqueta — tudo é editável aqui:
 * dimensões, colunas, margens, cada linha de texto (campo, tamanho, negrito,
 * alinhamento, corte), o código de barras e os parâmetros da impressora.
 *
 * O que é salvo vale para a empresa inteira (é o modelo da casa), por isso só
 * quem não é somente-leitura consegue gravar.
 */

import { SIMBOLOGIAS } from "@/lib/etiquetas/barcode";
import {
  CAMPOS_DISPONIVEIS,
  type Alinhamento,
  type EtiquetaConfig,
  type LinhaEtiqueta,
} from "@/lib/etiquetas/tipos";

import styles from "./ImprimirEtiquetasPage.module.css";

interface Props {
  config: EtiquetaConfig;
  onChange: (config: EtiquetaConfig) => void;
  podeConfigurar: boolean;
}

const ALINHAMENTOS: Array<{ valor: Alinhamento; label: string }> = [
  { valor: "left", label: "Esquerda" },
  { valor: "center", label: "Centro" },
  { valor: "right", label: "Direita" },
];

function NumeroCampo({
  label,
  valor,
  onChange,
  passo = 0.1,
  min = 0,
  max = 400,
  sufixo = "mm",
  desabilitado,
}: {
  label: string;
  valor: number;
  onChange: (v: number) => void;
  passo?: number;
  min?: number;
  max?: number;
  sufixo?: string;
  desabilitado?: boolean;
}) {
  return (
    <label className={styles.campo}>
      <span>
        {label} {sufixo ? <span style={{ opacity: 0.7 }}>({sufixo})</span> : null}
      </span>
      <input
        type="number"
        step={passo}
        min={min}
        max={max}
        value={Number.isFinite(valor) ? valor : 0}
        disabled={desabilitado}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    </label>
  );
}

export default function ConfiguracaoEtiqueta({ config, onChange, podeConfigurar }: Props) {
  const set = (patch: Partial<EtiquetaConfig>) => onChange({ ...config, ...patch });
  const setBarcode = (patch: Partial<EtiquetaConfig["barcode"]>) =>
    onChange({ ...config, barcode: { ...config.barcode, ...patch } });
  const setImpressora = (patch: Partial<EtiquetaConfig["impressora"]>) =>
    onChange({ ...config, impressora: { ...config.impressora, ...patch } });

  const setLinha = (index: number, patch: Partial<LinhaEtiqueta>) => {
    const linhas = config.linhas.map((l, i) => (i === index ? { ...l, ...patch } : l));
    set({ linhas });
  };

  const moverLinha = (index: number, direcao: -1 | 1) => {
    const destino = index + direcao;
    if (destino < 0 || destino >= config.linhas.length) return;
    const linhas = [...config.linhas];
    [linhas[index], linhas[destino]] = [linhas[destino], linhas[index]];
    set({ linhas });
  };

  const removerLinha = (index: number) => {
    set({ linhas: config.linhas.filter((_, i) => i !== index) });
  };

  const adicionarLinha = () => {
    if (config.linhas.length >= 8) return;
    const nova: LinhaEtiqueta = {
      id: `l${Date.now().toString(36)}`,
      campo: "descProduto",
      textoFixo: "",
      alturaMm: 2.25,
      larguraMm: 0,
      fonteZpl: 'bitmap',
      negrito: false,
      alinhamento: "left",
      maiuscula: true,
      pularPalavras: 0,
      maxPalavras: 0,
      maxCaracteres: 26,
      espacoAbaixoMm: 0.2,
      visivel: true,
    };
    set({ linhas: [...config.linhas, nova] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-disabled={!podeConfigurar}>
      {!podeConfigurar ? (
        <div className={styles.aviso}>
          Sua função é somente leitura: dá para conferir e imprimir, mas as mudanças no modelo não
          serão salvas.
        </div>
      ) : null}

      <label className={styles.campo}>
        <span>Nome do modelo</span>
        <input
          type="text"
          value={config.nomeModelo}
          maxLength={80}
          onChange={(e) => set({ nomeModelo: e.target.value })}
        />
      </label>

      <div className={styles.secaoConfig}>
        <span className={styles.secaoTitulo}>Tamanho e disposição</span>
        <div className={styles.configGrid}>
          <NumeroCampo
            label="Largura da etiqueta"
            valor={config.larguraEtiquetaMm}
            onChange={(v) => set({ larguraEtiquetaMm: v })}
            min={5}
            max={300}
          />
          <NumeroCampo
            label="Altura da etiqueta"
            valor={config.alturaEtiquetaMm}
            onChange={(v) => set({ alturaEtiquetaMm: v })}
            min={5}
            max={300}
          />
          <NumeroCampo
            label="Colunas por fileira"
            valor={config.colunas}
            onChange={(v) => set({ colunas: Math.max(1, Math.round(v)) })}
            passo={1}
            min={1}
            max={10}
            sufixo=""
          />
          <NumeroCampo
            label="Espaço entre colunas"
            valor={config.espacoColunasMm}
            onChange={(v) => set({ espacoColunasMm: v })}
            max={50}
          />
          <NumeroCampo
            label="Espaço entre fileiras"
            valor={config.espacoLinhasMm}
            onChange={(v) => set({ espacoLinhasMm: v })}
            max={50}
          />
          <NumeroCampo
            label="Margem esquerda"
            valor={config.margemEsquerdaMm}
            onChange={(v) => set({ margemEsquerdaMm: v })}
            max={50}
          />
          <NumeroCampo
            label="Margem do topo"
            valor={config.margemTopoMm}
            onChange={(v) => set({ margemTopoMm: v })}
            max={50}
          />
          <NumeroCampo
            label="Margem interna"
            valor={config.margemInternaMm}
            onChange={(v) => set({ margemInternaMm: v })}
            max={20}
          />
        </div>
      </div>

      <div className={styles.secaoConfig}>
        <div className={styles.cardHeader}>
          <span className={styles.secaoTitulo}>Linhas de texto (de cima para baixo)</span>
          <button
            type="button"
            className={styles.botaoMini}
            onClick={adicionarLinha}
            disabled={config.linhas.length >= 8}
          >
            + adicionar linha
          </button>
        </div>

        {config.linhas.map((linha, index) => (
          <div key={linha.id} className={styles.linhaConfig}>
            <div className={styles.arrasteBotoes}>
              <button
                type="button"
                className={styles.botaoMini}
                onClick={() => moverLinha(index, -1)}
                disabled={index === 0}
                title="Subir"
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.botaoMini}
                onClick={() => moverLinha(index, 1)}
                disabled={index === config.linhas.length - 1}
                title="Descer"
              >
                ↓
              </button>
            </div>

            <label className={styles.campo}>
              <span>Conteúdo</span>
              <select
                value={linha.campo}
                onChange={(e) => setLinha(index, { campo: e.target.value as LinhaEtiqueta["campo"] })}
              >
                {CAMPOS_DISPONIVEIS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.label}
                  </option>
                ))}
              </select>
              {linha.campo === "fixo" ? (
                <input
                  type="text"
                  placeholder="Texto fixo"
                  value={linha.textoFixo}
                  onChange={(e) => setLinha(index, { textoFixo: e.target.value })}
                />
              ) : null}
            </label>

            <NumeroCampo
              label="Altura"
              valor={linha.alturaMm}
              onChange={(v) => setLinha(index, { alturaMm: v })}
              min={0.8}
              max={20}
            />
            <NumeroCampo
              label="Largura (0=auto)"
              valor={linha.larguraMm}
              onChange={(v) => setLinha(index, { larguraMm: v })}
              max={20}
            />
            <NumeroCampo
              label="Espaço abaixo"
              valor={linha.espacoAbaixoMm}
              onChange={(v) => setLinha(index, { espacoAbaixoMm: v })}
              max={20}
            />
            <NumeroCampo
              label="Pular palavras"
              valor={linha.pularPalavras}
              onChange={(v) => setLinha(index, { pularPalavras: Math.round(v) })}
              passo={1}
              max={20}
              sufixo="do início"
            />
            <NumeroCampo
              label="Máx. palavras"
              valor={linha.maxPalavras}
              onChange={(v) => setLinha(index, { maxPalavras: Math.round(v) })}
              passo={1}
              max={20}
              sufixo="0=todas"
            />
            <NumeroCampo
              label="Máx. caracteres"
              valor={linha.maxCaracteres}
              onChange={(v) => setLinha(index, { maxCaracteres: Math.round(v) })}
              passo={1}
              max={200}
              sufixo="0=sem corte"
            />

            <label className={styles.campo}>
              <span>Fonte</span>
              <select
                value={linha.fonteZpl}
                onChange={(e) => setLinha(index, { fonteZpl: e.target.value as LinhaEtiqueta['fonteZpl'] })}
              >
                <option value="bitmap">nítida (tamanho em degraus)</option>
                <option value="escalavel">escalável (qualquer tamanho)</option>
              </select>
            </label>

            <label className={styles.campo}>
              <span>Alinhar</span>
              <select
                value={linha.alinhamento}
                onChange={(e) => setLinha(index, { alinhamento: e.target.value as Alinhamento })}
              >
                {ALINHAMENTOS.map((a) => (
                  <option key={a.valor} value={a.valor}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.campo}>
              <span>Opções</span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={linha.negrito}
                    onChange={(e) => setLinha(index, { negrito: e.target.checked })}
                  />
                  negrito
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={linha.maiuscula}
                    onChange={(e) => setLinha(index, { maiuscula: e.target.checked })}
                  />
                  MAIÚSCULA
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={linha.visivel}
                    onChange={(e) => setLinha(index, { visivel: e.target.checked })}
                  />
                  visível
                </label>
                <button
                  type="button"
                  className={styles.botaoLink}
                  onClick={() => removerLinha(index)}
                  disabled={config.linhas.length <= 1}
                >
                  remover
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.secaoConfig}>
        <span className={styles.secaoTitulo}>Código de barras</span>
        <div className={styles.configGrid}>
          <label className={styles.campo}>
            <span>Simbologia</span>
            <select
              value={config.barcode.simbologia}
              onChange={(e) =>
                setBarcode({ simbologia: e.target.value as EtiquetaConfig["barcode"]["simbologia"] })
              }
            >
              {SIMBOLOGIAS.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 11, opacity: 0.75 }}>
              {SIMBOLOGIAS.find((s) => s.valor === config.barcode.simbologia)?.ajuda}
            </span>
          </label>

          <label className={styles.campo}>
            <span>Origem do número</span>
            <select
              value={config.barcode.origem}
              onChange={(e) =>
                setBarcode({ origem: e.target.value as EtiquetaConfig["barcode"]["origem"] })
              }
            >
              <option value="codigoBarra">Código de barra (o menor)</option>
              <option value="produto">Código do produto</option>
            </select>
          </label>

          <NumeroCampo
            label="Altura das barras"
            valor={config.barcode.alturaMm}
            onChange={(v) => setBarcode({ alturaMm: v })}
            max={100}
          />
          <NumeroCampo
            label="Largura do módulo"
            valor={config.barcode.moduloDots}
            onChange={(v) => setBarcode({ moduloDots: Math.max(1, Math.round(v)) })}
            passo={1}
            min={1}
            max={10}
            sufixo="dots"
          />
          <NumeroCampo
            label="Espaço acima"
            valor={config.barcode.espacoAcimaMm}
            onChange={(v) => setBarcode({ espacoAcimaMm: v })}
            max={20}
          />
          <NumeroCampo
            label="Altura do número"
            valor={config.barcode.alturaNumeroMm}
            onChange={(v) => setBarcode({ alturaNumeroMm: v })}
            min={0.8}
            max={20}
          />
          <NumeroCampo
            label="Espaço antes do número"
            valor={config.barcode.espacoNumeroMm}
            onChange={(v) => setBarcode({ espacoNumeroMm: v })}
            max={20}
          />
          <label className={styles.campo}>
            <span>Alinhar</span>
            <select
              value={config.barcode.alinhamento}
              onChange={(e) => setBarcode({ alinhamento: e.target.value as Alinhamento })}
            >
              {ALINHAMENTOS.map((a) => (
                <option key={a.valor} value={a.valor}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.campo}>
            <span>Número impresso</span>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={config.barcode.mostrarNumero}
                onChange={(e) => setBarcode({ mostrarNumero: e.target.checked })}
              />
              mostrar embaixo das barras
            </label>
          </label>
        </div>
      </div>

      <div className={styles.secaoConfig}>
        <span className={styles.secaoTitulo}>Impressora</span>
        <div className={styles.configGrid}>
          <label className={styles.campo}>
            <span>Resolução</span>
            <select
              value={config.impressora.dpi}
              onChange={(e) => setImpressora({ dpi: Number(e.target.value) === 300 ? 300 : 203 })}
            >
              <option value={203}>203 dpi (ZD230)</option>
              <option value={300}>300 dpi</option>
            </select>
          </label>
          <NumeroCampo
            label="Largura da mídia"
            valor={config.impressora.larguraMidiaMm}
            onChange={(v) => setImpressora({ larguraMidiaMm: v })}
            min={10}
            max={300}
          />
          <label className={styles.campo}>
            <span>Tipo de mídia</span>
            <select
              value={config.impressora.tipoMidia}
              onChange={(e) =>
                setImpressora({
                  tipoMidia: e.target.value as EtiquetaConfig["impressora"]["tipoMidia"],
                })
              }
            >
              <option value="continua">Etiquetas contínuas</option>
              <option value="gap">Espaço entre etiquetas (gap)</option>
              <option value="marca">Marca preta</option>
            </select>
          </label>
          <NumeroCampo
            label="Velocidade"
            valor={config.impressora.velocidadeMmS}
            onChange={(v) => setImpressora({ velocidadeMmS: v })}
            passo={1}
            min={25}
            max={305}
            sufixo="mm/s"
          />
          <NumeroCampo
            label="Escuridão"
            valor={config.impressora.escuridao}
            onChange={(v) => setImpressora({ escuridao: Math.round(v) })}
            passo={1}
            min={0}
            max={30}
            sufixo="0-30"
          />
          <label className={styles.campo}>
            <span>Modo de impressão</span>
            <select
              value={config.impressora.modoImpressao}
              onChange={(e) =>
                setImpressora({
                  modoImpressao: e.target.value as EtiquetaConfig["impressora"]["modoImpressao"],
                })
              }
            >
              <option value="transferencia-termica">Transferência térmica (ribbon)</option>
              <option value="termica-direta">Térmica direta</option>
            </select>
          </label>
          <NumeroCampo
            label="Offset topo"
            valor={config.impressora.offsetTopoMm}
            onChange={(v) => setImpressora({ offsetTopoMm: v })}
            min={-50}
            max={50}
          />
          <NumeroCampo
            label="Offset esquerda"
            valor={config.impressora.offsetEsquerdaMm}
            onChange={(v) => setImpressora({ offsetEsquerdaMm: v })}
            min={-50}
            max={50}
          />
        </div>
      </div>
    </div>
  );
}
