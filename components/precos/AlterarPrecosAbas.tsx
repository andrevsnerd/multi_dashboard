"use client";

import { useState } from "react";

import AlterarPrecosPage from "./AlterarPrecosPage";
import PrecoCorPanel from "./PrecoCorPanel";
import styles from "./AlterarPrecosPage.module.css";

type Aba = "produto" | "cor";

/**
 * Abas do Alterar Custo / Preço. As duas ficam montadas (só a inativa some), para
 * trocar de aba sem perder a busca nem o que foi digitado na outra.
 */
export default function AlterarPrecosAbas({ companyKey }: { companyKey: "nerd" | "scarfme" }) {
  const [aba, setAba] = useState<Aba>("produto");

  const abas = (
    <div className={styles.tabs} role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={aba === "produto"}
        className={`${styles.tab} ${aba === "produto" ? styles.tabAtiva : ""}`}
        onClick={() => setAba("produto")}
      >
        Por produto
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={aba === "cor"}
        className={`${styles.tab} ${aba === "cor" ? styles.tabAtiva : ""}`}
        onClick={() => setAba("cor")}
      >
        Por cor
      </button>
    </div>
  );

  return (
    <>
      <div hidden={aba !== "produto"}>
        <AlterarPrecosPage companyKey={companyKey} abas={abas} />
      </div>
      <div hidden={aba !== "cor"}>
        <PrecoCorPanel companyKey={companyKey} abas={abas} />
      </div>
    </>
  );
}
