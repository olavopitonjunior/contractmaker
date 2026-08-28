import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formClosedResponse, viewerIsOrgMember } from "@/lib/forms/form-gate";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";
import { detectPixKeyType } from "@/lib/asaas/pix";
import {
  createCommissioner,
  findCommissionerMatch,
} from "@/lib/asaas/commissioner-registry";

export const runtime = "nodejs";

/**
 * Endpoint público (sem auth) sob o token do form — serve as DUAS esteiras:
 * venda (etapa Comissão, `comissao.comissionados[]`) e locação (etapa
 * Comissão, `comissao.angariadores[]`), já que ambas são SalesForm e o token
 * resolve igual. Permite que o usuário preenchendo /f/[token] (corretor OU
 * cliente) escolha um comissionado já cadastrado OU cadastre um novo inline.
 *
 * Resolve `orgId` via `SalesForm.token` e filtra `SplitRecipient` por
 * `{ orgId, kind:"commissioner", active:true }`. Nunca expõe PII bancária
 * (walletId/pixAddressKey/bankAccount/bankHolderDoc/ownerCpfCnpj completo).
 *
 * O POST aceita dados de recebimento (`pix`, `banco`) — write-only: entram no
 * SplitRecipient e o GET acima não os devolve. Duas travas, porque aqui se
 * grava para onde o dinheiro vai:
 *
 *  1. Só de MEMBRO da org (`viewerIsOrgMember`). De anônimo vêm descartados
 *     (`receivingRejected`) — o link costuma estar com o cliente, e a UI já
 *     esconde os campos pra ele. Sem esta checagem, esconder seria fachada.
 *  2. Num cadastro que JÁ existe são ignorados (`receivingIgnored`), de quem
 *     quer que venham: sobrescrever chave PIX alheia desviaria repasse.
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

  // `?q=` livre sobre o roster inteiro da org — sem teto, o token do form vira
  // ferramenta de enumeração de corretores. Mesmo padrão de participants/from-main.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = await rateLimit({
    identifier: `commissioners-list:${token}:${ip}`,
    limit: 30,
    window: "1 m",
  });
  if (!limited.success) {
    return NextResponse.json(
      { error: "Muitas tentativas — aguarde um instante." },
      { status: 429 }
    );
  }

  const form = await prisma.salesForm.findUnique({
    where: { token },
    select: { id: true, orgId: true, status: true, completedAt: true, reopenedAt: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }
  // Este GET busca o roster de comissionados da ORG inteira (`?q=` livre), não
  // só o que está no form — um token de form encerrado não pode seguir servindo
  // de oráculo de busca sobre a base da imobiliária.
  const closed = await formClosedResponse(form);
  if (closed) return closed;

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
      // Booleano derivado — o front precisa saber se o cadastro tem meio de
      // repasse para o gate da etapa Comissão. NUNCA os campos bancários em si.
      pendingFields: true,
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
    receivingPending: r.pendingFields.length > 0,
  }));

  return NextResponse.json({ items });
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
  tipoPessoa: z.enum(["fisica", "juridica"]),
  // Dígitos, não só comprimento: `normalizeDoc` descarta não-dígitos, então
  // um doc alfabético de 11+ chars passava no Zod, normalizava pra "" e fazia
  // `findCommissionerMatch` PULAR o dedupe por documento — caindo no match só
  // por nome, que é mais fraco. Era um jeito barato de forçar cadastro novo.
  cpfCnpj: z
    .string()
    .trim()
    .min(11)
    .max(18)
    .refine((v) => {
      const d = v.replace(/\D/g, "").length;
      return d === 11 || d === 14;
    }, "CPF/CNPJ inválido — informe 11 (CPF) ou 14 (CNPJ) dígitos"),
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

  // Escreve PII bancária a partir de request anônimo — teto apertado pra
  // impedir varredura automatizada plantando cadastros.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = await rateLimit({
    identifier: `commissioners-create:${token}:${ip}`,
    limit: 10,
    window: "1 m",
  });
  if (!limited.success) {
    return NextResponse.json(
      { error: "Muitas tentativas — aguarde um instante." },
      { status: 429 }
    );
  }

  const form = await prisma.salesForm.findUnique({
    where: { token },
    select: { id: true, orgId: true, status: true, completedAt: true, reopenedAt: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }
  // Era 409 só em `status === "completo"` — cego pra "vinculado" e divergente
  // do resto. Unifica no gate (403 + reason).
  const closed = await formClosedResponse(form);
  if (closed) return closed;

  const raw = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Dado de recebimento só de quem é da imobiliária. O link do formulário está
  // normalmente com o CLIENTE, e a UI já esconde os campos pra ele — mas
  // esconder sem barrar aqui seria trava de fachada: bastava um POST direto.
  // É esta checagem que fecha de fato o desvio de repasse; o `unverifiedSource`
  // abaixo fica como rede, caso outro caller anônimo apareça.
  const viewerIsMember = await viewerIsOrgMember(form.orgId);
  // `sent*` = o que veio no body; `has*` = o que temos permissão de gravar.
  // Banco vai inteiro pro registry, mesmo parcial: guardar "Itaú, ag. 0000"
  // sem a conta ainda ajuda quem for fazer o repasse manual. Exigir os três
  // campos descartava em silêncio o que o corretor digitou.
  const sentPix = !!data.pix?.chave;
  const sentBank = !!(
    data.banco &&
    Object.values(data.banco).some((v) => typeof v === "string" && v.trim())
  );
  const hasPix = viewerIsMember && sentPix;
  const hasBank = viewerIsMember && sentBank;
  // Mandou dado bancário sem ser da org: descartado, e a resposta diz isso.
  const receivingRejected = !viewerIsMember && (sentPix || sentBank);

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

  // Dedupe antes de criar: match por doc/nome no registry (inclui rascunhos
  // inativos — o partial unique do banco só cobre commissioners ativos).
  const registryInput = {
    nome: data.label,
    cpf: data.tipoPessoa === "fisica" ? data.cpfCnpj : null,
    cnpj: data.tipoPessoa === "juridica" ? data.cpfCnpj : null,
    tipo_pessoa: data.tipoPessoa,
    email: data.email && data.email !== "" ? data.email : null,
    mobile_phone: data.phone ?? null,
    creci: data.creci ?? null,
    papel: data.papel,
  };
  const preexisting = await findCommissionerMatch(form.orgId, registryInput);
  if (preexisting) {
    // Dados de recebimento de um cadastro que JÁ existe são deliberadamente
    // ignorados: este endpoint é anônimo, e deixá-lo gravar chave PIX num
    // corretor existente seria um vetor de desvio de repasse. Devolvemos o
    // flag pra UI dizer a verdade em vez de fingir que salvou.
    const receivingIgnored = sentPix || sentBank;
    if (receivingIgnored) {
      // Tentativa repetida daqui é sinal de ataque (ou de corretor legítimo
      // batendo na trava). Sem esta linha o evento não existe em lugar nenhum.
      await audit(
        {
          orgId: form.orgId,
          userId: null,
          ipAddress: req.headers.get("x-forwarded-for") ?? null,
          userAgent: req.headers.get("user-agent") ?? null,
        },
        {
          action: "SPLIT_RECIPIENT_UPDATED",
          result: "DENIED",
          resourceType: "split_recipient",
          resource: `split_recipient:${preexisting.id}`,
          metadata: {
            source: "public_form",
            formId: form.id,
            reason: "receiving_data_ignored_on_existing_recipient",
            viewerIsMember,
            sentPix,
            sentBank,
          },
        }
      );
    }
    return NextResponse.json(
      {
        recipient: {
          id: preexisting.id,
          label: preexisting.label,
          tipoPessoa: preexisting.tipoPessoa,
          doc: maskDoc(preexisting.cpfCnpj),
          creci: preexisting.creci,
          papel: preexisting.papel,
          email: preexisting.email,
          phone: preexisting.phone,
        },
        existed: true,
        isDraft: preexisting.pendingFields.length > 0,
        receivingIgnored,
      },
      { status: 200 }
    );
  }

  let created;
  let isDraft: boolean;
  try {
    created = await createCommissioner(form.orgId, registryInput, {
      pix: hasPix
        ? {
            chave: data.pix!.chave!,
            keyType: pixKeyType!,
            titularNome: data.pix?.titularNome ?? null,
            titularCpfCnpj: data.pix?.titularCpfCnpj ?? null,
          }
        : undefined,
      banco: hasBank ? data.banco : undefined,
    }, { unverifiedSource: !viewerIsMember });
    isDraft = created.pendingFields.length > 0;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Corrida: outra criação venceu (partial unique de cpfCnpj, walletId
      // ou pixAddressKey). Retornar o existente pra UI prosseguir sem erro.
      const existing =
        (await findCommissionerMatch(form.orgId, registryInput)) ??
        (data.pix?.chave
          ? await prisma.splitRecipient.findFirst({
              where: { orgId: form.orgId, pixAddressKey: data.pix.chave },
            })
          : null);
      if (existing) {
        return NextResponse.json(
          {
            recipient: {
              id: existing.id,
              label: existing.label,
              tipoPessoa: existing.tipoPessoa,
              doc: maskDoc(existing.cpfCnpj),
              creci: existing.creci,
              papel: existing.papel,
              email: existing.email,
              phone: existing.phone,
            },
            existed: true,
            isDraft: existing.pendingFields.length > 0,
            receivingIgnored: sentPix || sentBank,
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
        // Nunca o valor — só se veio. Rastro pra investigar repasse errado.
        viewerIsMember,
        hasPix,
        hasBank,
        receivingRejected,
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
      isDraft,
      receivingRejected,
    },
    { status: 201 }
  );
}
