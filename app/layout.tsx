import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/AuthContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ThemeProvider } from "@/components/theme/ThemeContext";
import { carregarConfigsCiclo } from "@/lib/config/compra-ciclo-store";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Dashboard Corporativo",
};

// Aplica o tema salvo antes da hidratação para evitar "flash" do tema claro.
const themeInitScript = `(function(){try{var t=localStorage.getItem('dashboard-theme');document.documentElement.setAttribute('data-theme',(t==='dark'||t==='light')?t:'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

/**
 * Publica os prazos de CICLO DE COMPRA (tela "Ciclo de Compra") antes da hidratação.
 *
 * `resolveCicloCompra` é síncrono e roda no meio do render das telas de compra, então não dá
 * pra esperar um fetch: se a config chegasse depois, o primeiro paint mostraria a quantidade e
 * a data calculadas com o prazo velho. Injetando aqui — mesmo truque do tema — o valor salvo já
 * está de pé quando o primeiro componente renderiza. A leitura é memoizada com TTL curto no
 * store e cai na config de fábrica se o banco falhar.
 */
function cicloInitScript(configs: unknown): string {
  const json = JSON.stringify(configs).replace(/</g, "\\u003c");
  return `window.__COMPRA_CICLO__=${json};`;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cicloConfigs = await carregarConfigsCiclo();

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: cicloInitScript(cicloConfigs) }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <AuthGuard>{children}</AuthGuard>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
