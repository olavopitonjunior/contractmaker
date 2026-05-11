"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, CheckCircle2, Wallet, Settings } from "lucide-react";
import Link from "next/link";

interface AccountOption {
  id: string;
  label: string;
  walletIdMasked: string;
  isActive: boolean;
}

interface AccountSwitcherProps {
  currentAccountId: string;
  accounts: AccountOption[];
}

/**
 * Seletor de conta financeira. Atualiza o `?accountId=` da URL ao trocar a
 * conta visualizada (não muda a ativa da org). Botão "Tornar ativa" chama
 * /api/financeiro/accounts/[id]/activate (requer elevation BANK_ACCOUNT_SWITCH
 * — se 403, redireciona pra /elevation pra captar o token).
 *
 * Self-aware: se há `?accountId=` no URL, ele vence sobre `currentAccountId`
 * passado pelo server (que reflete a conta ativa da org).
 */
export function AccountSwitcher({
  currentAccountId,
  accounts,
}: AccountSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activating, setActivating] = useState<string | null>(null);

  if (accounts.length === 0) return null;
  const urlAccountId = searchParams?.get("accountId") ?? null;
  const focusedId =
    (urlAccountId && accounts.find((a) => a.id === urlAccountId)?.id) ||
    currentAccountId;
  const current =
    accounts.find((a) => a.id === focusedId) ?? accounts[0];

  function navigateToAccount(id: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("accountId", id);
    router.push(`?${params.toString()}`);
    router.refresh();
  }

  async function setActive(id: string) {
    setActivating(id);
    try {
      const res = await fetch(`/api/financeiro/accounts/${id}/activate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "ELEVATION_REQUIRED") {
          toast.error(
            "Confirmação de identidade necessária para trocar a conta ativa."
          );
        } else {
          toast.error(data.error ?? "Sem permissão para ativar conta");
        }
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao ativar conta");
        return;
      }
      toast.success("Conta ativa atualizada");
      navigateToAccount(id);
    } finally {
      setActivating(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
        <Wallet className="h-4 w-4" />
        <span className="font-medium">{current.label}</span>
        {current.isActive && (
          <Badge variant="secondary" className="text-xs">
            ATIVA
          </Badge>
        )}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Contas bancárias</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onClick={() => navigateToAccount(a.id)}
            className="flex flex-col items-start gap-1 py-2"
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-medium">{a.label}</span>
              <div className="flex items-center gap-1">
                {a.isActive && (
                  <Badge variant="secondary" className="text-[10px]">
                    ATIVA
                  </Badge>
                )}
                {a.id === focusedId && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                )}
              </div>
            </div>
            <code className="text-xs text-muted-foreground">
              {a.walletIdMasked}
            </code>
            {!a.isActive && (
              <button
                type="button"
                disabled={activating === a.id}
                className="text-xs text-blue-600 hover:underline mt-1"
                onClick={(e) => {
                  e.stopPropagation();
                  void setActive(a.id);
                }}
              >
                {activating === a.id ? "Ativando..." : "Tornar ativa"}
              </button>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/pagamentos/contas" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Gerenciar contas
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
