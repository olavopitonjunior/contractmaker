"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PanelLeft, ArrowRight } from "lucide-react";

/**
 * Modal de boas-vindas do onboarding — mostrado no 1º acesso do dono. Explica o
 * processo e aponta o checklist "Primeiros passos" na barra lateral. Ao clicar
 * em "Começar", grava `onboardingIntroSeenAt` (para o auto-redirect da home).
 */
export function OnboardingWelcomeModal({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      await fetch("/api/onboarding/intro-seen", { method: "POST" }).catch(() => {});
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && start()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Bem-vindo(a) à imobpro.ai 👋
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Vamos deixar sua imobiliária pronta em <b>6 passos rápidos</b>: conectar o
            Google Drive, preencher o perfil, subir o seu modelo de contrato, ajustar o
            formulário, convidar o seu time e criar o primeiro negócio.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-xl border border-brand-accent/30 bg-brand-accent/5 p-3.5 text-sm">
          <PanelLeft className="h-5 w-5 flex-none text-brand-accent" />
          <span>
            Seu progresso fica sempre à mão no menu{" "}
            <b className="text-brand-accent">Primeiros passos</b>, na barra lateral. Cada
            passo leva você direto ao lugar certo.
          </span>
        </div>

        <DialogFooter>
          <Button onClick={start} disabled={busy}>
            {busy ? "Abrindo…" : "Começar"}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
