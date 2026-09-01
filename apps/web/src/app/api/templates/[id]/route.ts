import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  matchCriteriaSchema,
  parseMatchCriteria,
  resolveTemplateTaxonomy,
  schemaTypeForModalidade,
  templateFamilyForModalidade,
} from "@/lib/contracts/template-category";
import {
  checkSlotClauseReadiness,
  slotClauseGapMessage,
} from "@/lib/templates/slot-readiness";
import {
  auditTemplateText,
  parseTemplatePiiReport,
  piiGateMessage,
  PII_UNVERIFIED_MESSAGE,
  readDraftReport,
} from "@/lib/templates/pii-gate";
import { getDocPlainText } from "@/lib/google/docs";
import { audit } from "@/lib/security/audit";

/**
 * Escopo multitenant deny-by-default.
 *
 * `ContractTemplate.orgId` é direto (não passa pelo pipeline como Contract), e
 * o filtro vai NA QUERY: inexistente e cross-org devolvem o MESMO 404, sem
 * confirmar a existência do template de outro tenant. Sem isto, o
 * `handlebarsSource` — o texto contratual proprietário da imobiliária — era
 * legível, editável e apagável por qualquer sessão autenticada só com o id.
 */
const NOT_FOUND = () =>
  NextResponse.json({ error: "Template not found" }, { status: 404 });

async function resolveOrgId(userId: string): Promise<string | null> {
  const org = await getUserOrg(userId);
  return org?.id ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await resolveOrgId(session.user.id);
  if (!orgId) return NOT_FOUND();

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId },
  });

  if (!template) return NOT_FOUND();

  return NextResponse.json(template);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const orgId = await resolveOrgId(session.user.id);
  if (!orgId) return NOT_FOUND();

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId },
  });

  if (!template) return NOT_FOUND();

  // Categoria (forma de pagamento) é canônica SÓ em template de venda. Num
  // template de locação/proposta ela é ignorada — derivar a modalidade dela
  // apagava a locação e o template sumia do selectLocacaoTemplate.
  const { category: nextCategory, modalidade: nextModalidade } = resolveTemplateTaxonomy({
    currentModalidade: template.modalidade,
    currentCategory: template.category,
    category: body.category,
    modalidade: body.modalidade,
  });
  // schemaType acompanha a modalidade quando ela muda de fato (o template
  // deixa de descrever o mesmo instrumento).
  const nextSchemaType =
    nextModalidade !== template.modalidade
      ? schemaTypeForModalidade(nextModalidade)
      : template.schemaType;
  // Critério de variante (locação/proposta). Só é reescrito quando o payload
  // TRAZ o campo — a listagem manda PATCH { status } e não pode apagar o
  // critério de quem já tem; `null` explícito limpa. Em venda é sempre null:
  // ali quem discrimina é a categoria (forma de pagamento).
  let nextMatchCriteria: Prisma.InputJsonValue | typeof Prisma.DbNull;
  if (templateFamilyForModalidade(nextModalidade) === "venda") {
    nextMatchCriteria = Prisma.DbNull;
  } else {
    let criteria: unknown = template.matchCriteria;
    if (body.matchCriteria !== undefined) {
      // Zod estrito só no que CHEGA. O valor já gravado passa pelo parser
      // tolerante — validar o legado com `.strict()` faria um PATCH inocente
      // (ex.: arquivar pela listagem) morrer em 400 por causa do banco.
      const validated = matchCriteriaSchema.safeParse(body.matchCriteria);
      if (!validated.success) {
        return NextResponse.json({ error: validated.error.message }, { status: 400 });
      }
      criteria = validated.data;
    }
    const normalized = parseMatchCriteria(criteria);
    nextMatchCriteria = normalized ? (normalized as Prisma.InputJsonValue) : Prisma.DbNull;
  }

  const nextIsDefault =
    typeof body.isDefault === "boolean" ? body.isDefault : template.isDefault;
  const nextSource = body.handlebarsSource ?? template.handlebarsSource;
  const sourceChanged = nextSource !== template.handlebarsSource;

  // ─── TRAVA DA ATIVAÇÃO: slot aberto sem cláusula aprovada ─────────────────
  // No servidor, e não só na tela, porque é aqui que TODOS os caminhos de
  // ativação passam (a página de revisão, a listagem e qualquer chamada
  // futura). Enquanto o modelo é draft o slot é inofensivo — a geração só
  // enxerga `active` —, então a checagem custa uma consulta apenas na
  // transição para ativo. Ver lib/templates/slot-readiness.ts.
  // "Este PATCH é uma ativação" mora num lugar só — as duas travas leem daqui.
  const activating = body.status === "active" && template.status !== "active";

  if (activating && !body.forceActivate) {
    const readiness = await checkSlotClauseReadiness({
      orgId,
      handlebarsSource: nextSource,
      matchCriteria: nextMatchCriteria === Prisma.DbNull ? null : nextMatchCriteria,
    });
    if (!readiness.ready) {
      return NextResponse.json(
        {
          error: slotClauseGapMessage(readiness.gaps),
          code: "SLOT_CLAUSE_MISSING",
          gaps: readiness.gaps,
        },
        { status: 409 }
      );
    }
  }

  // ─── TRAVA DA ATIVAÇÃO: dado pessoal literal no texto do modelo ──────────
  // Flag PRÓPRIO (`allowPii`), não o `forceActivate` do slot: "aceito o texto
  // padrão da plataforma na garantia" e "aceito imprimir o CPF de um terceiro
  // em todo contrato" são decisões diferentes, e um flag só faria a primeira
  // liberar a segunda sem ninguém ler. Modelo sem relatório (legado, ou Doc
  // ilegível na ingestão) passa: a revalidação mede na primeira leitura.
  // `=== true`, não truthiness: "allowPii": "não" não pode liberar a trava.
  const allowPii = body.allowPii === true;
  if (activating) {
    let pii = parseTemplatePiiReport(template.draftReport);
    if (!pii && !allowPii) {
      // Nunca medido (legado, from-contract, releitura que falhou na ingestão):
      // mede AGORA, uma vez, em vez de presumir limpo. Google Docs lê o Doc;
      // handlebars audita o próprio source. Se nem isso der, falha FECHADO.
      try {
        const text =
          template.engine === "google_docs" && template.googleTemplateDocId
            ? await getDocPlainText(template.googleTemplateDocId)
            : nextSource;
        if (!text) throw new Error("texto vazio");
        pii = auditTemplateText(text);
        await prisma.contractTemplate.update({
          where: { id: params.id, orgId },
          data: { draftReport: { ...readDraftReport(template.draftReport), pii } as object },
        });
      } catch (err) {
        console.error("[templates/PATCH] não consegui medir PII antes de ativar:", err);
        return NextResponse.json(
          { error: PII_UNVERIFIED_MESSAGE, code: "PII_UNVERIFIED" },
          { status: 409 }
        );
      }
    }
    if (pii?.blocked && !allowPii) {
      return NextResponse.json(
        {
          error: piiGateMessage(pii),
          code: "PII_LEFTOVER",
          pii: { kinds: pii.kinds, count: pii.count, checkedAt: pii.checkedAt },
        },
        { status: 409 }
      );
    }
    if (allowPii && (!pii || pii.blocked)) {
      // Quem aceita imprimir o dado em todo contrato assume isso com nome
      // próprio — e o log é imutável (impersonation carimba o ator efetivo).
      await audit(
        { orgId, userId: session.user.id },
        {
          action: "TEMPLATE_ACTIVATE_WITH_PII",
          result: "SUCCESS",
          resource: params.id,
          resourceType: "ContractTemplate",
          metadata: pii
            ? { kinds: pii.kinds, count: pii.count, checkedAt: pii.checkedAt }
            : { unmeasured: true },
        }
      );
    }
  }

  if (nextIsDefault) {
    await prisma.contractTemplate.updateMany({
      where: {
        orgId: template.orgId,
        modalidade: nextModalidade,
        isDefault: true,
        id: { not: params.id },
      },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.contractTemplate.update({
    where: { id: params.id },
    data: {
      name: body.name ?? template.name,
      description: body.description ?? template.description,
      handlebarsSource: nextSource,
      modalidade: nextModalidade,
      category: nextCategory,
      matchCriteria: nextMatchCriteria,
      schemaType: nextSchemaType,
      isDefault: nextIsDefault,
      version: body.version ?? template.version,
      status: body.status ?? template.status,
      engine: body.engine ?? template.engine,
      googleTemplateDocId:
        body.googleTemplateDocId !== undefined
          ? body.googleTemplateDocId
          : template.googleTemplateDocId,
      // Preview fica obsoleto quando o source muda — força regeneração no
      // próximo "Visualizar". Mantém o doc Drive antigo pra não quebrar
      // iframes que estejam abertos durante a edição.
      ...(sourceChanged
        ? { previewSourceHash: null, previewUpdatedAt: null }
        : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await resolveOrgId(session.user.id);
  if (!orgId) return NOT_FOUND();

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId },
    include: { _count: { select: { contracts: true } } },
  });

  if (!template) return NOT_FOUND();

  // If template has contracts, archive instead of delete
  if (template._count.contracts > 0) {
    await prisma.contractTemplate.update({
      where: { id: params.id },
      data: { status: "archived" },
    });
    return NextResponse.json({ status: "archived" });
  }

  await prisma.contractTemplate.delete({ where: { id: params.id } });
  return NextResponse.json({ status: "deleted" });
}
