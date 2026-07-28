"use client";

import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface SwitchableOrg {
  id: string;
  name: string;
  subdomain: string | null;
  suspended: boolean;
}

/**
 * Seletor de tenant do super_admin (header do dashboard).
 *
 * Um clique troca a org ativa: POST /api/admin/orgs/[id]/impersonate abre a
 * sessão de impersonation (auditada, TTL 8h) e o reload traz o app inteiro já
 * dentro do tenant — com as permissões do dono (ver lib/auth/impersonation.ts).
 * "Minha organização" encerra a impersonation e volta pra org de origem.
 *
 * Só é renderizado pra quem tem PlatformRole super_admin (gate no layout, e o
 * backend revalida a role a cada request — o cookie sozinho não basta).
 */
export function TenantSwitcher({
  orgs,
  currentOrgId,
  homeOrgId,
  impersonating,
}: {
  orgs: SwitchableOrg[];
  currentOrgId: string | null;
  homeOrgId: string | null;
  impersonating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const current = orgs.find((o) => o.id === currentOrgId);

  async function switchTo(org: SwitchableOrg) {
    if (org.id === currentOrgId) {
      setOpen(false);
      return;
    }
    setBusy(org.id);
    try {
      // Voltar pra org de origem = encerrar a impersonation, não impersonar a
      // própria org (o overlay só existe pra tenant de terceiro).
      const res =
        org.id === homeOrgId && impersonating
          ? await fetch(`/api/admin/orgs/${currentOrgId}/impersonate`, {
              method: "DELETE",
            })
          : await fetch(`/api/admin/orgs/${org.id}/impersonate`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({}),
            });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao trocar de tenant");
        setBusy(null);
        return;
      }
      // Reload duro: o overlay de identidade é resolvido no servidor a cada
      // request — router.refresh() não invalidaria o payload RSC já em cache.
      // "/" roteia por módulo (tenant só-locação cai em /locacao).
      window.location.href = "/";
    } catch {
      toast.error("Falha de rede ao trocar de tenant.");
      setBusy(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Trocar de tenant"
          className="h-8 max-w-[190px] gap-2 px-2 text-xs font-medium"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{current?.name ?? "Selecionar tenant"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Buscar tenant…" className="h-9" />
          <CommandList>
            <CommandEmpty>Nenhum tenant encontrado.</CommandEmpty>
            <CommandGroup heading="Tenants">
              {orgs.map((org) => (
                <CommandItem
                  key={org.id}
                  value={`${org.name} ${org.subdomain ?? ""}`}
                  onSelect={() => switchTo(org)}
                  disabled={busy != null}
                >
                  {busy === org.id ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check
                      className={
                        org.id === currentOrgId
                          ? "mr-2 h-3.5 w-3.5 opacity-100"
                          : "mr-2 h-3.5 w-3.5 opacity-0"
                      }
                    />
                  )}
                  <span className="truncate">{org.name}</span>
                  {org.id === homeOrgId && (
                    <span className="ml-auto pl-2 text-[10px] text-muted-foreground">
                      minha org
                    </span>
                  )}
                  {org.suspended && (
                    <span className="ml-auto pl-2 text-[10px] text-destructive">
                      suspenso
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="painel da plataforma"
                onSelect={() => {
                  window.location.href = "/admin/orgs";
                }}
              >
                <span className="text-muted-foreground">Painel da plataforma →</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
