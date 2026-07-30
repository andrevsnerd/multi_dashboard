"use client";

/**
 * Etiqueta VM — pill vermelho ao lado do estoque, no mesmo espírito do chip "T" de compra
 * em trânsito. Aparece quando o estoque está zerado e existe peça em exposição naquela
 * filial: o zero está certo (o VM já saiu do estoque), a etiqueta só evita que o operador
 * ache que a loja ficou sem nada por esquecimento.
 */
export default function VmBadge({ title }: { title?: string }) {
  return (
    <span
      title={
        title ??
        "Existe 1 peça em VM (exposição) nesta filial. Ela já saiu do estoque — o saldo zero está correto."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        marginLeft: 6,
        padding: "0 6px",
        height: 16,
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.4,
        color: "#ffffff",
        background: "#dc2626",
        whiteSpace: "nowrap",
        cursor: "help",
      }}
    >
      VM
    </span>
  );
}
