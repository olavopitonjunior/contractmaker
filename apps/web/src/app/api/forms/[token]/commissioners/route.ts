import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { detectPixKeyType } from "@/lib/asaas/pix";

export const runtime = "nodejs";

/**
 * Endpoint público (sem auth) sob o token do form de vendas. Permite que
 * o usuário preenchendo /f/[token] (corretor OU cliente) escolha um
 * comissionado já cadastrado OU cadastre um novo inline.
 *
 * Resolve `orgId` via `SalesForm.token` e filtra `SplitRecipient` por
 * `{ orgId, kind:"commissioner", active:true }`. Nunca expõe PII bancária
 * (walletId/pixAddressKey/bankAccount/bankHolderDoc/ownerCpfCnpj completo).
 */

// Máscara mínima: mantém 3 primeiros e 2 últimos dígitos.
function maskDoc(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const digits = doc.replace(/\D/g, "");
  if (digits.length < 6) return digits;
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  const form = await prisma.salesForm.findUnique({
    where: { token },
    select: { id: true, orgId: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }

  const where: Prisma.SplitRecipientWhereInput = {
    orgId: form.orgId,
    kind: "commissioner",
    active: true,
  };
  if (q) {
    where.OR = [
      { label: { contains: q, mode: "insensitive" } },
      { cpfCnpj: { contains: q.replace(/\D/g, "") } },
      { ownerCpfCnpj: { contains: q.replace(/\D/g, "") } },
      { creci: { contains: q, mode: "insensitive" } },
    ];
  }

  const recipients = await prisma.splitRecipient.findMany({
    where,
    orderBy: [{ label: "asc" }],
    take: 50,
    select: {
      id: true,
      label: true,
      tipoPessoa: true,
      cpfCnpj: true,
      ownerCpfCnpj: true,
      creci: true,
      papel: true,
      email: true,
      phone: true,
    },
  });

  // Whitelist explícita do shape exposto. Documento mascarado pra evitar
  // que o form público vire ferramenta de scraping de CPFs/CNPJs.
  const items = recipients.map((r) => ({
    id: r.id,
    label: r.label,
    tipoPessoa: r.tipoPessoa ?? null,
    doc: maskDoc(r.cpfCnpj ?? r.ownerCpfCnpj),
    creci: r.creci ?? null,
    papel: r.papel ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
  }));

  return NextResponse.json({ items });
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
  tipoPessoa: z.enum(["fisica", "juridica"]),
  cpfCnpj: z.string().trim().min(11).max(18),
  creci: z.string().trim().max(50).optional(),
  papel: z
    .enum([
      "imobiliaria_principal",
      "captador",
      "intermediador",
      "indicador",
      "outro",
    ])
    .optional()
    .default("imobiliaria_principal"),
  email: z
    .string()
    .trim()
    .email("Email inválido")
    .max(200)
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
  // Dados de recebimento (opcionais — quando faltam, vira rascunho)
  pix: z
    .object({
      chave: z.string().trim().min(1).max(200).optional(),
      titularNome: z.string().trim().min(1).max(200).optional(),
      titularCpfCnpj: z.string().trim().min(11).max(18).optional(),
    })
    .optional(),
  banco: z
    .object({
      nome: z.string().trim().max(80).optional(),
      agencia: z.string().trim().max(20).optional(),
      conta: z.string().trim().max(30).optional(),
      tipoConta: z.enum(["corrente", "poupanca"]).optional(),
      titularNome: z.string().trim().max(200).optional(),
      titularDoc: z.string().trim().max(18).optional(),
    })
    .optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const form = await prisma.salesForm.findUnique({
    where: { token },
    select: { id: true, orgId: true, status: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }
  if (form.status === "completo") {
    return NextResponse.json(
      { error: "Formulário já finalizado — não aceita novos cadastros" },
      { status: 409 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const hasPix = !!data.pix?.chave;
  const hasBank = !!(data.banco?.nome && data.banco?.agencia && data.banco?.conta);

  // Detectar tipo de chave PIX (best-effort — formato inválido só rejeita
  // se o usuário marcou PIX como meio. Sem PIX vira rascunho).
  let pixKeyType: string | null = null;
  if (hasPix) {
    pixKeyType = detectPixKeyType(data.pix!.chave!);
    if (!pixKeyType) {
      return NextResponse.json(
        { error: "Chave PIX inválida — formato não reconhecido" },
        { status: 400 }
      );
    }
  }

  // recipientType deriva: pix_external se PIX, senão asaas_wallet (placeholder
  // pendingFields="walletId"). Org poderá completar via admin depois.
  const recipientType = hasPix ? "pix_external" : "asaas_wallet";
  const pendingFields: string[] = [];
  if (!hasPix && !hasBank) {
    // Rascunho completo — sem nenhum meio de recebimento.
    pendingFields.push(recipientType === "pix_external" ? "pixAddressKey" : "walletId");
  }
  const isDraft = pendingFields.length > 0;

  let created;
  try {
    created = await prisma.splitRecipient.create({
      data: {
        orgId: form.orgId,
        label: data.label,
        recipientType,
        walletId: null,
        pixAddressKey: hasPix ? data.pix!.chave! : null,
        pixKeyType,
        ownerName: data.pix?.titularNome ?? null,
        ownerCpfCnpj: data.pix?.titularCpfCnpj ?? null,
        cpfCnpj: data.cpfCnpj,
        email: data.email && data.email !== "" ? data.email : null,
        pendingFields,
        active: !isDraft,
        kind: "commissioner",
        tipoPessoa: data.tipoPessoa,
        creci: data.creci ?? null,
        papel: data.papel,
        phone: data.phone ?? null,
        bankName: data.banco?.nome ?? null,
        bankBranch: data.banco?.agencia ?? null,
        bankAccount: data.banco?.conta ?? null,
        bankAccountType: data.banco?.tipoConta ?? null,
        bankHolderName: data.banco?.titularNome ?? null,
        bankHolderDoc: data.banco?.titularDoc ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Já cadastrado — retornar o existente pra UI prosseguir sem erro.
      const existing = await prisma.splitRecipient.findFirst({
        where: {
          orgId: form.orgId,
          OR: [
            data.pix?.chave ? { pixAddressKey: data.pix.chave } : { id: "_none" },
            { cpfCnpj: data.cpfCnpj },
          ],
        },
        select: {
          id: true,
          label: true,
          tipoPessoa: true,
          cpfCnpj: true,
          creci: true,
          papel: true,
          email: true,
          phone: true,
        },
      });
      if (existing) {
        return NextResponse.json(
          {
            recipient: { ...existing, doc: maskDoc(existing.cpfCnpj) },
            existed: true,
          },
          { status: 200 }
        );
      }
    }
    throw err;
  }

  await audit(
    {
      orgId: form.orgId,
      userId: null,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    {
      action: "SPLIT_RECIPIENT_CREATED",
      result: "SUCCESS",
      resourceType: "split_recipient",
      resource: `split_recipient:${created.id}`,
      metadata: {
        source: "public_form",
        formId: form.id,
        label: created.label,
        kind: "commissioner",
        isDraft,
      },
    }
  );

  // Rascunho com email: o admin dispara magic link manualmente em
  // /settings/pagamentos/split-recipients (botão "Pedir dados") quando
  // ver o recipient com pendingFields. Não auto-disparamos daqui porque
  // /request-completion exige auth, e o caller deste endpoint é público.

  return NextResponse.json(
    {
      recipient: {
        id: created.id,
        label: created.label,
        tipoPessoa: created.tipoPessoa,
        doc: maskDoc(created.cpfCnpj),
        creci: created.creci,
        papel: created.papel,
        email: created.email,
        phone: created.phone,
      },
      existed: false,
    },
    { status: 201 }
  );
}
