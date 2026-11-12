"use client";

import { useState } from "react";

import PacotesLojasPanel from "./PacotesLojasPanel";
import ProgramarPrecosPage from "./ProgramarPrecosPage";
import styles from "./AlterarPrecosPage.module.css";

type Aba = "tarefas" | "pacotes";

/**
 * Abas do Programar Preços. As duas ficam montadas (só a inativa some); o botão
 * "Pacotes" de uma tarefa aplicada abre a aba de pacotes já com o lote dela.
 */
export default function ProgramarPrecosAbas({ companyKey }: { companyKey: "nerd" | "scarfme" }) {
  const [aba, setAba] = useState<Aba>("tarefas");
  const [lotePacotes, setLotePacotes] = useState<string | null>(null);
  const [pedido, setPedido] = useState(0);

  const abas = (
    <div className={styles.tabs} role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={aba === "tarefas"}
        className={`${styles.tab} ${aba === "tarefas" ? styles.tabAtiva : ""}`}
        onClick={() => setAba("tarefas")}
      >
        Tarefas
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={aba === "pacotes"}
        className={`${styles.tab} ${aba === "pacotes" ? styles.tabAtiva : ""}`}
        onClick={() => setAba("pacotes")}
      >
        Pacotes nas lojas
      </button>
    </div>
  );

  return (
    <>
      <div hidden={aba !== "tarefas"}>
        <ProgramarPrecosPage
          companyKey={companyKey}
          abas={abas}
          onVerPacotes={(lote) => {
            setLotePacotes(lote);
            setPedido((n) => n + 1);
            setAba("pacotes");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </div>
      <div hidden={aba !== "pacotes"}>
        <PacotesLojasPanel
          companyKey={companyKey}
          titulo="Programar Preços"
          abas={abas}
          loteInicial={lotePacotes}
          pedido={pedido}
        />
      </div>
    </>
  );
}
