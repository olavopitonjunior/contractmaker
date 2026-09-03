/**
 * Revalidação do Doc-modelo de um template `engine="google_docs"`.
 *
 * Estava inteira dentro da rota `POST /api/templates/[id]/validate-gdoc`. Saiu
 * para cá porque passou a ter mais de um chamador: além da rota (botão
 * "Revalidar" e o gate da ativação), quem MEXE no Doc precisa reconferir o
 * resultado no mesmo passo em que mexeu — senão a tela mostra o estado anterior
 * à edição e o operador revalida a mão para descobrir o que já aconteceu.
 *
 * O que ela faz, em ordem: lê o Doc uma vez → confronta as chaves com o
 * catálogo da modalidade → reconcilia a declaração de slots com o documento →
 * mede PII → roda as checagens semânticas (`semantic-checks.ts`) → grava o
 * espelho em `draftReport`.
 */
import { prisma } from "@/lib/db/prisma";
import { getDocPlainText } from "@/lib/google/docs";
import { auditTemplateText, type TemplatePiiReport } from "@/lib/templates/pii-gate";
import { extractPlaceholdersFromText } from "@/lib/google/replace-placeholders";
import {
  catalogForModalidade,
  requiredTokens,
} from "@/lib/templates/placeholder-catalog";
import {
  CLAUSE_SLOT_KEYS,
  detectClauseSlots,
  slotDeclarationComment,
  slotToken,
  type ClauseSlotKey,
} from "@/lib/templates/clause-slots";
import {
  persistableSemanticReport,
  runSemanticChecks,
  type OrgFacts,
  type SemanticReport,
} from "@/lib/templates/semantic-checks";

/** Cabeçalho do "source" de um template engine="google_docs" (ver from-docx). */
export const GOOGLE_DOCS_SOURCE_HEADER =
  "<!-- engine=google_docs: a fonte é o Google Doc -->";

/** Campos do template que a revalidação precisa (o row inteiro serve). */
export interface ValidatableTemplate {
  id: string;
  orgId: string;
  engine: string;
  modalidade: string | null;
  googleTemplateDocId: string | null;
  handlebarsSource: string;
  sourceHash: string | null;
  draftReport: unknown;
}

export interface ValidateGoogleDocResult {
  docId: string;
  found: string[];
  unknown: string[];
  missingRequired: string[];
  slots: Array<Record<string, unknown>>;
  pii: TemplatePiiReport | null;
  /** Achados semânticos COM as frases cruas do conserto (o persistido não tem). */
  semantic: SemanticReport;
  catalog: Array<{
    token: string;
    label: string;
    description: string;
    required: boolean;
    kind: string;
    present: boolean;
  }>;
}

/**
 * Texto do contrato ORIGINAL que deu origem a este modelo, quando existir.
 *
 * A junção é `(sourceHash, run.orgId)` — não há FK entre `ContractTemplate` e
 * `IngestionItem`, e `sourceHash` é a mesma identidade nos dois lados (SHA-256
 * do arquivo). O status do run é ignorado de propósito: um lote cancelado ou
 * com erro ainda guarda o texto do arquivo que virou este modelo.
 */
async function loadSourceText(
  sourceHash: string | null,
  orgId: string
): Promise<string | null> {
  if (!sourceHash) return null;
  const item = await prisma.ingestionItem.findFirst({
    where: { sourceHash, run: { orgId } },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });
  return item?.text ?? null;
}

async function loadOrgFacts(orgId: string): Promise<OrgFacts | null> {
  return prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      legalName: true,
      cnpj: true,
      creci: true,
      pixAddressKey: true,
      bankBranch: true,
      bankAccount: true,
    },
  });
}

export async function validateGoogleDocTemplate(input: {
  template: ValidatableTemplate;
  orgId: string;
}): Promise<ValidateGoogleDocResult> {
  const { template, orgId } = input;
  const docId = template.googleTemplateDocId as string;
  const modalidade = template.modalidade ?? "a_vista";

  const text = await getDocPlainText(docId);
  const found = extractPlaceholdersFromText(text);
  const catalog = catalogForModalidade(modalidade);
  const known = new Set(catalog.map((d) => d.token));
  const slotTokens = new Set(CLAUSE_SLOT_KEYS.map(slotToken));
  // Slot NÃO é "chave desconhecida": ele é resolvido em `resolveClauseSlots`,
  // não pelo catálogo de placeholders.
  const unknown = found.filter((t) => !known.has(t) && !slotTokens.has(t));
  const foundSet = new Set(found);
  const missingRequired = requiredTokens(modalidade).filter((t) => !foundSet.has(t));

  // ─── RECONCILIA A DECLARAÇÃO DE SLOTS COM O DOCUMENTO ──────────────────
  // A declaração vive no `handlebarsSource` e o token vive no Doc — se as
  // duas pontas divergirem, a geração faz besteira em silêncio: declarado sem
  // token = a cláusula resolvida é jogada fora e o contrato sai com a garantia
  // chumbada; token sem declaração = `cleanupOrphanPlaceholders` apaga o token
  // e o contrato sai SEM cláusula de garantia.
  //
  // Como a revalidação já leu o Doc inteiro, ela é o lugar natural pra
  // sincronizar — e é o que faz o conserto manual (o operador escreve
  // `{{slot_garantia}}` no Doc, como a página de revisão instrui) passar a
  // valer sem nenhum passo extra.
  const slotsInDoc: ClauseSlotKey[] = CLAUSE_SLOT_KEYS.filter((s) =>
    foundSet.has(slotToken(s))
  );
  const declaredSlots = detectClauseSlots(template.handlebarsSource);
  const slotsChanged =
    slotsInDoc.length !== declaredSlots.length ||
    slotsInDoc.some((s) => !declaredSlots.includes(s));
  // Export vazio é "não medido" (como na ingestão, no rerun-ai e no PATCH):
  // gravar blocked:false sobre texto nenhum apagaria um blocked:true real.
  const pii = text ? auditTemplateText(text) : null;

  // As checagens semânticas precisam de duas entradas que a validação
  // sintática nunca teve: o cadastro da própria imobiliária e o contrato que
  // deu origem ao modelo. Sem elas, o relatório diz o que NÃO pôde afirmar
  // (`orgFactsAvailable`/`sourceAvailable`) em vez de calar.
  const [org, sourceText] = await Promise.all([
    loadOrgFacts(orgId),
    loadSourceText(template.sourceHash, orgId),
  ]);
  const semantic = runSemanticChecks({
    docText: text,
    modalidade,
    org,
    sourceText,
  });

  // Atualiza o relatório do draft com o estado mais recente da validação.
  const prevReport =
    template.draftReport && typeof template.draftReport === "object"
      ? (template.draftReport as Record<string, unknown>)
      : {};
  // O `applied` do relatório é ESPELHO do Doc, nos dois sentidos. Promover
  // (false→true) faz o conserto manual valer sem passo extra: o operador
  // escreve `{{slot_garantia}}` no Doc, revalida, a trava da ativação some.
  //
  // Rebaixar (true→false) é igualmente necessário e faltava: enquanto o mapa
  // só subia, um `applied: true` gravado por engano — a ingestão presumia a
  // troca sem conferir, ver `apply-clause-slot.ts` — era PERMANENTE, e a
  // revalidação (o único lugar que relê o Doc) confirmava a mentira. Modelo
  // declarado com slot ausente gera contrato com a garantia chumbada da
  // variante de referência, seja qual for a escolha do formulário.
  const prevSlots = Array.isArray(prevReport.slots)
    ? (prevReport.slots as Array<Record<string, unknown>>)
    : [];
  const slots = prevSlots.map((s) => {
    if (typeof s?.slot !== "string") return s;
    const token = slotToken(s.slot as ClauseSlotKey);
    if (foundSet.has(token)) {
      return { ...s, applied: true, token: `{{${token}}}`, issues: [] };
    }
    if (s.applied !== true) return s;
    const prevIssues = Array.isArray(s.issues) ? s.issues : [];
    return {
      ...s,
      applied: false,
      token: null,
      issues: [...prevIssues, { paragraph: `{{${token}}}`, reason: "token-missing" }],
    };
  });

  await prisma.contractTemplate.update({
    // `orgId` no where além do id: a org já foi checada pelo chamador, isto é
    // defesa em profundidade — o update nunca alcança template de outro tenant.
    where: { id: template.id, orgId },
    data: {
      draftReport: {
        ...prevReport,
        ...(prevSlots.length ? { slots } : {}),
        missingRequired,
        // Espelho do Doc, como `slots`: o operador troca o trecho por uma
        // chave, revalida, e a trava de PII da ativação some.
        ...(pii ? { pii } : {}),
        // Sem as frases do conserto (só o verbo): quem aplica pega o texto da
        // resposta HTTP desta mesma chamada. O EXCERTO fica — é o que mostra na
        // tela qual parágrafo tem o problema —, mascarado e cortado em 240.
        semantic: persistableSemanticReport(semantic),
        lastValidatedAt: new Date().toISOString(),
      } as object,
      ...(template.engine === "google_docs" && slotsChanged
        ? {
            handlebarsSource: [
              GOOGLE_DOCS_SOURCE_HEADER,
              slotDeclarationComment(slotsInDoc),
            ]
              .filter(Boolean)
              .join("\n"),
          }
        : {}),
    },
  });

  return {
    docId,
    found,
    unknown,
    missingRequired,
    slots,
    pii,
    semantic,
    catalog: catalog.map((d) => ({
      token: d.token,
      label: d.label,
      description: d.description,
      required: d.required,
      kind: d.kind,
      present: foundSet.has(d.token),
    })),
  };
}
