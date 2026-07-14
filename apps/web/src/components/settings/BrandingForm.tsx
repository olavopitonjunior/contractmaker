"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Info, Loader2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useOrgSettingsForm } from "@/hooks/use-org-settings-form";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";

export interface OrgBranding {
  displayName?: string | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}

/**
 * Identidade visual da imobiliária — nome de exibição, contato de suporte, logo
 * e cor. É o que o cliente final vê: página de pagamento, e-mails e a sidebar.
 *
 * Fonte canônica `BrandingSettings` via `/api/org/branding`. O GET devolve os
 * valores JÁ RESOLVIDOS (nome e e-mail derivados da org quando ninguém
 * preencheu), então o dono nunca encontra a tela em branco.
 */
export function BrandingForm({ initial }: { initial: OrgBranding }) {
  const { form, set, saveNow, status, error, hydrated, isDirty } = useOrgSettingsForm(
    {
      displayName: initial.displayName ?? "",
      supportEmail: initial.supportEmail ?? "",
      supportPhone: initial.supportPhone ?? "",
      primaryColor: initial.primaryColor ?? "",
    },
    { endpoint: "/api/org/branding" }
  );

  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onSaveClick() {
    const ok = await saveNow();
    if (ok) toast.success("Identidade visual salva.");
    else toast.error(error ?? "Falha ao salvar");
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/org/branding/logo", { method: "POST", body });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Falha no upload");
      setLogoUrl(j.url);
      toast.success("Logo enviada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLogo() {
    const res = await fetch("/api/org/branding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl: "" }),
    });
    if (res.ok) {
      setLogoUrl("");
      toast.success("Logo removida.");
    } else {
      toast.error("Falha ao remover");
    }
  }

  const color = form.primaryColor || "#0f172a";

  return (
    <div className="space-y-5">
      <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
        <span>
          É o que o <b className="text-info">cliente final</b> vê: a página de pagamento, os
          e-mails de cobrança e a barra lateral do sistema.
        </span>
      </div>

      {/* Logo */}
      <div className="space-y-2">
        <Label>Logo</Label>
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-16 w-32 place-items-center overflow-hidden rounded-lg border bg-muted/40">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo da imobiliária" className="max-h-14 max-w-28 object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">sem logo</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadLogo(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ImageUp className="mr-1.5 h-4 w-4" />
              )}
              {uploading ? "Enviando…" : "Enviar logo"}
            </Button>
            {logoUrl && (
              <Button type="button" variant="ghost" size="icon" onClick={removeLogo}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPG, WEBP ou SVG — até 2 MB.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="brand-displayName">Nome de exibição</Label>
          <Input
            id="brand-displayName"
            value={form.displayName}
            placeholder="RE/MAX Ativa"
            onChange={(e) => set("displayName", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Assina os e-mails e a página de pagamento.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brand-primaryColor">Cor principal</Label>
          <div className="flex items-center gap-2">
            <input
              aria-label="Escolher cor principal"
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0f172a"}
              onChange={(e) => set("primaryColor", e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border bg-transparent p-1"
            />
            <Input
              id="brand-primaryColor"
              value={form.primaryColor}
              placeholder="#0f172a"
              onChange={(e) => set("primaryColor", e.target.value)}
              className="font-mono"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brand-supportEmail">E-mail de suporte</Label>
          <Input
            id="brand-supportEmail"
            value={form.supportEmail}
            placeholder="contato@imobiliaria.com.br"
            onChange={(e) => set("supportEmail", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brand-supportPhone">Telefone de suporte</Label>
          <Input
            id="brand-supportPhone"
            value={form.supportPhone}
            placeholder="(19) 99999-0000"
            onChange={(e) => set("supportPhone", e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <SaveStatusPill status={status} isDirty={isDirty} />
        <Button onClick={onSaveClick} disabled={!hydrated || status === "saving"}>
          {status === "saving" ? "Salvando…" : "Salvar identidade"}
        </Button>
      </div>
    </div>
  );
}
