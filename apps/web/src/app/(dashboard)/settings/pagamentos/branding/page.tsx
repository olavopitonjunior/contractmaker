"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";

interface Branding {
  brandLogoUrl: string | null;
  brandPrimaryColor: string;
  brandDisplayName: string | null;
  brandSupportEmail: string | null;
  brandSupportPhone: string | null;
}

export default function BrandingPage() {
  const [data, setData] = useState<Branding>({
    brandLogoUrl: null,
    brandPrimaryColor: "#0f172a",
    brandDisplayName: null,
    brandSupportEmail: null,
    brandSupportPhone: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/financeiro/settings", { credentials: "include" });
      if (res.ok) {
        const { settings } = await res.json();
        setData({
          brandLogoUrl: settings.brandLogoUrl,
          brandPrimaryColor: settings.brandPrimaryColor ?? "#0f172a",
          brandDisplayName: settings.brandDisplayName,
          brandSupportEmail: settings.brandSupportEmail,
          brandSupportPhone: settings.brandSupportPhone,
        });
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/financeiro/settings/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.message ?? result.error ?? "Falha ao salvar");
        return;
      }
      toast.success("Branding salvo");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Aparência da cobrança pública</h1>
        <p className="text-sm text-muted-foreground">
          Personalize a página de pagamento que o cliente vê em /pay/[token].
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identidade visual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="logo">URL do logotipo</Label>
              <Input
                id="logo"
                placeholder="https://..."
                value={data.brandLogoUrl ?? ""}
                onChange={(e) =>
                  setData({ ...data, brandLogoUrl: e.target.value || null })
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                Hospede sua logo em CDN (ex: Vercel Blob). Recomendado: PNG ou SVG 200×60.
              </p>
            </div>

            <div>
              <Label htmlFor="color">Cor primária</Label>
              <div className="flex items-center gap-2">
                <input
                  id="color"
                  type="color"
                  value={data.brandPrimaryColor}
                  onChange={(e) =>
                    setData({ ...data, brandPrimaryColor: e.target.value })
                  }
                  className="w-14 h-10 border rounded cursor-pointer"
                />
                <Input
                  value={data.brandPrimaryColor}
                  onChange={(e) =>
                    setData({ ...data, brandPrimaryColor: e.target.value })
                  }
                  className="flex-1 font-mono"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Contraste mínimo com branco: 4.5 (WCAG AA).
              </p>
            </div>

            <div>
              <Label htmlFor="dname">Nome exibido</Label>
              <Input
                id="dname"
                value={data.brandDisplayName ?? ""}
                onChange={(e) =>
                  setData({ ...data, brandDisplayName: e.target.value || null })
                }
                placeholder="Ex: Zimmermann Imóveis"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contato</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="semail">Email de suporte</Label>
              <Input
                id="semail"
                type="email"
                value={data.brandSupportEmail ?? ""}
                onChange={(e) =>
                  setData({ ...data, brandSupportEmail: e.target.value || null })
                }
                placeholder="contato@imobiliaria.com.br"
              />
            </div>
            <div>
              <Label htmlFor="sphone">Telefone de suporte</Label>
              <Input
                id="sphone"
                value={data.brandSupportPhone ?? ""}
                onChange={(e) =>
                  setData({ ...data, brandSupportPhone: e.target.value || null })
                }
                placeholder="(11) 9 9999-9999"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview — como o pagador verá</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded overflow-hidden">
            <div
              className="px-6 py-4 flex items-center justify-between"
              style={{ backgroundColor: data.brandPrimaryColor, color: "white" }}
            >
              <div className="flex items-center gap-3">
                {data.brandLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.brandLogoUrl}
                    alt="Logo"
                    className="h-8 bg-white rounded px-2 py-1"
                  />
                ) : (
                  <div className="h-8 px-3 bg-white/20 rounded flex items-center text-xs">
                    Sua logo
                  </div>
                )}
                <span className="font-medium">
                  {data.brandDisplayName ?? "Sua imobiliária"}
                </span>
              </div>
              {data.brandSupportPhone && (
                <span className="text-xs opacity-90">
                  Suporte: {data.brandSupportPhone}
                </span>
              )}
            </div>
            <div className="p-8 text-center bg-muted/20">
              <div className="text-sm text-muted-foreground">
                Conteúdo da cobrança aparece aqui (valor, QR code, boleto...)
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : "Salvar branding"}
        </Button>
      </div>
    </div>
  );
}
