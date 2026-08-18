"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, FileText, Check, Loader2, Trash2, Upload } from "lucide-react";
import {
  AMBIENTES_SUGERIDOS,
  INSPECTION_STATUS_LABELS,
  isInspectionContentEditable,
  type InspectionStatus,
  type LaudoAmbiente,
  type LaudoMeta,
} from "@/lib/locacao/inspection-types";
import { AmbienteCard } from "./AmbienteCard";
import { FotoUploader } from "./FotoUploader";
import { EnviarAssinaturaDialog, type SignerSuggestion } from "./EnviarAssinaturaDialog";

interface Props {
  inspectionId: string;
  initialStatus: string;
  initialAmbientes: LaudoAmbiente[];
  initialMeta: LaudoMeta;
  laudoPdfUrl: string | null;
  /** "gerado" (renderizado de ambientesJson) ou "externo" (PDF anexado pronto). */
  laudoOrigem: string;
  /** Sugestões de signatários (locatários + proprietários) pro envio ClickSign. */
  signerSuggestions: SignerSuggestion[];
  /** false quando o contrato de origem não tem deal — assinatura indisponível. */
  signatureAvailable: boolean;
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  em_campo: "secondary",
  laudo_gerado: "default",
  assinatura: "secondary",
  concluida: "default",
};

const META_DEFAULT: LaudoMeta = { medidores: {}, chaves: [], mobilia: [] };

export function LaudoEditor({
  inspectionId,
  initialStatus,
  initialAmbientes,
  initialMeta,
  laudoPdfUrl,
  laudoOrigem,
  signerSuggestions,
  signatureAvailable,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [origem, setOrigem] = useState(laudoOrigem);
  const [ambientes, setAmbientes] = useState<LaudoAmbiente[]>(initialAmbientes);
  const [meta, setMeta] = useState<LaudoMeta>({ ...META_DEFAULT, ...initialMeta });
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const [gerandoLaudo, setGerandoLaudo] = useState(false);
  const [enviandoLaudo, setEnviandoLaudo] = useState(false);
  const [novoAmbiente, setNovoAmbiente] = useState("");

  const editable = isInspectionContentEditable(status);
  const dirtyRef = useRef(false);
  const laudoFileRef = useRef<HTMLInputElement>(null);

  // Autosave com debounce ~1,5s. dirtyRef evita perder edição feita durante um save.
  const save = useCallback(
    async (a: LaudoAmbiente[], m: LaudoMeta) => {
      setSaveState("saving");
      dirtyRef.current = false;
      try {
        const res = await fetch(`/api/locacao/inspections/${inspectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ambientesJson: a, checklistJson: m }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (data.inspection?.status && data.inspection.status !== status) {
          setStatus(data.inspection.status);
        }
        setSaveState(dirtyRef.current ? "dirty" : "saved");
      } catch (err) {
        setSaveState("dirty");
        toast.error(err instanceof Error ? err.message : "Erro ao salvar laudo");
      }
    },
    [inspectionId, status]
  );

  useEffect(() => {
    if (!editable) return;
    if (saveState === "saved") return;
    dirtyRef.current = true;
    const t = setTimeout(() => save(ambientes, meta), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientes, meta]);

  function markDirty() {
    setSaveState("dirty");
  }

  function addAmbiente(nome: string) {
    const n = nome.trim();
    if (!n) return;
    setAmbientes((prev) => [
      ...prev,
      { id: crypto.randomUUID(), nome: n, ordem: prev.length, fotos: [], itens: [] },
    ]);
    setNovoAmbiente("");
    markDirty();
  }

  async function gerarLaudo() {
    // Laudo vigente é um PDF externo: regerar a partir dos ambientes (possivelmente
    // parciais/abandonados) substituiria o documento oficial sem aviso.
    if (
      origem === "externo" &&
      laudoPdfUrl &&
      !window.confirm(
        "O laudo atual é um PDF anexado pronto. Gerar o laudo a partir dos ambientes preenchidos vai SUBSTITUÍ-LO. Continuar?"
      )
    ) {
      return;
    }
    // Garante o conteúdo persistido antes do PDF.
    await save(ambientes, meta);
    setGerandoLaudo(true);
    try {
      const res = await fetch(`/api/locacao/inspections/${inspectionId}/laudo`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Laudo PDF gerado");
      setStatus("laudo_gerado");
      setOrigem("gerado");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar laudo");
    } finally {
      setGerandoLaudo(false);
    }
  }

  async function uploadLaudoPronto(file: File) {
    setEnviandoLaudo(true);
    try {
      // Upload client-direct pro Blob (contorna os ~4.5MB de corpo de função),
      // depois registro server-side que valida conteúdo e muta a vistoria.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blob = await upload(
        `inspections/${inspectionId}/laudo-externo/${safeName}`,
        file,
        {
          access: "public",
          contentType: "application/pdf",
          handleUploadUrl: `/api/locacao/inspections/${inspectionId}/laudo/blob-upload`,
        }
      );
      const res = await fetch(`/api/locacao/inspections/${inspectionId}/laudo/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blob.url, filename: file.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Laudo anexado — vistoria pronta pra assinatura");
      setStatus("laudo_gerado");
      setOrigem("externo");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao anexar laudo");
    } finally {
      setEnviandoLaudo(false);
      if (laudoFileRef.current) laudoFileRef.current.value = "";
    }
  }

  const sugestoesRestantes = AMBIENTES_SUGERIDOS.filter(
    (s) => !ambientes.some((a) => a.nome.toLowerCase() === s.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_TONE[status] ?? "outline"}>
            {INSPECTION_STATUS_LABELS[status as InspectionStatus] ?? status}
          </Badge>
          {editable && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {saveState === "saving" && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> salvando…
                </>
              )}
              {saveState === "saved" && (
                <>
                  <Check className="h-3 w-3" /> salvo
                </>
              )}
              {saveState === "dirty" && "alterações pendentes"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {laudoPdfUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={laudoPdfUrl} target="_blank" rel="noreferrer">
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Ver laudo PDF
              </a>
            </Button>
          )}
          {editable && (
            <>
              <input
                ref={laudoFileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadLaudoPronto(f);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => laudoFileRef.current?.click()}
                disabled={enviandoLaudo || gerandoLaudo}
                title="Suba o PDF de uma vistoria já feita fora do sistema"
              >
                {enviandoLaudo ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Enviando…
                  </>
                ) : (
                  <>
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {laudoPdfUrl ? "Substituir por laudo pronto" : "Anexar laudo pronto"}
                  </>
                )}
              </Button>
              <Button size="sm" onClick={gerarLaudo} disabled={gerandoLaudo || enviandoLaudo}>
                {gerandoLaudo ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Gerando…
                  </>
                ) : (
                  <>
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                    {laudoPdfUrl ? "Regerar laudo PDF" : "Gerar laudo PDF"}
                  </>
                )}
              </Button>
            </>
          )}
          {status === "laudo_gerado" && (
            <EnviarAssinaturaDialog
              inspectionId={inspectionId}
              suggestions={signerSuggestions}
              available={signatureAvailable}
            />
          )}
        </div>
      </div>

      {!editable && (
        <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
          {status === "assinatura"
            ? "Laudo enviado pra assinatura — edição bloqueada até o envelope fechar ou ser cancelado."
            : "Vistoria concluída — laudo assinado e imutável."}
        </p>
      )}

      <div className="space-y-3">
        {ambientes.map((amb, idx) => (
          <AmbienteCard
            key={amb.id}
            inspectionId={inspectionId}
            ambiente={amb}
            disabled={!editable}
            onChange={(novo) => {
              setAmbientes((prev) => prev.map((a, i) => (i === idx ? novo : a)));
              markDirty();
            }}
            onRemove={() => {
              setAmbientes((prev) => prev.filter((_, i) => i !== idx));
              markDirty();
            }}
          />
        ))}

        {editable && (
          <Card>
            <CardContent className="space-y-2 py-4">
              <p className="text-sm font-medium">Adicionar ambiente</p>
              {sugestoesRestantes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sugestoesRestantes.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => addAmbiente(s)}
                    >
                      <Plus className="mr-1 h-3 w-3" /> {s}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Outro ambiente (ex.: Quarto 2)"
                  className="h-8 text-sm"
                  value={novoAmbiente}
                  onChange={(e) => setNovoAmbiente(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAmbiente(novoAmbiente);
                    }
                  }}
                />
                <Button type="button" size="sm" variant="outline" onClick={() => addAmbiente(novoAmbiente)}>
                  Adicionar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardContent className="space-y-4 py-4">
          <p className="text-sm font-semibold">Medidores</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["agua", "luz", "gas"] as const).map((m) => (
              <div key={m} className="space-y-1">
                <Label className="capitalize">{m === "agua" ? "Água" : m === "luz" ? "Luz" : "Gás"}</Label>
                <Input
                  placeholder="Leitura"
                  disabled={!editable}
                  value={meta.medidores[m]?.leitura ?? ""}
                  onChange={(e) => {
                    setMeta((prev) => ({
                      ...prev,
                      medidores: {
                        ...prev.medidores,
                        [m]: e.target.value
                          ? { ...prev.medidores[m], leitura: e.target.value }
                          : undefined,
                      },
                    }));
                    markDirty();
                  }}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Chaves entregues</p>
            {meta.chaves.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1 text-sm"
                  placeholder="Tipo (ex.: porta externa)"
                  disabled={!editable}
                  value={c.tipo}
                  onChange={(e) => {
                    setMeta((prev) => ({
                      ...prev,
                      chaves: prev.chaves.map((x, xi) =>
                        xi === i ? { ...x, tipo: e.target.value } : x
                      ),
                    }));
                    markDirty();
                  }}
                />
                <Input
                  className="h-8 w-20 text-sm"
                  type="number"
                  min={1}
                  disabled={!editable}
                  value={c.quantidade}
                  onChange={(e) => {
                    setMeta((prev) => ({
                      ...prev,
                      chaves: prev.chaves.map((x, xi) =>
                        xi === i ? { ...x, quantidade: Number(e.target.value) || 1 } : x
                      ),
                    }));
                    markDirty();
                  }}
                />
                {editable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMeta((prev) => ({
                        ...prev,
                        chaves: prev.chaves.filter((_, xi) => xi !== i),
                      }));
                      markDirty();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setMeta((prev) => ({
                    ...prev,
                    chaves: [...prev.chaves, { tipo: "", quantidade: 1 }],
                  }));
                  markDirty();
                }}
              >
                <Plus className="mr-1 h-3 w-3" /> Chave
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Mobília deixada no imóvel</p>
            {meta.mobilia.map((mb, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1 text-sm"
                  placeholder="Item (ex.: armário da cozinha)"
                  disabled={!editable}
                  value={mb.item}
                  onChange={(e) => {
                    setMeta((prev) => ({
                      ...prev,
                      mobilia: prev.mobilia.map((x, xi) =>
                        xi === i ? { ...x, item: e.target.value } : x
                      ),
                    }));
                    markDirty();
                  }}
                />
                <Input
                  className="h-8 w-20 text-sm"
                  type="number"
                  min={1}
                  disabled={!editable}
                  value={mb.quantidade}
                  onChange={(e) => {
                    setMeta((prev) => ({
                      ...prev,
                      mobilia: prev.mobilia.map((x, xi) =>
                        xi === i ? { ...x, quantidade: Number(e.target.value) || 1 } : x
                      ),
                    }));
                    markDirty();
                  }}
                />
                <Select
                  value={mb.estado || "bom"}
                  disabled={!editable}
                  onValueChange={(v) => {
                    setMeta((prev) => ({
                      ...prev,
                      mobilia: prev.mobilia.map((x, xi) => (xi === i ? { ...x, estado: v } : x)),
                    }));
                    markDirty();
                  }}
                >
                  <SelectTrigger className="h-8 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="novo">Novo</SelectItem>
                    <SelectItem value="bom">Bom</SelectItem>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="ruim">Ruim</SelectItem>
                  </SelectContent>
                </Select>
                {editable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMeta((prev) => ({
                        ...prev,
                        mobilia: prev.mobilia.filter((_, xi) => xi !== i),
                      }));
                      markDirty();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setMeta((prev) => ({
                    ...prev,
                    mobilia: [...prev.mobilia, { item: "", quantidade: 1, estado: "bom" }],
                  }));
                  markDirty();
                }}
              >
                <Plus className="mr-1 h-3 w-3" /> Mobília
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1">
              <Label>Observações gerais</Label>
              <Textarea
                className="min-h-[60px] text-sm"
                disabled={!editable}
                value={meta.observacoesGerais ?? ""}
                onChange={(e) => {
                  setMeta((prev) => ({
                    ...prev,
                    observacoesGerais: e.target.value || undefined,
                  }));
                  markDirty();
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Prazo de contestação (dias)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                disabled={!editable}
                value={meta.prazoContestacaoDias ?? 7}
                onChange={(e) => {
                  setMeta((prev) => ({
                    ...prev,
                    prazoContestacaoDias: Number(e.target.value) || 7,
                  }));
                  markDirty();
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
