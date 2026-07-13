"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { useCart, formatBRL } from "../CartContext";
import styles from "../loja.module.css";

interface EnderecoBloco {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}
interface ClienteDetalhe {
  codigo: string;
  nomeClifor: string;
  razaoSocial: string;
  cpfCnpj: string;
  endereco: EnderecoBloco;
  entrega: EnderecoBloco;
  enderecoEntregaIgual: boolean;
}

export default function CheckoutPage() {
  const { user } = useAuth();
  const { items, subtotal, frete, total, clear } = useCart();
  const router = useRouter();

  const [cliente, setCliente] = useState<ClienteDetalhe | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [loading, setLoading] = useState(true);
  const [observacao, setObservacao] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const codigo = user?.clienteCodigo ?? "";
        const res = await fetch(
          `/api/corporativo/meu-cliente${codigo ? `?codigo=${encodeURIComponent(codigo)}` : ""}`
        );
        const json = await res.json();
        if (!alive) return;
        setCliente(json.data ?? null);
        setIsSample(Boolean(json.isSample));
      } catch {
        if (alive) setCliente(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.clienteCodigo]);

  // Endereço de entrega: usa o de entrega se preenchido, senão o principal.
  const entregaBloco =
    cliente && cliente.entrega?.endereco ? cliente.entrega : cliente?.endereco ?? null;

  async function handleConfirm() {
    if (items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        clienteCodigo: cliente?.codigo ?? "",
        clienteNome: cliente?.razaoSocial || cliente?.nomeClifor || "",
        userId: user?.id ?? "",
        userNome: user?.nomeExibicao || user?.username || "",
        endereco: entregaBloco
          ? {
              cep: entregaBloco.cep,
              endereco: entregaBloco.endereco,
              numero: entregaBloco.numero,
              complemento: entregaBloco.complemento,
              bairro: entregaBloco.bairro,
              cidade: entregaBloco.cidade,
              uf: entregaBloco.uf,
            }
          : null,
        itens: items.map((i) => ({
          produto: i.produto,
          descProduto: i.descProduto,
          ean: i.ean,
          cor: i.cor,
          corNome: i.corNome,
          tamanho: i.tamanho,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
          subtotal: Number((i.precoUnitario * i.quantidade).toFixed(2)),
        })),
        observacao,
      };
      const res = await fetch("/api/corporativo/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao finalizar o pedido.");
      clear();
      router.push(`/corporativo/loja/pedido/${json.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao finalizar o pedido.");
      setSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Seu carrinho está vazio.</p>
        <Link href="/corporativo/loja" className={styles.btn} style={{ marginTop: 12 }}>
          Ver produtos
        </Link>
      </div>
    );
  }

  function addr(v: string | undefined) {
    return v && v.trim() ? v : <span className={styles.addrEmpty}>—</span>;
  }

  return (
    <>
      <Link href="/corporativo/loja/carrinho" className={styles.backLink}>
        ← Voltar ao carrinho
      </Link>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>Finalizar pedido</h1>
      </div>

      {isSample && (
        <div className={styles.sampleBanner}>
          Você está logado como admin: o endereço abaixo é de uma empresa cadastrada, mostrado
          apenas como <strong>visualização de teste</strong>. Para clientes reais, o endereço vem
          automaticamente do cadastro vinculado à conta.
        </div>
      )}
      {error && <div className={styles.alertError}>{error}</div>}

      <div className={styles.checkoutLayout}>
        <div>
          {/* Cliente / endereço */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>📍 Endereço de entrega</h2>
            {loading ? (
              <div className={styles.loadingRow}>Carregando dados do cliente…</div>
            ) : cliente ? (
              <>
                <div style={{ marginBottom: 12, fontWeight: 600, color: "var(--t-900)" }}>
                  {cliente.razaoSocial || cliente.nomeClifor}
                </div>
                <div className={styles.addrGrid}>
                  <div className={styles.addrField}>
                    <span className={styles.addrLabel}>Endereço</span>
                    <span className={styles.addrValue}>{addr(entregaBloco?.endereco)}</span>
                  </div>
                  <div className={styles.addrField}>
                    <span className={styles.addrLabel}>Número</span>
                    <span className={styles.addrValue}>{addr(entregaBloco?.numero)}</span>
                  </div>
                  <div className={styles.addrField}>
                    <span className={styles.addrLabel}>Bairro</span>
                    <span className={styles.addrValue}>{addr(entregaBloco?.bairro)}</span>
                  </div>
                  <div className={styles.addrField}>
                    <span className={styles.addrLabel}>Complemento</span>
                    <span className={styles.addrValue}>{addr(entregaBloco?.complemento)}</span>
                  </div>
                  <div className={styles.addrField}>
                    <span className={styles.addrLabel}>Cidade / UF</span>
                    <span className={styles.addrValue}>
                      {addr([entregaBloco?.cidade, entregaBloco?.uf].filter(Boolean).join(" / "))}
                    </span>
                  </div>
                  <div className={styles.addrField}>
                    <span className={styles.addrLabel}>CEP</span>
                    <span className={styles.addrValue}>{addr(entregaBloco?.cep)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                Nenhum cliente vinculado a esta conta. Fale com o administrador.
              </div>
            )}
          </div>

          {/* Itens */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>🛍️ Itens do pedido</h2>
            <div className={styles.cartList}>
              {items.map((i) => (
                <div key={`${i.produto} ${i.cor} ${i.tamanho}`} className={styles.cartItem}>
                  <div className={styles.cartThumb}>
                    {i.imagem ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.imagem} alt={i.descProduto} />
                    ) : (
                      <span>🖼️</span>
                    )}
                  </div>
                  <div className={styles.cartInfo}>
                    <span className={styles.cartName}>{i.descProduto || i.produto}</span>
                    {i.corNome && <span className={styles.cartMeta}>Cor: {i.corNome}</span>}
                    {i.tamanho && <span className={styles.cartMeta}>Tamanho: {i.tamanho}</span>}
                    <span className={styles.cartUnit}>
                      {i.quantidade} × {formatBRL(i.precoUnitario)}
                    </span>
                  </div>
                  <div className={styles.cartRight}>
                    <span className={styles.cartLineTotal}>
                      {formatBRL(i.precoUnitario * i.quantidade)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Observação */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>📝 Observação (opcional)</h2>
            <textarea
              className={styles.textarea}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Alguma observação sobre o pedido?"
            />
          </div>
        </div>

        {/* Resumo / confirmar */}
        <div className={styles.summary}>
          <h2 className={styles.summaryTitle}>Resumo</h2>
          <div className={styles.summaryRow}>
            <span>Subtotal</span>
            <span>{formatBRL(subtotal)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>Frete</span>
            <span>{formatBRL(frete)}</span>
          </div>
          <div className={styles.summaryTotal}>
            <span>Total</span>
            <span>{formatBRL(total)}</span>
          </div>
          <button
            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "Enviando…" : "Confirmar pedido"}
          </button>
          <span className={styles.summaryHint}>
            O pedido será registrado e processado pela equipe.
          </span>
        </div>
      </div>
    </>
  );
}
