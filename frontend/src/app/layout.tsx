import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { WebVitals } from "@/components/web-vitals";
import { UnhandledRejectionHandler } from "@/components/ui/unhandled-rejection-handler";
import ErrorBoundary from "@/components/ui/error-boundary";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "optional" });

export const metadata: Metadata = {
  title: "SDM Platform",
  description: "Species Distribution Modelling Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
        >
          <ErrorBoundary>
            <QueryProvider>
              <WebVitals />
              <UnhandledRejectionHandler />
              {children}
            </QueryProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
