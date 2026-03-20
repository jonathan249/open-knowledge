import type { Metadata } from "next";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";

const systemThemeScript = `
(() => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;

  const applyTheme = () => {
    const isDark = media.matches;
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
  };

  applyTheme();

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", applyTheme);
  } else if (typeof media.addListener === "function") {
    media.addListener(applyTheme);
  }
})();
`;

export const metadata: Metadata = {
  title: "Open Knowledge Chat",
  description:
    "Persistent streamed AI responses powered by Convex and the AI SDK.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: systemThemeScript }} />
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
