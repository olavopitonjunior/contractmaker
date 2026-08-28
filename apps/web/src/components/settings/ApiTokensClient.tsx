"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { ApiTokenScope } from "@/lib/auth/api-token";
import {
  ArrowLeft,
  Copy,
  KeyRound,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const SCOPES = [
  { id: "deals:rw", label: "Deals (read/write)", description: "CRUD de deals e movimentação no Kanban" },
  { id: "contracts:rw", label: "Contratos (read/write)", description: "Editar, comentar, sugerir e aprovar contratos" },
  { id: "charges:rw", label: "Cobranças Asaas (read/write)", description: "Criar e consultar cobranças e repasses" },
  { id: "signatures:rw", label: "Assinaturas ClickSign (read/write)", description: "Criar envelopes e gerenciar signatários" },
  { id: "documents:rw", label: "Documentos e certidões (read/write)", description: "Anexos, OCR e disparo de certidões Infosimples" },
  { id: "proposals:rw", label: "Propostas (read/write)", description: "Listar, criar, atribuir e sincronizar propostas. Enviar, converter e cancelar passam por aprovação humana (HITL)." },
  { id: "locacao:r", label: "Locação (read-only) — Max", description: "Carteira de locação: contratos, clientes, garantias, apólices, vistorias e cobranças de aluguel." },
  { id: "locacao:rw", label: "Locação (read/write) — Max", description: "Registrar análises de crédito, cotações de fiança, garantias e apólices. Inclui a leitura." },
  { id: "metrics:r", label: "Métricas (read-only)", description: "Saldos, contagens e atividade — sem dados pessoais" },
  { id: "agents:r", label: "Agentes (read-only) — Max", description: "Ler a configuração do agente externo: modelo, instruções, escopo de RAG e se está ligado." },
  { id: "agents:rw", label: "Agentes (read/write) — Max", description: "Além de ler, reportar o custo de cada turn pro painel de uso de IA. Inclui a leitura." },
  { id: "users:delegate", label: "Delegar como outro usuário (Newton)", description: "Permite header X-Act-As-User pra agir como qualquer user da mesma org. Use SÓ em tokens de agentes (Newton)." },
] as const;

type ScopeId = (typeof SCOPES)[number]["id"];

// Guard de compilação: todo scope do catálogo precisa estar listado acima.
// Sem isto, um scope novo entra em API_TOKEN_SCOPES (o backend passa a aceitar)
// mas fica INVISÍVEL na UI — foi o que aconteceu com proposals:rw e locacao:*,
// que ficaram impossíveis de conceder mesmo com as rotas já no ar.
type MissingFromUi = Exclude<ApiTokenScope, ScopeId>;
const _assertEveryScopeIsListed: MissingFromUi extends never ? true : never = true;
void _assertEveryScopeIsListed;

const VALIDITY_OPTIONS = [
  { id: "30", label: "30 dias", days: 30 },
  { id: "90", label: "90 dias", days: 90 },
  { id: "365", label: "1 ano", days: 365 },
  { id: "never", label: "Sem expiração", days: null },
] as const;

interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface CreatedTokenResponse {
  rawToken: string;
  token: {
    id: string;
    name: string;
    scopes: string[];
    expiresAt: string | null;
    createdAt: string;
  };
  warning: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function tokenStatus(t: ApiToken): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (t.revokedAt) return { label: "Revogado", variant: "destructive" };
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) {
    return { label: "Expirado", variant: "secondary" };
  }
  return { label: "Ativo", variant: "default" };
}

export function ApiTokensClient({ initialTokens }: { initialTokens: ApiToken[] }) {
  const [tokens, setTokens] = useState<ApiToken[]>(initialTokens);
  const [createOpen, setCreateOpen] = useState(false);
  const [rawTokenResult, setRawTokenResult] = useState<CreatedTokenResponse | null>(
    null
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...tokens].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [tokens]
  );

  async function handleCreate(input: {
    name: string;
    scopes: ScopeId[];
    validity: (typeof VALIDITY_OPTIONS)[number]["id"];
  }) {
    const validityCfg = VALIDITY_OPTIONS.find((v) => v.id === input.validity)!;
    const body: { name: string; scopes: string[]; expiresInDays?: number } = {
      name: input.name,
      scopes: input.scopes,
    };
    if (validityCfg.days != null) body.expiresInDays = validityCfg.days;

    const res = await fetch("/api/me/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error ?? "Falha ao criar token");
      return;
    }
    const data = (await res.json()) as CreatedTokenResponse;
    setTokens((prev) => [
      {
        id: data.token.id,
        name: data.token.name,
        scopes: data.token.scopes,
        lastUsedAt: null,
        expiresAt: data.token.expiresAt,
        revokedAt: null,
        createdAt: data.token.createdAt,
      },
      ...prev,
    ]);
    setCreateOpen(false);
    setRawTokenResult(data);
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/me/api-tokens/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Falha ao revogar token");
        return;
      }
      const now = new Date().toISOString();
      setTokens((prev) =>
        prev.map((t) => (t.id === id ? { ...t, revokedAt: now } : t))
      );
      toast.success("Token revogado");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
        <h1 className="font-display tracking-tight text-2xl font-semibold flex items-center gap-2">
          <KeyRound className="h-6 w-6" />
          API Tokens
        </h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Tokens de acesso programático</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Permita que agentes externos (Newton, Claude Desktop, GPTs)
                ajam em seu nome via API. Use scopes mínimos necessários.
              </p>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-1" />
                  Novo token
                </Button>
              </DialogTrigger>
              <CreateTokenDialog onSubmit={handleCreate} />
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum token criado ainda. Clique em &quot;Novo token&quot; para
              começar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Nome</th>
                    <th className="py-2 pr-4 font-medium">Scopes</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Criado</th>
                    <th className="py-2 pr-4 font-medium">Último uso</th>
                    <th className="py-2 pr-4 font-medium">Expira</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => {
                    const status = tokenStatus(t);
                    const canRevoke = !t.revokedAt;
                    return (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="py-3 pr-4 font-medium">{t.name}</td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {t.scopes.map((s) => (
                              <Badge
                                key={s}
                                variant="outline"
                                className="text-[10px] font-mono"
                              >
                                {s}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatDate(t.createdAt)}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatDate(t.lastUsedAt)}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatDate(t.expiresAt)}
                        </td>
                        <td className="py-3">
                          {canRevoke && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={revokingId === t.id}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Revogar token &quot;{t.name}&quot;?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Qualquer cliente externo usando este token
                                    receberá 401 a partir de agora. Esta ação
                                    não pode ser desfeita.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleRevoke(t.id)}
                                  >
                                    Revogar
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={rawTokenResult != null}
        onOpenChange={(open) => !open && setRawTokenResult(null)}
      >
        <RawTokenDialog data={rawTokenResult} />
      </Dialog>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// CreateTokenDialog
// ───────────────────────────────────────────────────────────────────────────

function CreateTokenDialog({
  onSubmit,
}: {
  onSubmit: (input: {
    name: string;
    scopes: ScopeId[];
    validity: (typeof VALIDITY_OPTIONS)[number]["id"];
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ScopeId[]>([]);
  const [validity, setValidity] = useState<
    (typeof VALIDITY_OPTIONS)[number]["id"]
  >("365");
  const [submitting, setSubmitting] = useState(false);

  function toggleScope(s: ScopeId) {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0 || scopes.length === 0) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), scopes, validity });
      setName("");
      setScopes([]);
      setValidity("365");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Criar novo API Token</DialogTitle>
        <DialogDescription>
          O token será exibido apenas uma vez após a criação. Salve em local
          seguro (gerenciador de senhas).
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="token-name">Nome</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Newton (VPS prod)"
            maxLength={100}
            required
          />
          <p className="text-xs text-muted-foreground">
            Apelido para identificar o token na lista. Não afeta autenticação.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Scopes</Label>
          <div className="space-y-2 border rounded-md p-3">
            {SCOPES.map((s) => (
              <label
                key={s.id}
                className="flex items-start gap-3 cursor-pointer hover:bg-muted/50 -mx-1 px-1 py-1 rounded"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(s.id)}
                  onChange={() => toggleScope(s.id)}
                  className="mt-1 h-4 w-4"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.label}</span>
                    <code className="text-[10px] text-muted-foreground font-mono">
                      {s.id}
                    </code>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
          {scopes.length === 0 && (
            <p className="text-xs text-destructive">
              Selecione pelo menos um scope.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="token-validity">Validade</Label>
          <Select value={validity} onValueChange={(v) => setValidity(v as typeof validity)}>
            <SelectTrigger id="token-validity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALIDITY_OPTIONS.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            type="submit"
            disabled={
              submitting || name.trim().length === 0 || scopes.length === 0
            }
          >
            {submitting ? "Criando…" : "Criar token"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// RawTokenDialog (mostra token cru — uma vez só)
// ───────────────────────────────────────────────────────────────────────────

function RawTokenDialog({ data }: { data: CreatedTokenResponse | null }) {
  if (!data) return null;

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.rawToken);
      toast.success("Copiado para a área de transferência");
    } catch {
      toast.error("Não foi possível copiar — copie manualmente");
    }
  }

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          Salve este token agora
        </DialogTitle>
        <DialogDescription>
          O token <strong>não</strong> será exibido novamente. Após fechar este
          diálogo, recuperá-lo é impossível — você terá que criar um novo.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="rounded-md border bg-muted/40 p-3">
          <code className="text-xs font-mono break-all select-all">
            {data.rawToken}
          </code>
        </div>

        <Button onClick={copy} variant="outline" className="w-full">
          <Copy className="h-4 w-4 mr-2" />
          Copiar token
        </Button>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Uso:</strong>{" "}
            <code>Authorization: Bearer {"<rawToken>"}</code>
          </p>
          <p>
            <strong>Scopes:</strong>{" "}
            <code className="font-mono">{data.token.scopes.join(", ")}</code>
          </p>
          {data.token.expiresAt && (
            <p>
              <strong>Expira em:</strong>{" "}
              {new Date(data.token.expiresAt).toLocaleDateString("pt-BR")}
            </p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="default" onClick={() => copy()}>
          Já salvei
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
