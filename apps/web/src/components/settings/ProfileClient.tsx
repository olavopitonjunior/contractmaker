"use client";

import { useMemo, useState } from "react";
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
import { formatCpf, isValidCpf, onlyDigits } from "@/lib/validators/cpf";
import { formatBrPhone, normalizeBrPhone } from "@/lib/validators/phone-br";
import { NotificationChannelsCard } from "@/components/settings/NotificationChannelsCard";
import { useSettingsAutoSave } from "@/hooks/use-settings-auto-save";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";

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
  /** false = conta veio de convite/provisionamento e nunca definiu senha. */
  hasPassword: boolean;
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

/**
 * Renda digitada em reais → centavos, no formato que a rota espera.
 *
 * Campo vazio é "não informado" (`null`), NÃO zero — `Number("")` é `0` e passa
 * em `isFinite`, e gravar 0 aqui diria à subconta Asaas que a pessoa não tem
 * renda. Texto que ainda não é número devolve `NaN`, que a validação abaixo
 * reprova: nada sai enquanto o valor não fizer sentido.
 */
export function rendaEmCentavos(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

/**
 * Espelha o Zod de `PATCH /api/me/profile` campo a campo.
 *
 * Sem isto o auto-save gravaria o estado intermediário da digitação e tomaria
 * 400 a cada tecla: `name` é `min(1)`, `addressState` é `length(2)` (e `""` não
 * é `null` para o Zod), CEP exige 8 dígitos e o CPF passa pelo dígito
 * verificador. O botão que saiu daqui protegia esses casos por acidente — só
 * saía requisição quando a pessoa declarava ter terminado.
 */
export function erroDePessoais(f: {
  name: string;
  phone: string | null;
  cpf: string | null;
  birthDate: string | null;
  incomeValueCents: number | null;
}): Record<string, string> {
  // As chaves do retorno são as chaves do PAYLOAD, não rótulos de tela: é assim
  // que `invalidKeys` consegue remover exatamente o campo ruim do PATCH.
  const e: Record<string, string> = {};
  if (f.name.trim() === "") e.name = "Informe seu nome.";
  else if (f.name.trim().length > 200) e.name = "Nome muito longo (máx. 200).";
  if (f.cpf && f.cpf.length > 20) e.cpf = "CPF muito longo.";
  else if (f.cpf && !isValidCpf(f.cpf)) e.cpf = "CPF inválido.";
  if (f.phone && f.phone.length > 40) e.phone = "Telefone muito longo.";
  else if (f.phone && !normalizeBrPhone(f.phone))
    e.phone = "Telefone inválido — use DDD + número.";
  if (f.birthDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.birthDate);
    const ano = m ? Number(m[1]) : 0;
    // O input `type="date"` produz datas absurdas enquanto se digita o ano
    // ("0002-01-01"). Ano implausível é digitação em curso, não data.
    if (!m || ano < 1900 || ano > new Date().getFullYear()) {
      e.birthDate = "Data de nascimento incompleta.";
    }
  }
  if (f.incomeValueCents !== null) {
    if (!Number.isFinite(f.incomeValueCents)) e.incomeValueCents = "Renda inválida.";
    // Teto do Zod da rota. Sem espelhar, um dígito a mais passa daqui e toma
    // 400 a cada ciclo do debounce, com mensagem genérica.
    else if (f.incomeValueCents > 2_000_000_000)
      e.incomeValueCents = "Renda acima do limite.";
  }
  return e;
}

/** Limites `.max()` do Zod para os campos livres de endereço. */
const MAX_ENDERECO: Record<string, number> = {
  addressStreet: 200,
  addressNumber: 40,
  addressComplement: 100,
  addressNeighborhood: 100,
  addressCity: 100,
  postalCode: 20,
};

export function erroDeEndereco(
  f: Record<string, string | null>
): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.postalCode && onlyDigits(f.postalCode).length !== 8) {
    e.postalCode = "CEP precisa ter 8 dígitos.";
  }
  if (f.addressState && f.addressState.trim().length !== 2) {
    e.addressState = "UF tem 2 letras.";
  }
  for (const [chave, max] of Object.entries(MAX_ENDERECO)) {
    const v = f[chave];
    if (typeof v === "string" && v.length > max && !e[chave]) {
      e[chave] = `Texto muito longo (máx. ${max}).`;
    }
  }
  return e;
}

/** Mensagem inline dos erros acima — some sozinha quando o valor fica válido. */
function ErroCampo({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-destructive">{msg}</p>;
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
      <PasswordCard
        twoFAEnabled={twoFAStatus.enabled}
        hasPassword={initial.hasPassword}
      />
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
  // O estado acima é o de EXIBIÇÃO (com máscara). O objeto abaixo é o corpo que
  // a rota espera — é ele que o auto-save observa e diffa.
  const fields = useMemo(
    () => ({
      name: name.trim(),
      phone: emptyToNull(phone.trim()),
      cpf: emptyToNull(cpf.trim()),
      birthDate: emptyToNull(birthDate.trim()),
      incomeValueCents: rendaEmCentavos(incomeReais),
    }),
    [name, phone, cpf, birthDate, incomeReais]
  );

  const erros = erroDePessoais(fields);

  // `invalidKeys`, não `isValid`: os campos aqui são INDEPENDENTES (colunas
  // distintas, sem regra cruzada). Reprovar a seção inteira faria o CPF pela
  // metade segurar o nome já corrigido — que, sem botão, nunca mais seria
  // gravado, e sumiria de vez ao sair da página.
  //
  // 1500ms em vez dos 800 do padrão porque cada PATCH grava uma linha
  // `USER_PROFILE_UPDATE` no audit log. Isso ajuda quem pausa a digitação; o
  // `blur` de cada campo alterado ainda gera uma gravação própria, e isso é
  // deliberado — perder o que foi digitado é pior que uma auditoria verbosa.
  const { status, error, isDirty, flush } = useSettingsAutoSave(fields, {
    endpoint: "/api/me/profile",
    debounceMs: 1500,
    invalidKeys: (f) => Object.keys(erroDePessoais(f)),
  });

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
              onBlur={() => void flush()}
            />
            <ErroCampo msg={erros.name} />
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
              onBlur={() => void flush()}
              placeholder="000.000.000-00"
            />
            <ErroCampo msg={erros.cpf} />
          </div>
          <div>
            <Label htmlFor="p-phone">Celular</Label>
            <Input
              id="p-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => void flush()}
              placeholder="(11) 9 9999-9999"
            />
            <ErroCampo msg={erros.phone} />
          </div>
          <div>
            <Label htmlFor="p-dob">Data de nascimento</Label>
            <Input
              id="p-dob"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              onBlur={() => void flush()}
            />
            <ErroCampo msg={erros.birthDate} />
          </div>
          <div>
            <Label htmlFor="p-income">Renda mensal (R$)</Label>
            <Input
              id="p-income"
              inputMode="decimal"
              value={incomeReais}
              onChange={(e) => setIncomeReais(e.target.value)}
              onBlur={() => void flush()}
              placeholder="0,00"
            />
            <ErroCampo msg={erros.incomeValueCents} />
          </div>
        </div>
        {/* Sem botão "Salvar" — a seção grava sozinha e a pill é o retorno. */}
        <div className="flex justify-end">
          <SaveStatusPill status={status} isDirty={isDirty} error={error} />
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

  const fields = useMemo(
    () => ({
      postalCode: emptyToNull(postalCode.trim()),
      addressStreet: emptyToNull(street.trim()),
      addressNumber: emptyToNull(number.trim()),
      addressComplement: emptyToNull(complement.trim()),
      addressNeighborhood: emptyToNull(neighborhood.trim()),
      addressCity: emptyToNull(city.trim()),
      addressState: emptyToNull(state.trim().toUpperCase()),
    }),
    [postalCode, street, number, complement, neighborhood, city, state]
  );

  const erros = erroDeEndereco(fields);

  // Mesmo endpoint do card de Dados pessoais, e os dois ficam na tela ao mesmo
  // tempo. Aqui isso é seguro — diferente do merge de JSON de outras telas —
  // porque a rota monta o `data` do Prisma campo a campo e grava COLUNAS
  // distintas: um PATCH de endereço não toca em `name`/`cpf`, e vice-versa.
  const { status, error, isDirty, flush } = useSettingsAutoSave(fields, {
    endpoint: "/api/me/profile",
    debounceMs: 1500,
    invalidKeys: (f) => Object.keys(erroDeEndereco(f)),
  });

  async function lookupCep() {
    const cep = postalCode.replace(/\D/g, "");
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) return;
      // Decidir pelo valor ATUAL, não pelo capturado no início do fetch: o
      // usuário pode ter digitado a rua enquanto a consulta voava, e sobrescrever
      // agora não seria só um susto na tela — o auto-save gravaria por cima, sem
      // clique nenhum. Antes, o botão dava a chance de perceber antes de salvar.
      setStreet((atual) => atual || (data.logradouro ?? ""));
      setNeighborhood((atual) => atual || (data.bairro ?? ""));
      setCity((atual) => atual || (data.localidade ?? ""));
      setState((atual) => atual || (data.uf ?? "").toUpperCase());
    } catch (e) {
      console.warn("[ProfileClient] falha no lookup de CEP", e);
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
              onBlur={() => {
                // O lookup preenche logradouro/bairro/cidade/UF quando estão
                // vazios; essas mudanças entram no estado e o auto-save as
                // grava sozinho. Não chamamos `flush` aqui de propósito: ele
                // rodaria ANTES do `setState` do lookup e gravaria só o CEP.
                void lookupCep();
              }}
              placeholder="00000-000"
            />
            <ErroCampo msg={erros.postalCode} />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="a-street">Logradouro</Label>
            <Input
              id="a-street"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              onBlur={() => void flush()}
            />
          </div>
          <div>
            <Label htmlFor="a-num">Número</Label>
            <Input
              id="a-num"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              onBlur={() => void flush()}
            />
          </div>
          <div>
            <Label htmlFor="a-comp">Complemento</Label>
            <Input
              id="a-comp"
              value={complement}
              onChange={(e) => setComplement(e.target.value)}
              onBlur={() => void flush()}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="a-neighbor">Bairro</Label>
            <Input
              id="a-neighbor"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              onBlur={() => void flush()}
            />
          </div>
          <div>
            <Label htmlFor="a-city">Cidade</Label>
            <Input
              id="a-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => void flush()}
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
              onBlur={() => void flush()}
              placeholder="SP"
            />
            <ErroCampo msg={erros.addressState} />
          </div>
        </div>
        {/* Sem botão "Salvar" — a seção grava sozinha e a pill é o retorno. */}
        <div className="flex justify-end">
          <SaveStatusPill status={status} isDirty={isDirty} error={error} />
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordCard({
  twoFAEnabled,
  hasPassword,
}: {
  twoFAEnabled: boolean;
  hasPassword: boolean;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  // Vira true depois de definir a primeira senha, sem precisar de reload.
  const [defined, setDefined] = useState(hasPassword);

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
      const body: Record<string, unknown> = { newPassword: next };
      if (defined) body.currentPassword = current;
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
        defined
          ? "Senha alterada. Outros dispositivos serão deslogados na próxima requisição."
          : "Senha definida. Agora você pode entrar com e-mail e senha."
      );
      setDefined(true);
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
          {defined
            ? "Alterar senha estando logado. Outros dispositivos serão deslogados."
            : "Sua conta ainda não tem senha — você entrou por link no e-mail. Defina uma senha para poder entrar direto."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {defined && (
            <div>
              <Label htmlFor="pw-curr">Senha atual</Label>
              <Input
                id="pw-curr"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          )}
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
            <Label htmlFor="pw-new">{defined ? "Nova senha" : "Senha"}</Label>
            <Input
              id="pw-new"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">Mínimo 8 caracteres.</p>
          </div>
          <div>
            <Label htmlFor="pw-confirm">
              {defined ? "Confirmar nova senha" : "Confirmar senha"}
            </Label>
            <Input
              id="pw-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={saving || !next || (defined && !current)}
          >
            {saving
              ? defined
                ? "Trocando..."
                : "Salvando..."
              : defined
                ? "Trocar senha"
                : "Definir senha"}
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
