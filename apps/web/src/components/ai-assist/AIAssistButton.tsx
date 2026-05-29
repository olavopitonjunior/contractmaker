"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { AIChatDrawer } from "@/components/ai-assist/AIChatDrawer";

/**
 * Botão flutuante fixo no canto inferior direito. Abre drawer com chat IA contextual.
 * Renderizado no (dashboard)/layout.tsx — único por sessão.
 */
export function AIAssistButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="lg"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full p-0 shadow-lg sm:h-14 sm:w-14"
        aria-label="Abrir assistente IA"
      >
        <Sparkles className="h-5 w-5 sm:h-6 sm:w-6" />
      </Button>
      <AIChatDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
