"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Send, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLICKSIGN_ROLE_OPTIONS, type ClicksignRole } from "@/lib/clicksign/roles";

interface Conjuge {
  nome?: string;
  cpf?: string;
  email?: string;
  incluir_como_signatario?: boolean;
}

interface Representante {
  nome?: string;
  cpf?: string;
  email?: string;
}

interface Parte {
  tipo_pessoa?: string;
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  conjuge?: Conjuge;
  // PJ: quem assina pela empresa é o representante (pessoa física com CPF).
  representante?: Representante;
}

interface Testemunha {
  nome?: string;
  cpf?: string;
  email?: string;
  incluir_como_signatario?: boolean;
}

interface Comissionado {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: string;
  email?: string;
  percentual?: number;
  valor?: number;
  incluir_como_signatario?: boolean;
}

interface Corretora {
  corretora_tipo_pessoa?: string;
  imobiliaria_nome?: string;
  imobiliaria_cnpj?: string;
  imobiliaria_email?: string;
  creci?: string;
  incluir_como_signatario?: boolean;
  /** Fonte canônica produzida pelo extractor Gemini (CCV import). Quando
   *  presente com >=1 item, prevalece sobre os campos legados acima. */
  comissionados?: Comissionado[];
}

interface SendEnvelopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractTitle: string;
  contractStatus: string;
  vendedores: Parte[];
  compradores: Parte[];
  testemunhas: Testemunha[];
  comissao: Corretora | null | undefined;
  onSent: () => void;
}

type RowKind = "vendedor" | "comprador" | "testemunha" | "corretora";
type SubKind = "titular" | "conjuge";

// Role ClickSign + opções do dropdown vêm de `lib/clicksign/roles` (fonte única).
const ROLE_OPTIONS = CLICKSIGN_ROLE_OPTIONS;

function defaultRoleFor(
  sourceKind: RowKind,
  subKind: SubKind,
  isPJ?: boolean
): ClicksignRole {
  if (subKind === "conjuge") return "consenting";
  switch (sourceKind) {
    case "vendedor":
      return "seller";
    case "comprador":
      return "buyer";
    case "testemunha":
      return "witness";
    case "corretora":
      return isPJ === false ? "intervening" : "realestate";
    default:
      return "sign";
  }
}

interface EditableRow {
  rowId: string;
  sourceKind: RowKind;
  sourceIndex: number;
  /** Pra vendedor/comprador: distingue titular vs cônjuge. Cônjuge só
   *  existe quando a parte titular tem `conjuge.nome` preenchido no form. */
  subKind: SubKind;
  name: string;
  email: string;
  documentation: string;
  includeInEnvelope: boolean;
  isOptional: boolean;
  addedDuringDialog: boolean;
  /** Para corretora: tipo de pessoa (afeta máscara do documento e label). */
  isPJ?: boolean;
  /** Qualificação ClickSign — usuário pode mudar o default se o papel
   *  não bate com o sourceKind (ex: corretor PF como Intermediador,
   *  Imobiliária PJ como Imobiliária, testemunha como Anuente). */
  clicksignRole: ClicksignRole;
}

const COST_PER_SIGNER_CENTS = 150;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function partyName(p: Parte): string {
  // `||` (não `??`): PJ com `nome: ""` + `razao_social` — o "" não cairia pro
  // razao_social com `??`, sumindo a PJ da lista de signatários. (fix 2026-06-03)
  return (p.nome || p.razao_social || "").trim();
}

function partyDoc(p: Parte): string {
  if (p.tipo_pessoa === "juridica") return (p.cnpj ?? "").replace(/\D/g, "");
  return (p.cpf ?? "").replace(/\D/g, "");
}

function maskCpfCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function buildInitialRows(
  vendedores: Parte[],
  compradores: Parte[],
  testemunhas: Testemunha[],
  comissao: Corretora | null | undefined
): EditableRow[] {
  const rows: EditableRow[] = [];

  const pushPartyRows = (
    sourceKind: "vendedor" | "comprador",
    partes: Parte[]
  ) => {
    partes.forEach((p, idx) => {
      // 2026-06-03 — Parte PJ: quem assina é o REPRESENTANTE (pessoa física com
      // CPF), não a empresa. A ClickSign rejeita o CNPJ como documentação de
      // signatário; e juridicamente é o representante que firma. Pré-preenche o
      // titular com nome/e-mail/CPF do representante quando a parte é juridica.
      const isPJ = p.tipo_pessoa === "juridica";
      const rep = p.representante;
      const titularName = isPJ
        ? (rep?.nome ?? "").trim() || partyName(p)
        : partyName(p);
      const titularEmail = (
        (isPJ ? rep?.email ?? p.email : p.email) ?? ""
      ).trim();
      const titularDoc = isPJ
        ? (rep?.cpf ?? "").replace(/\D/g, "") // CPF do representante, nunca o CNPJ
        : partyDoc(p);
      rows.push({
        rowId: `${sourceKind}-${idx}`,
        sourceKind,
        sourceIndex: idx,
        subKind: "titular",
        name: titularName,
        email: titularEmail,
        documentation: titularDoc,
        includeInEnvelope: true,
        isOptional: false,
        addedDuringDialog: false,
        clicksignRole: defaultRoleFor(sourceKind, "titular"),
      });
      // Cônjuge só vira linha quando o form trouxe nome explícito —
      // valor padrão pra estado civil "Solteiro(a)" deixa conjuge vazio.
      const conjugeName = (p.conjuge?.nome ?? "").trim();
      if (conjugeName) {
        const conjugeEmail = (p.conjuge?.email ?? "").trim();
        rows.push({
          rowId: `${sourceKind}-${idx}-conjuge`,
          sourceKind,
          sourceIndex: idx,
          subKind: "conjuge",
          name: conjugeName,
          email: conjugeEmail,
          documentation: (p.conjuge?.cpf ?? "").replace(/\D/g, ""),
          includeInEnvelope:
            Boolean(p.conjuge?.incluir_como_signatario) ||
            (conjugeEmail.length > 0 && EMAIL_REGEX.test(conjugeEmail)),
          isOptional: true,
          addedDuringDialog: false,
          clicksignRole: defaultRoleFor(sourceKind, "conjuge"),
        });
      }
    });
  };
  pushPartyRows("vendedor", vendedores);
  pushPartyRows("comprador", compradores);

  // Corretora: prioriza `comissao.comissionados[]` (canônico, populado pelo
  // extractor CCV) — pode ter N entradas (corretora + intermediária + sub).
  // Fallback pro legado `imobiliaria_*` quando o array vazio/ausente, pra
  // contratos do form Handlebars que não passam pelo extractor.
  const comissionados = comissao?.comissionados ?? [];
  if (comissionados.length > 0) {
    comissionados.forEach((c, idx) => {
      const isPJ =
        c.tipo_pessoa === "juridica" ||
        ((c.cnpj ?? "").replace(/\D/g, "").length === 14 &&
          !(c.cpf ?? "").replace(/\D/g, "").length);
      const doc = isPJ
        ? (c.cnpj ?? "").replace(/\D/g, "")
        : (c.cpf ?? "").replace(/\D/g, "");
      const email = (c.email ?? "").trim();
      rows.push({
        rowId: `corretora-${idx}`,
        sourceKind: "corretora",
        sourceIndex: idx,
        subKind: "titular",
        name: (c.nome ?? "").trim(),
        email,
        documentation: doc,
        includeInEnvelope:
          Boolean(c.incluir_como_signatario) ||
          (email.length > 0 && EMAIL_REGEX.test(email)),
        isOptional: true,
        addedDuringDialog: false,
        isPJ,
        clicksignRole: defaultRoleFor("corretora", "titular", isPJ),
      });
    });
  } else {
    const corrEmail = (comissao?.imobiliaria_email ?? "").trim();
    const corrName = (comissao?.imobiliaria_nome ?? "").trim();
    const corrDoc = (comissao?.imobiliaria_cnpj ?? "").replace(/\D/g, "");
    const isPJ = comissao?.corretora_tipo_pessoa !== "fisica";
    rows.push({
      rowId: "corretora-0",
      sourceKind: "corretora",
      sourceIndex: 0,
      subKind: "titular",
      name: corrName,
      email: corrEmail,
      documentation: corrDoc,
      includeInEnvelope:
        Boolean(comissao?.incluir_como_signatario) ||
        (corrEmail.length > 0 && EMAIL_REGEX.test(corrEmail)),
      isOptional: true,
      addedDuringDialog: false,
      isPJ,
      clicksignRole: defaultRoleFor("corretora", "titular", isPJ),
    });
  }

  // Testemunhas: começa com o array do form (mín 2 garantido pelo form).
  // Se vier vazio, garante 2 linhas vazias.
  const baseTestemunhas =
    testemunhas && testemunhas.length > 0
      ? testemunhas
      : [{ nome: "", cpf: "", email: "" }, { nome: "", cpf: "", email: "" }];
  baseTestemunhas.forEach((t, idx) => {
    const email = (t.email ?? "").trim();
    rows.push({
      rowId: `testemunha-${idx}`,
      sourceKind: "testemunha",
      sourceIndex: idx,
      subKind: "titular",
      name: (t.nome ?? "").trim(),
      email,
      documentation: (t.cpf ?? "").replace(/\D/g, ""),
      includeInEnvelope:
        Boolean(t.incluir_como_signatario) ||
        (email.length > 0 && EMAIL_REGEX.test(email)),
      isOptional: true,
      addedDuringDialog: false,
      clicksignRole: defaultRoleFor("testemunha", "titular"),
    });
  });

  return rows;
}

export function SendEnvelopeDialog({
  open,
  onOpenChange,
  contractId,
  contractTitle,
  contractStatus,
  vendedores,
  compradores,
  testemunhas,
  comissao,
  onSent,
}: SendEnvelopeDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [orderEnabled, setOrderEnabled] = useState(false);
  const [rows, setRows] = useState<EditableRow[]>(() =>
    buildInitialRows(vendedores, compradores, testemunhas, comissao)
  );

  // Reset state quando o dialog reabre — pega os dados mais recentes do deal
  // (caso o usuário tenha editado o form em outra aba).
  useEffect(() => {
    if (open) {
      setRows(buildInitialRows(vendedores, compradores, testemunhas, comissao));
      setSubmitting(false);
      setOrderEnabled(false);
    }
  }, [open, vendedores, compradores, testemunhas, comissao]);

  const includedRows = useMemo(
    () => rows.filter((r) => r.includeInEnvelope),
    [rows]
  );

  // Reordena assinantes incluídos (ordem de assinatura). Troca a posição do
  // row com o vizinho INCLUÍDO no array `rows` — a ordem dos grupos sai daí.
  const moveIncluded = (rowId: string, dir: -1 | 1) => {
    setRows((prev) => {
      const includedIdxs = prev
        .map((r, i) => ({ r, i }))
        .filter((x) => x.r.includeInEnvelope)
        .map((x) => x.i);
      const pos = includedIdxs.findIndex((i) => prev[i].rowId === rowId);
      const targetPos = pos + dir;
      if (pos < 0 || targetPos < 0 || targetPos >= includedIdxs.length) {
        return prev;
      }
      const a = includedIdxs[pos];
      const b = includedIdxs[targetPos];
      const copy = [...prev];
      [copy[a], copy[b]] = [copy[b], copy[a]];
      return copy;
    });
  };

  // Validação: cada row incluído precisa de nome >= 2 chars e email válido.
  const validationError = useMemo(() => {
    if (includedRows.length === 0) return "Inclua ao menos 1 signatário";
    for (const r of includedRows) {
      if (r.name.trim().length < 2) {
        return `Nome ausente em ${labelFor(r)}`;
      }
      if (!EMAIL_REGEX.test(r.email.trim())) {
        return `E-mail inválido em ${labelFor(r)}`;
      }
      const docDigits = r.documentation.replace(/\D/g, "");
      if (docDigits && docDigits.length !== 11 && docDigits.length !== 14) {
        return `CPF/CNPJ inválido em ${labelFor(r)}`;
      }
    }
    return null;
  }, [includedRows]);

  const costCents = includedRows.length * COST_PER_SIGNER_CENTS;
  const showApprovedWarning =
    contractStatus === "aprovado" &&
    rows.some((r) => r.addedDuringDialog && r.includeInEnvelope);

  const updateRow = (rowId: string, patch: Partial<EditableRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r))
    );
  };

  const addCorretor = () => {
    setRows((prev) => {
      const existing = prev.filter((r) => r.sourceKind === "corretora");
      const nextIndex = existing.length;
      return [
        ...prev,
        {
          rowId: `corretora-${nextIndex}-${Date.now()}`,
          sourceKind: "corretora",
          sourceIndex: nextIndex,
          subKind: "titular",
          name: "",
          email: "",
          documentation: "",
          includeInEnvelope: true,
          isOptional: true,
          addedDuringDialog: true,
          isPJ: true,
          clicksignRole: defaultRoleFor("corretora", "titular", true),
        },
      ];
    });
  };

  const removeCorretor = (rowId: string) => {
    setRows((prev) => {
      const filtered = prev.filter((r) => r.rowId !== rowId);
      let idx = 0;
      return filtered.map((r) => {
        if (r.sourceKind !== "corretora") return r;
        const next = { ...r, sourceIndex: idx };
        idx++;
        return next;
      });
    });
  };

  const addTestemunha = () => {
    setRows((prev) => {
      const existingTestemunhas = prev.filter(
        (r) => r.sourceKind === "testemunha"
      );
      const nextIndex = existingTestemunhas.length;
      return [
        ...prev,
        {
          rowId: `testemunha-${nextIndex}-${Date.now()}`,
          sourceKind: "testemunha",
          sourceIndex: nextIndex,
          subKind: "titular",
          name: "",
          email: "",
          documentation: "",
          includeInEnvelope: true,
          isOptional: true,
          addedDuringDialog: true,
          clicksignRole: defaultRoleFor("testemunha", "titular"),
        },
      ];
    });
  };

  const removeTestemunha = (rowId: string) => {
    setRows((prev) => {
      const filtered = prev.filter((r) => r.rowId !== rowId);
      // Reindexa as testemunhas restantes pra manter sourceIndex contíguo.
      let testIdx = 0;
      return filtered.map((r) => {
        if (r.sourceKind !== "testemunha") return r;
        const next = { ...r, sourceIndex: testIdx };
        testIdx++;
        return next;
      });
    });
  };

  const handleSend = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSubmitting(true);

    try {
      // 1) PATCH /signers-data — persiste edições no deal/form/contract.
      const updates = buildPatchUpdates(rows, vendedores, compradores);
      if (updates.length > 0) {
        const patchRes = await fetch(
          `/api/contracts/${contractId}/signers-data`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates }),
          }
        );
        if (!patchRes.ok) {
          const body = await patchRes.json().catch(() => ({}));
          throw new Error(
            body.error || `Falha ao salvar dados (HTTP ${patchRes.status})`
          );
        }
      }

      // 2) POST /envelopes — executor re-lê contract.dataJson agora atualizado.
      // Mandamos signerRoles pra o executor sobrescrever o default por
      // sourceKind quando o usuário escolheu role custom no select.
      // Ordem ON: grupo = posição do row entre os incluídos (1-based). OFF:
      // sem grupo (paralelo). includedRows já segue a ordem do array `rows`.
      const signerRoles = includedRows.map((r, idx) => ({
        sourceKind: r.sourceKind,
        sourceIndex: r.sourceIndex,
        subKind: r.subKind,
        role: r.clicksignRole,
        group: orderEnabled ? idx + 1 : undefined,
      }));
      const res = await fetch(`/api/contracts/${contractId}/envelopes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authMethod: "email", signerRoles }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(body.missing)) {
          toast.error(
            `Faltam e-mails em ${body.missing.length} parte(s). Verifique a lista.`
          );
          return;
        }
        if (res.status === 402) {
          toast.error(
            `Orçamento mensal excedido. Gasto: R$ ${(body.spentCents / 100).toFixed(2)} de R$ ${(body.budgetCents / 100).toFixed(2)}.`
          );
          return;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success("Envelope enviado para assinatura");
      onSent();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar para assinatura</DialogTitle>
          <DialogDescription>
            {contractTitle} — autenticação por token de e-mail. Edite ou
            complete os dados abaixo se algo estiver faltando.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <SignerGroup
            title="Vendedor(es)"
            description={
              rows.some(
                (r) => r.sourceKind === "vendedor" && r.subKind === "conjuge"
              )
                ? "Cônjuges são opcionais — marque se devem assinar digitalmente."
                : undefined
            }
            rows={rows.filter((r) => r.sourceKind === "vendedor")}
            onChange={updateRow}
          />

          <SignerGroup
            title="Comprador(es)"
            description={
              rows.some(
                (r) => r.sourceKind === "comprador" && r.subKind === "conjuge"
              )
                ? "Cônjuges são opcionais — marque se devem assinar digitalmente."
                : undefined
            }
            rows={rows.filter((r) => r.sourceKind === "comprador")}
            onChange={updateRow}
          />

          <SignerGroup
            title="Corretor / Imobiliária"
            description="Opcional. Marque cada corretor ou imobiliária que deve assinar digitalmente."
            rows={rows.filter((r) => r.sourceKind === "corretora")}
            onChange={updateRow}
            onRemove={removeCorretor}
            onAdd={addCorretor}
            addLabel="Adicionar Corretor"
          />

          <SignerGroup
            title="Testemunhas"
            description="Opcional. Marque cada testemunha que deve assinar digitalmente."
            rows={rows.filter((r) => r.sourceKind === "testemunha")}
            onChange={updateRow}
            onRemove={removeTestemunha}
            onAdd={addTestemunha}
            addLabel="Adicionar Assinante"
          />

          {/* Ordem de assinatura */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border bg-muted/30 px-3 py-2">
              <input
                type="checkbox"
                checked={orderEnabled}
                onChange={(e) => setOrderEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span className="font-medium">Assinar em ordem</span>
              <span className="text-xs text-muted-foreground">
                Cada signatário só é notificado depois que o anterior assina.
              </span>
            </label>
            {orderEnabled && includedRows.length > 0 && (
              <div className="rounded-md border divide-y">
                {includedRows.map((r, idx) => (
                  <div
                    key={r.rowId}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
                  >
                    <span className="truncate">
                      <span className="text-muted-foreground mr-1.5">{idx + 1}º</span>
                      {labelFor(r)}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        disabled={idx === 0}
                        onClick={() => moveIncluded(r.rowId, -1)}
                        title="Subir"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        disabled={idx === includedRows.length - 1}
                        onClick={() => moveIncluded(r.rowId, 1)}
                        title="Descer"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {showApprovedWarning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-amber-900 mb-1">
                <AlertTriangle className="h-4 w-4" />
                Testemunha adicionada após aprovação
              </div>
              <p className="text-amber-900">
                Testemunhas adicionadas aqui vão entrar no certificado da
                ClickSign, mas não aparecerão no corpo do PDF do contrato (que
                já está congelado pela aprovação). Para que apareçam no PDF,
                edite o formulário antes de aprovar e gere uma nova versão.
              </p>
            </div>
          )}

          {validationError && includedRows.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Wallet className="h-4 w-4" /> Custo estimado (
              {includedRows.length} signatário
              {includedRows.length === 1 ? "" : "s"})
            </span>
            <span className="text-sm font-medium">
              R$ {(costCents / 100).toFixed(2)}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={submitting || validationError !== null}
          >
            <Send className="h-4 w-4 mr-2" />
            {submitting ? "Enviando..." : "Enviar envelope"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignerGroup({
  title,
  description,
  rows,
  onChange,
  onRemove,
  onAdd,
  addLabel,
}: {
  title: string;
  description?: string;
  rows: EditableRow[];
  onChange: (rowId: string, patch: Partial<EditableRow>) => void;
  onRemove?: (rowId: string) => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  if (rows.length === 0 && !onAdd) return null;

  return (
    <section className="space-y-2">
      <header>
        <h4 className="text-sm font-semibold text-foreground/90">{title}</h4>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </header>

      <div className="space-y-3">
        {rows.map((row) => (
          <SignerRowEditor
            key={row.rowId}
            row={row}
            onChange={onChange}
            onRemove={onRemove}
          />
        ))}
      </div>

      {onAdd && (
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          {addLabel ?? "Adicionar"}
        </Button>
      )}
    </section>
  );
}

function SignerRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: EditableRow;
  onChange: (rowId: string, patch: Partial<EditableRow>) => void;
  onRemove?: (rowId: string) => void;
}) {
  const docLabel =
    row.sourceKind === "corretora" && row.isPJ === false
      ? "CPF"
      : row.sourceKind === "corretora"
        ? "CNPJ"
        : "CPF / CNPJ";

  // Permite remover testemunhas a partir da 3ª (sourceIndex >= 2) ou
  // qualquer testemunha adicionada na própria popup.
  // Pra corretora: a partir da 2ª (sourceIndex >= 1) ou addedDuringDialog —
  // sempre mantemos pelo menos 1 linha (mesmo vazia, pode ser preenchida).
  const canRemove =
    onRemove &&
    ((row.sourceKind === "testemunha" &&
      (row.addedDuringDialog || row.sourceIndex >= 2)) ||
      (row.sourceKind === "corretora" &&
        (row.addedDuringDialog || row.sourceIndex >= 1)));

  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-2",
        row.includeInEnvelope ? "bg-card" : "bg-muted/30"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        {row.isOptional ? (
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={row.includeInEnvelope}
              onChange={(e) =>
                onChange(row.rowId, { includeInEnvelope: e.target.checked })
              }
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Incluir como signatário
          </label>
        ) : (
          <span className="text-sm font-medium text-foreground">
            {labelFor(row)}
          </span>
        )}
        {canRemove && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => onRemove?.(row.rowId)}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Remover
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">Nome</Label>
          <Input
            value={row.name}
            onChange={(e) => onChange(row.rowId, { name: e.target.value })}
            placeholder={
              row.sourceKind === "corretora"
                ? "Nome do corretor ou razão social"
                : row.sourceKind === "testemunha"
                  ? "Nome completo da testemunha"
                  : "Nome completo"
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">E-mail</Label>
          <Input
            type="email"
            value={row.email}
            onChange={(e) => onChange(row.rowId, { email: e.target.value })}
            placeholder="email@exemplo.com"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{docLabel}</Label>
          <Input
            value={maskCpfCnpj(row.documentation)}
            onChange={(e) =>
              onChange(row.rowId, {
                documentation: e.target.value.replace(/\D/g, ""),
              })
            }
            placeholder="000.000.000-00"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">Assina como</Label>
          <select
            value={row.clicksignRole}
            onChange={(e) =>
              onChange(row.rowId, {
                clicksignRole: e.target.value as ClicksignRole,
              })
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function labelFor(row: EditableRow): string {
  const kindLabel = {
    vendedor: "Vendedor",
    comprador: "Comprador",
    testemunha: "Testemunha",
    corretora: "Corretor/Imobiliária",
  }[row.sourceKind];
  if (row.subKind === "conjuge") {
    return (
      row.name.trim() ||
      `Cônjuge de ${kindLabel.toLowerCase()} ${row.sourceIndex + 1}`
    );
  }
  return row.name.trim() || `${kindLabel} ${row.sourceIndex + 1}`;
}

/**
 * Constrói lista de updates dot-path para sincronizar `contract.dataJson`
 * com o que foi exibido na popup.
 *
 * Para vendedores/compradores SEMPRE empurra email/nome/CPF — não diff
 * contra o snapshot original. Motivo: a popup é construída a partir de
 * `deal.form.dataJson` (props), mas o executor lê `contract.dataJson` que
 * pode estar STALE (ex: contrato gerado antes do usuário preencher
 * emails). Diff-only deixava contract.dataJson desatualizado e o POST
 * /envelopes retornava "missing emails" mesmo com a popup mostrando tudo
 * preenchido.
 *
 * Testemunhas: sempre substitui o array inteiro (cobre add/remove/edit).
 * Corretora: sempre empurra todos os campos.
 */
function buildPatchUpdates(
  rows: EditableRow[],
  _originalVendedores: Parte[],
  _originalCompradores: Parte[]
): Array<{ path: string; value: unknown }> {
  const updates: Array<{ path: string; value: unknown }> = [];

  for (const r of rows) {
    if (r.sourceKind === "vendedor" || r.sourceKind === "comprador") {
      const arrName =
        r.sourceKind === "vendedor" ? "vendedores" : "compradores";
      const docDigits = r.documentation.replace(/\D/g, "");

      if (r.subKind === "conjuge") {
        // Cônjuge: nome/cpf/email + flag. PF sempre (cônjuge nunca é PJ).
        updates.push({
          path: `${arrName}.${r.sourceIndex}.conjuge.email`,
          value: r.email.trim(),
        });
        updates.push({
          path: `${arrName}.${r.sourceIndex}.conjuge.nome`,
          value: r.name.trim(),
        });
        if (docDigits.length > 0) {
          updates.push({
            path: `${arrName}.${r.sourceIndex}.conjuge.cpf`,
            value: docDigits,
          });
        }
        updates.push({
          path: `${arrName}.${r.sourceIndex}.conjuge.incluir_como_signatario`,
          value: r.includeInEnvelope,
        });
        continue;
      }

      updates.push({
        path: `${arrName}.${r.sourceIndex}.email`,
        value: r.email.trim(),
      });

      // Nome — escolhe campo (nome|razao_social) por inferência do CPF/CNPJ
      // disponível na popup. Quando vazio em ambos, default `nome`.
      const isPJ = docDigits.length === 14;
      const nameField = isPJ ? "razao_social" : "nome";
      updates.push({
        path: `${arrName}.${r.sourceIndex}.${nameField}`,
        value: r.name.trim(),
      });

      if (docDigits.length > 0) {
        const docField = isPJ ? "cnpj" : "cpf";
        updates.push({
          path: `${arrName}.${r.sourceIndex}.${docField}`,
          value: docDigits,
        });
      }
    }
  }

  // Corretora: substitui o array `comissao.comissionados` inteiro (cobre
  // add/remove/edit + flag). NÃO toca nos campos legados `imobiliaria_*` —
  // templates Handlebars antigos continuam consumindo esses no corpo do PDF
  // sem regredir. O array é a fonte canônica pro envelope ClickSign.
  const corretoraRows = rows
    .filter((r) => r.sourceKind === "corretora")
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
  updates.push({
    path: "comissao.comissionados",
    value: corretoraRows.map((r) => {
      const docDigits = r.documentation.replace(/\D/g, "");
      const isPJ =
        r.isPJ === true || (r.isPJ !== false && docDigits.length === 14);
      return {
        nome: r.name.trim(),
        cpf: isPJ ? "" : docDigits,
        cnpj: isPJ ? docDigits : "",
        tipo_pessoa: isPJ ? "juridica" : "fisica",
        email: r.email.trim(),
        incluir_como_signatario: r.includeInEnvelope,
      };
    }),
  });

  // Testemunhas: substitui o array inteiro (cobre add/remove/edit + flag).
  const testemunhasRows = rows
    .filter((r) => r.sourceKind === "testemunha")
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
  updates.push({
    path: "testemunhas",
    value: testemunhasRows.map((t) => ({
      nome: t.name.trim(),
      cpf: t.documentation.replace(/\D/g, ""),
      email: t.email.trim(),
      incluir_como_signatario: t.includeInEnvelope,
    })),
  });

  return updates;
}
