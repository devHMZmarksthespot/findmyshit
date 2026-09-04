import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "findmyshit",
  description: "Präzisionssuche für Tutti.ch und Ricardo.ch",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
