"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Provider de tema (light/dark) via next-themes. Alterna a classe `dark`
 * no <html>, casando com os tokens `.dark` do globals.css (DS imobpro.ai).
 * Default light (editorial jurídico é light-first); respeita preferência do SO.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
