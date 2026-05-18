/**
 * Conteúdo raw de `policy.yaml` como string TS — bundlado direto no chunk
 * Vercel sem depender de filesystem em runtime.
 *
 * Por quê: `policy-engine.ts` original lia `fs.readFileSync(__dirname,
 * "policy.yaml")` mas Next.js não copia assets YAML pra
 * `.next/server/chunks/`, e em prod o serverless function falhava com
 * ENOENT toda chamada do orchestrator multi-agent.
 *
 * Por quê NÃO usar `import policy.yaml` direto:
 * - Webpack precisaria de `asset/source` rule (configurável em next.config)
 * - Vitest usa rolldown/vite — outro loader, falha sem plugin
 * - Manter ambos sincronizados é fricção desnecessária pra um arquivo de 70 linhas
 *
 * Trade-off: editar policy agora exige tocar este arquivo TS. O comentário
 * original do YAML dizia "pra mudar policy em produção, basta deploy —
 * sem alterar código" — mas isso na prática nunca funcionou porque a leitura
 * em prod já estava quebrada. Hoje é honesto sobre exigir deploy.
 *
 * Pra editar: alterar a template string abaixo (preserva indentação YAML
 * via tagged template — espaço significativo!). Manter `apps/web/src/lib/
 * ai/sentinel/policy.yaml` como source-of-truth visual + targeting de
 * code-review; este arquivo é o que efetivamente roda. Em caso de
 * divergência, este TS vence (carregado pelo `policy-engine.ts`).
 */

export const POLICY_YAML_RAW = `
rules:
  - id: no_external_url_in_insert_image
    description: >
      Só permite imagens vindas do Vercel Blob (storage gerenciado da
      org) ou de domínios canônicos do produto. URLs externas arbitrárias
      são bloqueadas pra impedir SSRF, exfil via beacon e exibição de
      conteúdo malicioso no contrato.

      Nota: usa \`[.]\` em vez de \`\\.\` no regex porque YAML block scalar
      \`|\` preserva escapes literais — \`\\\\.\` viraria \`\\\\.\` no string final
      e quebraria o RegExp. \`[.]\` é equivalente e funciona em qualquer
      formato de string.
    when: |
      tool == "insert_image" AND
      NOT (
        input.url MATCHES "^https://[a-z0-9-]+[.]public[.]blob[.]vercel-storage[.]com/" OR
        input.url MATCHES "^https://imobpro[.]ia[.]br/"
      )
    action: reject
    reason: >
      URL de imagem fora da allow-list (Vercel Blob ou domínio canônico).
      Faça upload via /api/contracts/[id]/images antes.

  - id: no_template_change_without_evidence
    description: >
      propose_template_change exige ≥1 contractMemory id em \`evidence\`.
      Mantém o flow Propose ancorado em padrões observados, não em
      sugestões avulsas. Já era enforced no handler, agora vira regra
      versionada.
    when: |
      tool == "propose_template_change" AND
      (input.evidence == null OR input.evidence.length < 1)
    action: reject
    reason: >
      Mudança de template exige evidência (≥1 contractMemory id em que o
      padrão foi observado).

  - id: budget_exceeded
    description: >
      Bloqueia qualquer tool_use quando o budget de tokens do contrato
      foi atingido. Redundante com assertContractBudget mas garante
      enforcement na camada Sentinel.
    when: |
      tokensSpent >= budgetCap
    action: reject
    reason: >
      Budget de IA deste contrato atingido. Solicite aprovação pra
      aumentar o limite ou aguarde o próximo ciclo.
`;
