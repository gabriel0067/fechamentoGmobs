import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "GMOBS | Fechamento de Parceiras",
  description:
    "Lançamento, cálculo e fechamento automático de CTEs e minutas por parceira.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
