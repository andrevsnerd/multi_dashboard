import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/AuthContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ThemeProvider } from "@/components/theme/ThemeContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Dashboard Corporativo",
};

// Aplica o tema salvo antes da hidratação para evitar "flash" do tema claro.
const themeInitScript = `(function(){try{var t=localStorage.getItem('dashboard-theme');document.documentElement.setAttribute('data-theme',(t==='dark'||t==='light')?t:'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
