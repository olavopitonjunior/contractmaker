"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

const CAPABILITY_LABELS: Record<string, string> = {
  view: "Visualizar",
  create_charge: "Criar cobrança",
  init_transfer: "Iniciar transferência",
  configure: "Configurar",
};

const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
  view: "KPIs, extrato, lista de cobranças e clientes",
  create_charge: "Emitir cobranças, cancelar, refund, mark received in cash",
  init_transfer: "Sacar saldo (PIX/TED) com dual-approval acima do cap",
  configure: "Editar taxas, branding e repasses dessa conta",
};

interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  isOwner: boolean;
  capabilities: string[];
}

interface State {
  accountId: string;
  capabilities: string[];
  members: Member[];
}

export function AccountPermissionsEditor({ accountId }: { accountId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [pendingByUser, setPendingByUser] = useState<Record<string, Set<string>>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/financeiro/accounts/${accountId}/permissions`,
        { credentials: "include" }
      );
      if (!res.ok) {
        toast.error("Falha ao carregar permissões");
        return;
      }
      const data: State = await res.json();
      setState(data);
      const initial: Record<string, Set<string>> = {};
      for (const m of data.members) {
        initial[m.userId] = new Set(m.capabilities);
      }
      setPendingByUser(initial);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Dependência pré-existente à adoção do ESLint (#374). Incluir `load` muda
    // quando o efeito redispara; não foi avaliado neste PR de higiene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function toggle(userId: string, cap: string, checked: boolean) {
    setPendingByUser((prev) => {
      const next = new Set(prev[userId] ?? []);
      if (checked) next.add(cap);
      else next.delete(cap);
      return { ...prev, [userId]: next };
    });
  }

  async function save(userId: string) {
    if (!state) return;
    setSaving(userId);
    try {
      const caps = Array.from(pendingByUser[userId] ?? []);
      const res = await fetch(
        `/api/financeiro/accounts/${accountId}/permissions`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, capabilities: caps }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao salvar permissões");
        return;
      }
      toast.success("Permissões atualizadas");
      void load();
    } finally {
      setSaving(null);
    }
  }

  if (loading || !state) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 mx-auto animate-spin mb-2" />
          Carregando...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="py-4 text-xs text-muted-foreground space-y-1">
          {state.capabilities.map((cap) => (
            <div key={cap}>
              <strong className="text-foreground">
                {CAPABILITY_LABELS[cap] ?? cap}:
              </strong>{" "}
              {CAPABILITY_DESCRIPTIONS[cap] ?? ""}
            </div>
          ))}
        </CardContent>
      </Card>

      {state.members.map((m) => {
        const current = pendingByUser[m.userId] ?? new Set();
        const stored = new Set(m.capabilities);
        const dirty =
          current.size !== stored.size ||
          [...current].some((c) => !stored.has(c)) ||
          [...stored].some((c) => !current.has(c));

        return (
          <Card key={m.userId}>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {m.name}
                    {m.isOwner && (
                      <Badge variant="default" className="text-[10px]">
                        OWNER
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {m.role}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </div>
                {!m.isOwner && (
                  <Button
                    size="sm"
                    onClick={() => save(m.userId)}
                    disabled={!dirty || saving === m.userId}
                  >
                    {saving === m.userId ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Salvar
                  </Button>
                )}
              </div>

              {m.isOwner ? (
                <p className="text-xs text-muted-foreground italic">
                  Owner herda todas as capabilities implicitamente — não é
                  possível restringir aqui.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {state.capabilities.map((cap) => (
                    <label
                      key={cap}
                      className="flex items-center gap-2 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={current.has(cap)}
                        onChange={(e) =>
                          toggle(m.userId, cap, e.target.checked)
                        }
                      />
                      <span>{CAPABILITY_LABELS[cap] ?? cap}</span>
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
