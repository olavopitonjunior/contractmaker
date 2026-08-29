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
  type CommissionerReceivingExtras,
} from "@/lib/asaas/commissioner-registry";
import {
  RECEBIMENTO_SELECT,
  recebimentoFromRecipient,
} from "@/lib/forms/commissioner-receiving";

export const runtime = "nodejs";

/** Teto da listagem. O roster de uma imobiliária é de dezenas; 200 cobre com
 *  folga e `hasMore` diz a verdade quando não cobrir. */
const LIST_LIMIT = 200;

/**
 * Endpoint público (sem auth) sob o token do form — serve as DUAS esteiras:
 * venda (etapa Comissão, `comissao.comissionados[]`) e locação (etapa
 * Comissão, `comissao.angariadores[]`), já que ambas são SalesForm e o token
 * resolve igual. Permite que o usuário preenchendo /f/[token] (corretor OU
 * cliente) escolha um comissionado já cadastrado OU cadastre um novo inline.
 *
 * Resolve `orgId` via `SalesForm.token` e filtra `SplitRecipient` por
 * `{ orgId, kind:"commissioner", archivedAt: null }` — por EXISTÊNCIA, não por
 * pagabilidade. Filtrar `active: true`, como era até 08/2026, escondia todo
 * cadastro sem meio de repasse, que é o estado em que nasce quem é cadastrado
 * pelo próprio formulário: 42 comissionados na org de produção, 2 aqui.
 *
 * PII bancária no GET: **só para membro da org** (`viewerIsOrgMember`), e é o
 * que permite autocompletar o formulário ao reconhecer um corretor existente.
 * Para anônimo o shape é o de sempre — sem `recebimento`, com o documento
 * mascarado, para que o token do form não vire ferramenta de scraping.
 *
 * O POST aceita dados de recebimento (`pix`, `banco`). Duas travas, porque aqui
 * se grava para onde o dinheiro vai:
 *
 *  1. Só de MEMBRO da org (`viewerIsOrgMember`). De anônimo vêm descartados
 *     (`receivingRejected`) — o link costuma estar com o cliente, e a UI já
 *     esconde os campos pra ele. Sem esta checagem, esconder seria fachada.
 *  2. Num cadastro que JÁ existe, membro PREENCHE o que está vazio e nunca
 *     sobrescreve valor já gravado (`receivingFilled`); de anônimo continua
 *     integralmente ignorado (`receivingIgnored`), que é o que impede desviar
 *     repasse trocando a chave PIX alheia com o link na mão.
 */

/**
 * Preenche APENAS as colunas de recebimento que estão vazias no cadastro, e
 * devolve os nomes das que foram gravadas (para o audit e para a UI).
 *
 * Nunca sobrescreve: um valor já lá foi posto por alguém com mais prova de
 * posse do que quem está com o link de um formulário — o admin em `/corretores`
 * ou o próprio corretor pelo magic link. A regra "só o vazio" é o que permite
 * relaxar a trava sem reabrir o desvio de repasse que ela existe para impedir.
 *
 * Só é chamada quando o autor é membro da org.
 */
async function fillEmptyReceiving(
  current: {
    id: string;
    recipientType: string;
    pixAddressKey: string | null;
    pixKeyType: string | null;
    ownerName: string | null;
    ownerCpfCnpj: string | null;
    bankName: string | null;
    bankBranch: string | null;
    bankAccount: string | null;
    bankAccountType: string | null;
    bankHolderName: string | null;
    bankHolderDoc: string | null;
  },
  extras: CommissionerReceivingExtras
): Promise<string[]> {
  const patch: Prisma.SplitRecipientUpdateInput = {};
  const filled: string[] = [];
  const put = (
    key: keyof Prisma.SplitRecipientUpdateInput & string,
    existingValue: string | null,
    incoming: string | null | undefined
  ) => {
    const v = typeof incoming === "string" ? incoming.trim() : "";
    if (!v || (existingValue ?? "").trim()) return;
    (patch as Record<string, unknown>)[key] = v;
    filled.push(key);
  };

  put("pixAddressKey", current.pixAddressKey, extras.pix?.chave);
  // Tipo e titular só acompanham a chave: gravá-los sem ela deixaria o cadastro
  // dizendo "PIX tipo EMAIL" sem PIX nenhum.
  if (filled.includes("pixAddressKey")) {
    put("pixKeyType", current.pixKeyType, extras.pix?.keyType);
    put("ownerName", current.ownerName, extras.pix?.titularNome);
    put("ownerCpfCnpj", current.ownerCpfCnpj, extras.pix?.titularCpfCnpj);
  }
  put("bankName", current.bankName, extras.banco?.nome);
  put("bankBranch", current.bankBranch, extras.banco?.agencia);
  put("bankAccount", current.bankAccount, extras.banco?.conta);
  put("bankAccountType", current.bankAccountType, extras.banco?.tipoConta);
  put("bankHolderName", current.bankHolderName, extras.banco?.titularNome);
  put("bankHolderDoc", current.bankHolderDoc, extras.banco?.titularDoc);

  if (filled.length === 0) return [];

  // Ganhar uma chave PIX faz do cadastro um `pix_external`. Ele NÃO sai de
  // rascunho aqui: a confirmação de posse continua sendo do admin em
  // /corretores ou do próprio corretor pelo magic link — a mesma razão pela
  // qual `createCommissioner` marca `unverifiedSource`.
  if (filled.includes("pixAddressKey") && current.recipientType !== "pix_external") {
    patch.recipientType = "pix_external";
  }

  await prisma.splitRecipient.update({ where: { id: current.id }, data: patch });
  return filled;
}

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

  // Filtra por EXISTÊNCIA (`archivedAt`), não por pagabilidade (`active`).
  // Filtrar `active: true` escondia todo cadastro sem meio de repasse — que é o
  // estado em que nasce quem é cadastrado pelo próprio formulário. Medido em
  // produção antes do conserto: 42 comissionados na org, 2 oferecidos aqui.
  const where: Prisma.SplitRecipientWhereInput = {
    orgId: form.orgId,
    kind: "commissioner",
    archivedAt: null,
  };
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [
      { label: { contains: q, mode: "insensitive" } },
      { creci: { contains: q, mode: "insensitive" } },
      // Busca livre inclui contato: quem procura "joao@" ou o telefone não
      // deveria precisar acertar a grafia do nome.
      { email: { contains: q, mode: "insensitive" } },
      ...(digits
        ? [
            { cpfCnpj: { contains: digits } },
            { ownerCpfCnpj: { contains: digits } },
            { phone: { contains: digits } },
          ]
        : []),
    ];
  }

  // Membro da imobiliária recebe também os dados de recebimento já cadastrados
  // — é o que permite autocompletar o formulário ao reconhecer um corretor que
  // já existe. Para anônimo o shape continua exatamente o de antes.
  const viewerIsMember = await viewerIsOrgMember(form.orgId);

  const recipients = await prisma.splitRecipient.findMany({
    where,
    orderBy: [{ label: "asc" }],
    // +1 pra saber se truncou sem uma segunda query. Sem este sinal a lista
    // cheia era indistinguível da lista completa, e quem não achava o corretor
    // concluía que ele não estava cadastrado.
    take: LIST_LIMIT + 1,
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
      ...(viewerIsMember ? RECEBIMENTO_SELECT : {}),
    },
  });

  const hasMore = recipients.length > LIST_LIMIT;
  const page = hasMore ? recipients.slice(0, LIST_LIMIT) : recipients;

  // Whitelist explícita do shape exposto. Documento mascarado pra evitar
  // que o form público vire ferramenta de scraping de CPFs/CNPJs.
  const items = page.map((r) => ({
    id: r.id,
    label: r.label,
    tipoPessoa: r.tipoPessoa ?? null,
    doc: maskDoc(r.cpfCnpj ?? r.ownerCpfCnpj),
    creci: r.creci ?? null,
    papel: r.papel ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    receivingPending: r.pendingFields.length > 0,
    ...(viewerIsMember ? { recebimento: recebimentoFromRecipient(r) } : {}),
  }));

  return NextResponse.json({ items, hasMore });
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
  tipoPessoa: z.enum(["fisica", "juridica"]),
  // OPCIONAL desde 08/2026, quando a criação do cadastro virou automática: a
  // etapa Comissão não pede CPF/CNPJ antes de e-mail e telefone, e exigi-lo
  // aqui faria toda linha identificada só por contato ficar sem cadastro — o
  // oposto do que a automação existe para resolver. O `superRefine` abaixo
  // continua exigindo ALGUM identificador.
  //
  // Quando vem, a validação é a de sempre — dígitos, não só comprimento:
  // `normalizeDoc` descarta não-dígitos, então um doc alfabético de 11+ chars
  // passava no Zod, normalizava pra "" e fazia `findCommissionerMatch` PULAR o
  // dedupe por documento, caindo no match só por nome, que é mais fraco. Era um
  // jeito barato de forçar cadastro novo.
  cpfCnpj: z
    .string()
    .trim()
    .min(11)
    .max(18)
    .refine((v) => {
      const d = v.replace(/\D/g, "").length;
      return d === 11 || d === 14;
    }, "CPF/CNPJ inválido — informe 11 (CPF) ou 14 (CNPJ) dígitos")
    .optional(),
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
}).superRefine((v, ctx) => {
  // Algum identificador é obrigatório. Sem nenhum, o dedupe cai no match por
  // nome exato — o elo mais fraco da escala — e um cadastro criado só com nome
  // vira lixo que ninguém consegue reconhecer nem reusar depois.
  if (!v.cpfCnpj && !v.email && !v.phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cpfCnpj"],
      message: "Informe CPF/CNPJ, e-mail ou telefone do corretor",
    });
  }
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
    // Cadastro que JÁ existe. A regra depende de quem está preenchendo:
    //
    //  - ANÔNIMO: nada é gravado (`receivingIgnored`). Deixar quem tem só o
    //    link trocar a chave PIX de um corretor existente é desvio de repasse.
    //  - MEMBRO da org: PREENCHE o que está vazio e nunca sobrescreve
    //    (`receivingFilled`). Descartar em silêncio o que a imobiliária digitou
    //    num cadastro que ela própria mantém era a trava batendo em quem ela
    //    não deveria pegar — e a queixa que motivou esta mudança.
    const receivingIgnored = !viewerIsMember && (sentPix || sentBank);
    const receivingFilled = viewerIsMember
      ? await fillEmptyReceiving(preexisting, {
          pix: hasPix
            ? {
                chave: data.pix!.chave!,
                keyType: pixKeyType!,
                titularNome: data.pix?.titularNome ?? null,
                titularCpfCnpj: data.pix?.titularCpfCnpj ?? null,
              }
            : undefined,
          banco: hasBank ? data.banco : undefined,
        })
      : [];

    if (receivingIgnored || receivingFilled.length > 0) {
      // Rastro nos dois sentidos: a tentativa barrada é sinal de ataque (ou de
      // corretor legítimo batendo na trava), e o preenchimento é escrita de PII
      // bancária — precisa dizer QUAIS campos, nunca os valores.
      await audit(
        {
          orgId: form.orgId,
          userId: null,
          ipAddress: req.headers.get("x-forwarded-for") ?? null,
          userAgent: req.headers.get("user-agent") ?? null,
        },
        {
          action: "SPLIT_RECIPIENT_UPDATED",
          result: receivingIgnored ? "DENIED" : "SUCCESS",
          resourceType: "split_recipient",
          resource: `split_recipient:${preexisting.id}`,
          metadata: {
            source: "public_form",
            formId: form.id,
            reason: receivingIgnored
              ? "receiving_data_ignored_on_existing_recipient"
              : "receiving_data_filled_empty_fields",
            viewerIsMember,
            sentPix,
            sentBank,
            filledFields: receivingFilled,
          },
        }
      );
    }

    // Relê só quando houve escrita — o `preexisting` em mãos está defasado.
    const current =
      receivingFilled.length > 0
        ? ((await prisma.splitRecipient.findUnique({
            where: { id: preexisting.id },
          })) ?? preexisting)
        : preexisting;

    return NextResponse.json(
      {
        recipient: {
          id: current.id,
          label: current.label,
          tipoPessoa: current.tipoPessoa,
          doc: maskDoc(current.cpfCnpj),
          creci: current.creci,
          papel: current.papel,
          email: current.email,
          phone: current.phone,
          // Para membro, o que o cadastro tem hoje — é o que a UI usa para
          // autocompletar o formulário depois do "sim, é a mesma pessoa".
          ...(viewerIsMember
            ? { recebimento: recebimentoFromRecipient(current) }
            : {}),
        },
        existed: true,
        isDraft: current.pendingFields.length > 0,
        receivingIgnored,
        receivingFilled,
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
