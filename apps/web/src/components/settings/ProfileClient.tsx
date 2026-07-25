"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  User as UserIcon,
  MapPin,
  KeyRound,
  Shield,
  ShieldCheck,
  Smartphone,
  FileText,
  Download,
  Trash2,
} from "lucide-react";
import { formatCpf } from "@/lib/validators/cpf";
import { formatBrPhone } from "@/lib/validators/phone-br";
import { NotificationChannelsCard } from "@/components/settings/NotificationChannelsCard";

export interface ProfileInitial {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  phone: string | null;
  cpf: string | null;
  birthDate: string | null;
  incomeValueCents: number | null;
  postalCode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressNeighborhood: string | null;
  addressCity: string | null;
  addressState: string | null;
}

export interface TwoFAStatus {
  enabled: boolean;
}

interface Props {
  initial: ProfileInitial;
  twoFAStatus: TwoFAStatus;
}

function emptyToNull<T>(v: T | "" | null | undefined): T | null {
  if (v === "" || v === null || v === undefined) return null;
  return v as T;
}

export function ProfileClient({ initial, twoFAStatus }: Props) {
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold">Meu perfil</h1>
          <p className="text-sm text-muted-foreground">
            Dados pessoais usados na plataforma e no onboarding de subcontas Asaas.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings">Voltar pra Configurações</Link>
        </Button>
      </header>

      <PersonalCard initial={initial} />
      <NotificationChannelsCard />
      <AddressCard initial={initial} />
      <PasswordCard twoFAEnabled={twoFAStatus.enabled} />
      <SecurityShortcuts twoFAEnabled={twoFAStatus.enabled} />
      <PrivacyCard />
    </div>
  );
}

function PersonalCard({ initial }: { initial: ProfileInitial }) {
  const [name, setName] = useState(initial.name ?? "");
  const [phone, setPhone] = useState(
    initial.phone ? formatBrPhone(initial.phone) : ""
  );
  const [cpf, setCpf] = useState(initial.cpf ? formatCpf(initial.cpf) : "");
  const [birthDate, setBirthDate] = useState(initial.birthDate ?? "");
  const [incomeReais, setIncomeReais] = useState(
    initial.incomeValueCents != null
      ? (initial.incomeValueCents / 100).toFixed(2)
      : ""
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim() || undefined,
        phone: emptyToNull(phone.trim()),
        cpf: emptyToNull(cpf.trim()),
        birthDate: emptyToNull(birthDate.trim()),
      };
      if (incomeReais.trim() === "") {
        body.incomeValueCents = null;
      } else {
        const n = Number(incomeReais.replace(",", "."));
        if (Number.isNaN(n) || n < 0) {
          toast.error("Renda inválida");
          return;
        }
        body.incomeValueCents = Math.round(n * 100);
      }
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao salvar perfil");
        return;
      }
      toast.success("Perfil atualizado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserIcon className="h-5 w-5" /> Dados pessoais
        </CardTitle>
        <CardDescription>
          Esses dados pré-populam a abertura de subconta Asaas (CPF, telefone, renda).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="p-name">Nome completo</Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="p-email">Email</Label>
            <Input id="p-email" value={initial.email} disabled />
            <p className="text-xs text-muted-foreground mt-1">
              Email é a identidade da conta — fale com o suporte pra alterar.
            </p>
          </div>
          <div>
            <Label htmlFor="p-cpf">CPF</Label>
            <Input
              id="p-cpf"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
            />
          </div>
          <div>
            <Label htmlFor="p-phone">Celular</Label>
            <Input
              id="p-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 9 9999-9999"
            />
          </div>
          <div>
            <Label htmlFor="p-dob">Data de nascimento</Label>
            <Input
              id="p-dob"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="p-income">Renda mensal (R$)</Label>
            <Input
              id="p-income"
              inputMode="decimal"
              value={incomeReais}
              onChange={(e) => setIncomeReais(e.target.value)}
              placeholder="0,00"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Salvando..." : "Salvar dados pessoais"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddressCard({ initial }: { initial: ProfileInitial }) {
  const [postalCode, setPostalCode] = useState(initial.postalCode ?? "");
  const [street, setStreet] = useState(initial.addressStreet ?? "");
  const [number, setNumber] = useState(initial.addressNumber ?? "");
  const [complement, setComplement] = useState(initial.addressComplement ?? "");
  const [neighborhood, setNeighborhood] = useState(
    initial.addressNeighborhood ?? ""
  );
  const [city, setCity] = useState(initial.addressCity ?? "");
  const [state, setState] = useState(initial.addressState ?? "");
  const [saving, setSaving] = useState(false);

  async function lookupCep() {
    const cep = postalCode.replace(/\D/g, "");
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) return;
      if (!street) setStreet(data.logradouro ?? "");
      if (!neighborhood) setNeighborhood(data.bairro ?? "");
      if (!city) setCity(data.localidade ?? "");
      if (!state) setState((data.uf ?? "").toUpperCase());
    } catch (e) {
      console.warn("[ProfileClient] falha no lookup de CEP", e);
    }
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      const body = {
        postalCode: emptyToNull(postalCode.trim()),
        addressStreet: emptyToNull(street.trim()),
        addressNumber: emptyToNull(number.trim()),
        addressComplement: emptyToNull(complement.trim()),
        addressNeighborhood: emptyToNull(neighborhood.trim()),
        addressCity: emptyToNull(city.trim()),
        addressState: emptyToNull(state.trim().toUpperCase()),
      };
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao salvar endereço");
        return;
      }
      toast.success("Endereço atualizado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" /> Endereço
        </CardTitle>
        <CardDescription>
          Usado no KYC da subconta Asaas. Digite o CEP e confirme os campos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="a-cep">CEP</Label>
            <Input
              id="a-cep"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              onBlur={lookupCep}
              placeholder="00000-000"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="a-street">Logradouro</Label>
            <Input
              id="a-street"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="a-num">Número</Label>
            <Input
              id="a-num"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="a-comp">Complemento</Label>
            <Input
              id="a-comp"
              value={complement}
              onChange={(e) => setComplement(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="a-neighbor">Bairro</Label>
            <Input
              id="a-neighbor"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="a-city">Cidade</Label>
            <Input
              id="a-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="a-state">UF</Label>
            <Input
              id="a-state"
              maxLength={2}
              value={state}
              onChange={(e) =>
                setState(e.target.value.toUpperCase().slice(0, 2))
              }
              placeholder="SP"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Salvando..." : "Salvar endereço"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordCard({ twoFAEnabled }: { twoFAEnabled: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (next.length < 8) {
      toast.error("A nova senha precisa ter pelo menos 8 caracteres");
      return;
    }
    if (next !== confirm) {
      toast.error("Senhas não conferem");
      return;
    }
    if (twoFAEnabled && code.length !== 6) {
      toast.error("Informe o código 2FA (6 dígitos)");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        currentPassword: current,
        newPassword: next,
      };
      if (twoFAEnabled) body.twoFactorCode = code;
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao trocar senha");
        return;
      }
      toast.success(
        "Senha alterada. Outros dispositivos serão deslogados na próxima requisição."
      );
      setCurrent("");
      setNext("");
      setConfirm("");
      setCode("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" /> Senha
        </CardTitle>
        <CardDescription>
          Alterar senha estando logado. Outros dispositivos serão deslogados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pw-curr">Senha atual</Label>
            <Input
              id="pw-curr"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          {twoFAEnabled && (
            <div>
              <Label htmlFor="pw-2fa">Código 2FA</Label>
              <Input
                id="pw-2fa"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="font-mono text-center tracking-widest"
              />
            </div>
          )}
          <div>
            <Label htmlFor="pw-new">Nova senha</Label>
            <Input
              id="pw-new"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">Mínimo 8 caracteres.</p>
          </div>
          <div>
            <Label htmlFor="pw-confirm">Confirmar nova senha</Label>
            <Input
              id="pw-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={saving || !current || !next}>
            {saving ? "Trocando..." : "Trocar senha"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityShortcuts({ twoFAEnabled }: { twoFAEnabled: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" /> Segurança
        </CardTitle>
        <CardDescription>
          Atalhos pra páginas dedicadas (a configuração mora em /settings/seguranca).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="border rounded p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4" /> 2FA
            </div>
            <Badge variant={twoFAEnabled ? "default" : "secondary"} className={twoFAEnabled ? "bg-green-600" : undefined}>
              {twoFAEnabled ? "Ativo" : "Não configurado"}
            </Badge>
            <Button variant="link" size="sm" className="px-0" asChild>
              <Link href="/settings/seguranca">Gerenciar</Link>
            </Button>
          </div>
          <div className="border rounded p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Smartphone className="h-4 w-4" /> Dispositivos
            </div>
            <p className="text-xs text-muted-foreground">
              Lista e revogação de dispositivos confiáveis.
            </p>
            <Button variant="link" size="sm" className="px-0" asChild>
              <Link href="/settings/seguranca">Abrir</Link>
            </Button>
          </div>
          <div className="border rounded p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4" /> Atividade
            </div>
            <p className="text-xs text-muted-foreground">
              Histórico de ações da sua conta.
            </p>
            <Button variant="link" size="sm" className="px-0" asChild>
              <Link href="/settings/seguranca/audit-log">Abrir</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PrivacyCard() {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch("/api/me/data-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao excluir conta");
        return;
      }
      toast.success(
        "Solicitação registrada. Sua conta será excluída em 30 dias. Faça logout para confirmar."
      );
      setConfirmation("");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" /> Privacidade (LGPD)
        </CardTitle>
        <CardDescription>
          Exporte seus dados ou solicite exclusão da conta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/me/data-export" download>
              <Download className="h-4 w-4 mr-1" /> Exportar meus dados (JSON)
            </a>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 mr-1" /> Excluir minha conta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir conta</AlertDialogTitle>
                <AlertDialogDescription>
                  Soft-delete com janela de 30 dias pra reversal. Após isso, a
                  conta é apagada de forma permanente. Digite exatamente{" "}
                  <strong>EXCLUIR MINHA CONTA</strong> pra confirmar.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="EXCLUIR MINHA CONTA"
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={
                    deleting || confirmation !== "EXCLUIR MINHA CONTA"
                  }
                >
                  {deleting ? "Excluindo..." : "Confirmar exclusão"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
