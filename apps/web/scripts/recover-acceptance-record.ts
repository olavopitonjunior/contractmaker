/**
 * Recupera, para uma proposta enviada por ACEITE via WhatsApp, os dados oficiais
 * do aceite na ClickSign — e o Registro do Aceite, se a API devolver link.
 *
 * Uso (a partir de apps/web):
 *   npx tsx scripts/recover-acceptance-record.ts <proposalId>
 *   npx tsx scripts/recover-acceptance-record.ts <proposalId> --attach
 *   npx tsx scripts/recover-acceptance-record.ts <proposalId> --attach --rebuild-proof
 *
 * Env (pelo ambiente, como os demais scripts — nada é lido de arquivo):
 *   DATABASE_URL          conexão Prisma (aponte pra prod pra recuperar em prod)
 *   MASTER_ENCRYPTION_KEY decifra o token ClickSign da org (AES-256-GCM)
 *   CLICKSIGN_ACCESS_TOKEN / CLICKSIGN_BASE_URL  fallback da org legada
 *   BLOB_READ_WRITE_TOKEN ou S3_BUCKET           destino do arquivo, com --attach
 *   NEXTAUTH_URL          base do link no texto aceito, com --rebuild-proof
 *
 * Flags:
 *   --attach         grava o ProposalEvent com a resposta crua e, havendo link,
 *                    baixa e anexa o Registro. Sem a flag é INSPEÇÃO PURA
 *                    (nenhuma escrita) — o default seguro.
 *   --rebuild-proof  refaz o Comprovante de Aceite com os dados oficiais na capa.
 *                    Implica --attach. Ver a ressalva sobre dossierUrl abaixo.
 *
 * POR QUE ESTE SCRIPT EXISTE
 * O Aceite via WhatsApp é um produto separado do envelope: a pessoa aceita um
 * texto + link, não assina um PDF. Não há `Envelope.signedDocumentUrl`. A
 * ClickSign gera um "Registro do Aceite" (provas de identidade + mensagens
 * trocadas), mas até hoje só o entrega pela interface web — a API v3 documentada
 * devolve apenas metadados. O passo 1 imprime a resposta CRUA justamente para
 * checar isso contra a conta real: se aparecer um campo de download não
 * documentado, o anexo passa a ser automático (o webhook usa o mesmo código).
 *
 * Não havendo link: baixe o Registro na ClickSign (Aceites → Via WhatsApp →
 * abra o aceite → histórico) e suba pela UI da proposta, em Documentos →
 * "Anexar Registro do Aceite".
 *
 * SOBRE --rebuild-proof
 * `Proposal.dossierUrl` é o guard de idempotência do comprovante. Refazer exige
 * limpá-lo e reconstruir. O script recusa se a proposta estiver `convertida`:
 * nesse estado os anexos já foram copiados pro deal e `convert.ts` exige o
 * campo preenchido. A key do storage é estável, então o PDF é sobrescrito no
 * lugar e nenhuma URL antiga fica pendurada.
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const proposalId = args.find((a) => !a.startsWith("--"));
  const rebuildProof = args.includes("--rebuild-proof");
  const attach = args.includes("--attach") || rebuildProof;

  if (!proposalId) {
    console.error("Uso: npx tsx scripts/recover-acceptance-record.ts <proposalId> [--attach] [--rebuild-proof]");
    process.exit(1);
  }

  // Imports dinâmicos: os módulos puxam o Prisma client, que precisa do env já
  // carregado acima.
  const { prisma } = await import("../src/lib/db/prisma");
  const { syncAcceptanceRecord } = await import("../src/lib/proposals/acceptance-record-sync");

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      orgId: true,
      title: true,
      status: true,
      instrument: true,
      token: true,
      dossierUrl: true,
      acceptanceClicksignId: true,
    },
  });
  if (!proposal) {
    console.error(`Proposta ${proposalId} não encontrada.`);
    process.exit(1);
  }

  // O termo VINCULANTE é o do proponente. Resolve pela linha do signatário e cai
  // pro campo da proposta (compat), na mesma ordem do webhook.
  const proponente = await prisma.proposalSigner.findFirst({
    where: { proposalId, role: "proponente", acceptanceClicksignId: { not: null } },
    select: { name: true, phone: true, acceptanceClicksignId: true, acceptanceStatus: true },
  });
  const acceptanceId = proponente?.acceptanceClicksignId ?? proposal.acceptanceClicksignId;

  console.log("=== Proposta ===");
  console.table({
    id: proposal.id,
    titulo: proposal.title,
    status: proposal.status,
    instrumento: proposal.instrument,
    dossierUrl: proposal.dossierUrl ?? "—",
    aceitante: proponente?.name ?? "—",
    aceiteStatus: proponente?.acceptanceStatus ?? "—",
    acceptanceId: acceptanceId ?? "—",
  });

  if (proposal.instrument !== "aceite") {
    console.error(
      `\nEsta proposta usou o instrumento "${proposal.instrument}", não o Aceite.\n` +
        "Se for envelope, o PDF assinado vem por outro caminho (Envelope.signedDocumentUrl);\n" +
        'use o botão "Atualizar" da proposta ou POST /api/proposals/<id>/sync.'
    );
    process.exit(1);
  }
  if (!acceptanceId) {
    console.error("\nNenhum acceptance_term registrado nesta proposta — nada a buscar.");
    process.exit(1);
  }
  if (rebuildProof && proposal.status === "convertida") {
    console.error(
      "\nProposta já CONVERTIDA: --rebuild-proof recusado.\n" +
        "Os anexos já foram copiados pro negócio e convert.ts exige dossierUrl preenchido."
    );
    process.exit(1);
  }

  // ---- Passo 1: buscar na ClickSign e imprimir a resposta CRUA ----
  console.log(`\n=== GET /api/v3/acceptance_term/whatsapps/${acceptanceId} ===`);
  if (!attach) console.log("(modo inspeção — nada será gravado; use --attach para persistir)");

  const sync = await syncAcceptanceRecord({
    proposalId: proposal.id,
    orgId: proposal.orgId,
    acceptanceId,
    persist: attach,
  });

  if (sync.error && sync.raw == null) {
    console.error(`\nFalha ao consultar a ClickSign: ${sync.error}`);
    process.exit(1);
  }

  console.log("\n--- Resposta crua ---");
  console.log(JSON.stringify(sync.raw, null, 2));
  console.log("\n--- Atributos oficiais extraídos ---");
  console.table(sync.facts);

  // ---- Passo 2: o Registro do Aceite ----
  if (sync.recordUrl) {
    console.log(`\n✔ Registro do Aceite obtido: ${sync.recordUrl}`);
    if (!attach) console.log("  (rode de novo com --attach para anexar de fato)");
  } else {
    console.log(
      "\n✖ Nenhum link de download na resposta — como esperado: a API v3 não expõe\n" +
        "  o Registro do Aceite. Baixe na ClickSign (Aceites → Via WhatsApp → abra o\n" +
        "  aceite → histórico) e suba pela proposta, em Documentos →\n" +
        '  "Anexar Registro do Aceite".'
    );
    if (sync.error) console.log(`  (houve também um erro no caminho de download: ${sync.error})`);
  }

  // ---- Passo 3: refazer o comprovante com os dados oficiais ----
  if (rebuildProof) {
    const { buildAcceptanceProof, buildAcceptanceMessage } = await import(
      "../src/lib/proposals/acceptance-proof"
    );
    const link = `${process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br"}/p/${proposal.token}`;
    const acceptedText = buildAcceptanceMessage({
      numero: proposal.id.slice(-8),
      title: proposal.title,
      link,
    });

    // Limpa o guard pra permitir a reconstrução. A key do storage é estável, o
    // PDF é sobrescrito no lugar.
    //
    // A restauração é `finally`, NÃO só o ramo de erro: `buildAcceptanceProof`
    // pode LANÇAR (puppeteer estoura, upload falha, transação quebra), e nesse
    // caso um catch só no retorno deixaria a proposta permanentemente sem
    // `dossierUrl` — estado que trava a conversão em negócio (convert.ts o
    // exige) e sem registro do valor antigo depois que o processo morre.
    const previousDossierUrl = proposal.dossierUrl;
    let rebuilt = false;
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { dossierUrl: null },
    });
    try {
      const res = await buildAcceptanceProof(proposal.id, {
        signerName: sync.facts.signerName ?? proponente?.name ?? "—",
        signerPhone: sync.facts.signerPhone ?? proponente?.phone ?? "—",
        acceptanceId,
        sentAt: sync.facts.sentAt ?? null,
        completedAt: null,
        acceptedText,
        official: sync.facts,
      });
      if ("url" in res) {
        rebuilt = true;
        console.log(`\n✔ Comprovante refeito: ${res.url}`);
      } else {
        console.error(`\n✖ Falha ao refazer o comprovante (${res.skipped}).`);
      }
    } catch (err) {
      console.error("\n✖ Erro ao refazer o comprovante:", err);
    } finally {
      if (!rebuilt) {
        // Best-effort com log alto: se ATÉ a restauração falhar, o operador
        // precisa ver a URL antiga pra recolocá-la à mão.
        await prisma.proposal
          .update({
            where: { id: proposal.id },
            data: { dossierUrl: previousDossierUrl },
          })
          .then(() => console.error("  dossierUrl restaurado."))
          .catch((e) => {
            console.error(
              `  !! FALHA AO RESTAURAR dossierUrl. Recoloque à mão:\n     ${previousDossierUrl}`,
              e
            );
          });
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
