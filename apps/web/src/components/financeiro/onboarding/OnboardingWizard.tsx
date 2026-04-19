"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ElevationDialog } from "@/components/security/ElevationDialog";
import { useElevation } from "@/hooks/useElevation";
import {
  User,
  Building2,
  CheckCircle2,
  Upload,
  RefreshCw,
  AlertTriangle,
  FileText,
  Shield,
} from "lucide-react";

type PersonType = "PHYSICAL" | "LEGAL";

type OnboardingStatus =
  | "NOT_STARTED"
  | "DRAFT"
  | "PENDING"
  | "AWAITING_DOCS"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "BLOCKED";

interface OnboardingState {
  status: OnboardingStatus;
  nextStep: string;
  accountId?: string;
  walletId?: string;
  personType?: PersonType;
  generalStatus?: string;
  documentationStatus?: string;
  commercialInfoStatus?: string;
  bankAccountInfoStatus?: string;
  rejectionReason?: string | null;
  approvedAt?: string | null;
  lastStatusCheckAt?: string | null;
  documents: DocumentSlot[];
  docsPendingCount: number;
}

interface DocumentSlot {
  id: string;
  asaasDocumentId: string;
  type: string;
  title: string;
  description: string | null;
  status: "NOT_SENT" | "PENDING" | "APPROVED" | "REJECTED";
  fileName: string | null;
  fileMime: string | null;
  rejectionReason: string | null;
  uploadedAt: string | null;
}

export function OnboardingWizard() {
  const elevation = useElevation();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [elevOpen, setElevOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"start" | "submit" | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/onboarding", {
        credentials: "include",
      });
      const data = await res.json();
      setState(data);
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    const res = await fetch("/api/financeiro/onboarding/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Falha ao sincronizar");
      return;
    }
    toast.success("Status atualizado");
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !state) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }
  if (!state) return null;

  // APPROVED — tudo liberado
  if (state.status === "APPROVED") {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
          <h2 className="text-xl font-semibold">Conta Asaas aprovada ✓</h2>
          <p className="text-sm text-muted-foreground">
            Aprovada em {state.approvedAt ? new Date(state.approvedAt).toLocaleDateString("pt-BR") : "—"}.
            Você já pode gerar cobranças no módulo Financeiro.
          </p>
          <Button asChild>
            <a href="/financeiro">Abrir dashboard financeiro</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // NOT_STARTED — tela de boas-vindas + escolha de tipo
  if (state.status === "NOT_STARTED") {
    return (
      <StartStep
        elevation={elevation}
        onStart={() => {
          if (!elevation.hasScope("KYC_EDIT")) {
            setPendingAction("start");
            setElevOpen(true);
          } else {
            // Inicia wizard — user escolhe tipo na próxima tela (renderizada abaixo)
            setState({ ...state, status: "DRAFT" as OnboardingStatus });
          }
        }}
        elevOpen={elevOpen}
        setElevOpen={setElevOpen}
        onElevationSuccess={() => {
          setPendingAction(null);
          setState({ ...state, status: "DRAFT" as OnboardingStatus });
        }}
      />
    );
  }

  // DRAFT — formulário de dados
  if (state.status === "DRAFT") {
    return <DataStep onSuccess={() => load()} />;
  }

  // AWAITING_APPROVAL — esperando análise
  if (state.status === "AWAITING_APPROVAL") {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="text-center space-y-2">
            <RefreshCw className="h-10 w-10 mx-auto text-amber-500 animate-pulse" />
            <h2 className="text-xl font-semibold">Aguardando aprovação</h2>
            <p className="text-sm text-muted-foreground">
              Todos os documentos foram enviados. A Asaas normalmente aprova em
              1 dia útil. Você receberá email quando estiver pronto.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <StatusBadge label="Informações comerciais" status={state.commercialInfoStatus} />
            <StatusBadge label="Documentação" status={state.documentationStatus} />
            <StatusBadge label="Conta bancária" status={state.bankAccountInfoStatus} />
            <StatusBadge label="Geral" status={state.generalStatus} />
          </div>
          <div className="flex justify-center">
            <Button variant="outline" onClick={refresh}>
              <RefreshCw className="h-4 w-4 mr-1" /> Verificar agora
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Última verificação:{" "}
            {state.lastStatusCheckAt
              ? new Date(state.lastStatusCheckAt).toLocaleString("pt-BR")
              : "—"}
          </p>
        </CardContent>
      </Card>
    );
  }

  // REJECTED — motivo + re-enviar
  if (state.status === "REJECTED") {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="text-center space-y-2">
            <AlertTriangle className="h-10 w-10 mx-auto text-red-500" />
            <h2 className="text-xl font-semibold">Documentos recusados</h2>
          </div>
          {state.rejectionReason && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
              <strong>Motivo:</strong> {state.rejectionReason}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Revise os documentos abaixo e reenvie os marcados como rejeitados.
          </p>
          <DocumentsGrid documents={state.documents} onAfterUpload={load} />
          <Button variant="outline" onClick={refresh} className="w-full">
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar status
          </Button>
        </CardContent>
      </Card>
    );
  }

  // BLOCKED — fim
  if (state.status === "BLOCKED") {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-3">
          <AlertTriangle className="h-12 w-12 mx-auto text-red-600" />
          <h2 className="text-xl font-semibold">Conta bloqueada</h2>
          <p className="text-sm text-muted-foreground">
            Entre em contato com o suporte para mais informações.
          </p>
        </CardContent>
      </Card>
    );
  }

  // PENDING / AWAITING_DOCS — upload de documentos
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Envio de documentos</h2>
          <p className="text-sm text-muted-foreground">
            Envie os documentos pendentes para a Asaas aprovar sua subconta.
          </p>
          <div className="text-sm">
            Progresso:{" "}
            <strong>
              {state.documents.filter((d) => d.status === "PENDING" || d.status === "APPROVED").length}
            </strong>{" "}
            de {state.documents.length} enviados
          </div>
        </div>
        <DocumentsGrid documents={state.documents} onAfterUpload={load} />
        <Button variant="outline" onClick={refresh} className="w-full">
          <RefreshCw className="h-4 w-4 mr-1" /> Atualizar status
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------- Sub-components ----------

function StatusBadge({ label, status }: { label: string; status?: string }) {
  if (!status) return null;
  const up = status.toUpperCase();
  const colorClass =
    up === "APPROVED"
      ? "bg-green-100 text-green-900 border-green-300"
      : up === "REJECTED"
      ? "bg-red-100 text-red-900 border-red-300"
      : "bg-amber-100 text-amber-900 border-amber-300";
  return (
    <div className="border rounded p-2 flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant="outline" className={colorClass}>
        {up === "APPROVED" ? "Aprovado" : up === "REJECTED" ? "Rejeitado" : "Pendente"}
      </Badge>
    </div>
  );
}

function StartStep({
  elevation,
  onStart,
  elevOpen,
  setElevOpen,
  onElevationSuccess,
}: {
  elevation: ReturnType<typeof useElevation>;
  onStart: () => void;
  elevOpen: boolean;
  setElevOpen: (v: boolean) => void;
  onElevationSuccess: () => void;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Abrir conta Asaas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Para receber pagamentos pelo Contractmaker, precisamos criar sua conta
            no Asaas (gateway de pagamentos). Todo o processo é digital e leva ~2
            minutos; a aprovação final acontece em até 1 dia útil.
          </p>
          <div className="p-3 border rounded text-sm space-y-1">
            <p className="font-medium">O que você vai precisar:</p>
            <ul className="list-disc ml-5 text-muted-foreground text-xs space-y-1">
              <li>CPF (pessoa física) ou CNPJ (pessoa jurídica)</li>
              <li>Documento de identidade (RG/CNH) em foto ou PDF</li>
              <li>Comprovante de residência recente (≤ 90 dias)</li>
              <li>Selfie com documento (pode usar a câmera do celular depois)</li>
              <li>Contrato social (se for PJ)</li>
            </ul>
          </div>
          <Button onClick={onStart}>Começar</Button>
          <p className="text-xs text-muted-foreground">
            A senha e 2FA serão solicitados para confirmar sua identidade.
          </p>
        </CardContent>
      </Card>

      <ElevationDialog
        open={elevOpen}
        onOpenChange={setElevOpen}
        scopes={["KYC_EDIT"]}
        onSuccess={onElevationSuccess}
      />
    </>
  );
}

const initialPF = {
  personType: "PHYSICAL" as PersonType,
  name: "",
  email: "",
  cpfCnpj: "",
  birthDate: "",
  mobilePhone: "",
  incomeValue: 0,
  postalCode: "",
  address: "",
  addressNumber: "",
  complement: "",
  province: "",
  companyType: undefined as "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION" | undefined,
};

function DataStep({ onSuccess }: { onSuccess: () => void }) {
  const [data, setData] = useState(initialPF);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof data>(key: K, value: (typeof data)[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }

  async function fetchCep() {
    const cep = data.postalCode.replace(/\D/g, "");
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const c = await res.json();
      if (c.erro) return;
      update("address", c.logradouro ?? "");
      update("province", c.bairro ?? "");
      // Não há cidade/UF no schema Asaas — só bairro.
    } catch {}
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const body: any = {
        personType: data.personType,
        name: data.name,
        email: data.email,
        cpfCnpj: data.cpfCnpj.replace(/\D/g, ""),
        mobilePhone: data.mobilePhone.replace(/\D/g, ""),
        incomeValue: Number(data.incomeValue),
        postalCode: data.postalCode.replace(/\D/g, ""),
        address: data.address,
        addressNumber: data.addressNumber,
        complement: data.complement || undefined,
        province: data.province,
      };
      if (data.personType === "PHYSICAL" && data.birthDate) {
        body.birthDate = data.birthDate;
      }
      if (data.personType === "LEGAL" && data.companyType) {
        body.companyType = data.companyType;
      }

      const res = await fetch("/api/financeiro/onboarding/subaccount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        const msg =
          result.details?.[0]?.description ?? result.error ?? result.message ?? "Erro";
        toast.error(msg);
        return;
      }
      toast.success("Subconta Asaas criada");
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados cadastrais</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="mb-2 block">Tipo de pessoa</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`border rounded-md p-3 text-sm font-medium transition flex flex-col items-center gap-2 ${
                data.personType === "PHYSICAL"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-muted"
              }`}
              onClick={() => update("personType", "PHYSICAL")}
            >
              <User className="h-5 w-5" />
              Pessoa Física
              <span className="text-xs font-normal text-muted-foreground">
                Corretor autônomo
              </span>
            </button>
            <button
              type="button"
              className={`border rounded-md p-3 text-sm font-medium transition flex flex-col items-center gap-2 ${
                data.personType === "LEGAL"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-muted"
              }`}
              onClick={() => update("personType", "LEGAL")}
            >
              <Building2 className="h-5 w-5" />
              Pessoa Jurídica
              <span className="text-xs font-normal text-muted-foreground">
                Imobiliária/empresa
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label htmlFor="k-name">
              {data.personType === "PHYSICAL" ? "Nome completo" : "Razão social"}
            </Label>
            <Input
              id="k-name"
              value={data.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="k-cpfcnpj">
              {data.personType === "PHYSICAL" ? "CPF" : "CNPJ"}
            </Label>
            <Input
              id="k-cpfcnpj"
              value={data.cpfCnpj}
              onChange={(e) => update("cpfCnpj", e.target.value)}
              placeholder={data.personType === "PHYSICAL" ? "000.000.000-00" : "00.000.000/0000-00"}
            />
          </div>
          <div>
            <Label htmlFor="k-email">Email</Label>
            <Input
              id="k-email"
              type="email"
              value={data.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="k-phone">Celular</Label>
            <Input
              id="k-phone"
              value={data.mobilePhone}
              onChange={(e) => update("mobilePhone", e.target.value)}
              placeholder="(11) 9 9999-9999"
            />
          </div>
          <div>
            <Label htmlFor="k-income">
              {data.personType === "PHYSICAL" ? "Renda mensal (R$)" : "Faturamento mensal (R$)"}
            </Label>
            <Input
              id="k-income"
              type="number"
              min="1"
              value={data.incomeValue || ""}
              onChange={(e) => update("incomeValue", Number(e.target.value))}
            />
          </div>
          {data.personType === "PHYSICAL" ? (
            <div>
              <Label htmlFor="k-dob">Data de nascimento</Label>
              <Input
                id="k-dob"
                type="date"
                value={data.birthDate}
                onChange={(e) => update("birthDate", e.target.value)}
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="k-company">Tipo de empresa</Label>
              <Select
                value={data.companyType ?? ""}
                onValueChange={(v) => update("companyType", v as any)}
              >
                <SelectTrigger id="k-company">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEI">MEI</SelectItem>
                  <SelectItem value="LIMITED">LTDA</SelectItem>
                  <SelectItem value="INDIVIDUAL">Empresário Individual</SelectItem>
                  <SelectItem value="ASSOCIATION">Associação</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="k-cep">CEP</Label>
            <Input
              id="k-cep"
              value={data.postalCode}
              onChange={(e) => update("postalCode", e.target.value)}
              onBlur={fetchCep}
              placeholder="00000-000"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="k-addr">Endereço</Label>
            <Input
              id="k-addr"
              value={data.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="k-num">Número</Label>
            <Input
              id="k-num"
              value={data.addressNumber}
              onChange={(e) => update("addressNumber", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="k-comp">Complemento</Label>
            <Input
              id="k-comp"
              value={data.complement}
              onChange={(e) => update("complement", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="k-prov">Bairro</Label>
            <Input
              id="k-prov"
              value={data.province}
              onChange={(e) => update("province", e.target.value)}
            />
          </div>
        </div>

        <div className="p-3 border rounded bg-amber-50 text-sm">
          <p className="font-medium">
            Declaração
          </p>
          <p className="text-xs text-amber-900 mt-1">
            Ao clicar em &quot;Criar subconta&quot;, você declara que os dados informados são
            verdadeiros e que você é a pessoa responsável legal pela conta. Informações
            falsas podem ser reportadas às autoridades competentes.
          </p>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={
            submitting ||
            !data.name ||
            !data.email ||
            !data.cpfCnpj ||
            !data.mobilePhone ||
            !data.incomeValue ||
            !data.postalCode ||
            !data.address ||
            !data.addressNumber
          }
          className="w-full"
        >
          {submitting ? "Criando..." : "Criar subconta Asaas"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DocumentsGrid({
  documents,
  onAfterUpload,
}: {
  documents: DocumentSlot[];
  onAfterUpload: () => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {documents.map((d) => (
        <DocumentCard key={d.id} doc={d} onAfterUpload={onAfterUpload} />
      ))}
    </div>
  );
}

function DocumentCard({
  doc,
  onAfterUpload,
}: {
  doc: DocumentSlot;
  onAfterUpload: () => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/financeiro/onboarding/documents/${doc.id}/upload`,
        {
          method: "POST",
          credentials: "include",
          body: form,
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha no upload");
        return;
      }
      toast.success(`${doc.title} enviado`);
      onAfterUpload();
    } finally {
      setUploading(false);
    }
  }

  const statusColor =
    doc.status === "APPROVED"
      ? "bg-green-50 border-green-300"
      : doc.status === "REJECTED"
      ? "bg-red-50 border-red-300"
      : doc.status === "PENDING"
      ? "bg-blue-50 border-blue-300"
      : "border-muted";

  return (
    <div className={`border rounded p-3 ${statusColor}`}>
      <div className="flex items-start gap-2 mb-2">
        <FileText className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{doc.title}</div>
          {doc.description && (
            <div className="text-xs text-muted-foreground">{doc.description}</div>
          )}
        </div>
      </div>
      {doc.status === "APPROVED" && (
        <Badge variant="outline" className="bg-green-100 text-green-900 border-green-300">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Aprovado
        </Badge>
      )}
      {doc.status === "REJECTED" && (
        <div className="space-y-2">
          <Badge variant="outline" className="bg-red-100 text-red-900 border-red-300">
            Rejeitado
          </Badge>
          {doc.rejectionReason && (
            <p className="text-xs text-red-900">{doc.rejectionReason}</p>
          )}
        </div>
      )}
      {doc.status === "PENDING" && (
        <Badge variant="outline" className="bg-blue-100 text-blue-900 border-blue-300">
          Em análise
        </Badge>
      )}
      {(doc.status === "NOT_SENT" || doc.status === "REJECTED") && (
        <div className="mt-2">
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
            <span
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded border ${
                uploading
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Enviando..." : "Enviar"}
            </span>
          </label>
          <p className="text-xs text-muted-foreground mt-1">
            JPG, PNG, WebP ou PDF até 10 MB
          </p>
        </div>
      )}
    </div>
  );
}
