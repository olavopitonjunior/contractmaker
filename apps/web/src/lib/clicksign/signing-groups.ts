/**
 * Normaliza os grupos de assinatura ENVIADOS à ClickSign pra 1..n contíguos.
 *
 * A ClickSign v3 só notifica o grupo N depois que TODOS do grupo N-1 assinam.
 * O `signingGroup` persistido carrega semântica de negócio (1 = proponente,
 * 2 = vendedor/testemunha) e é reaproveitado verbatim em envelopes que não
 * contêm o grupo 1 — a via "reduzida" do vendedor é só grupo 2 — e aí o gate
 * nunca destrava e ninguém é notificado na ativação (#propostas "só chega com
 * reenvio": o endpoint de notificação manual ignora o gate). O executor de
 * contratos já renumera (executor.ts::finalGroup); aqui é o equivalente pro
 * envio de propostas, preservando a ORDEM relativa entre grupos.
 *
 * `null`/`undefined` conta como grupo 1 (mesmo default do schema).
 */
export function normalizeSigningGroups(
  groups: Array<number | null | undefined>
): (group: number | null | undefined) => number {
  const distinct = [...new Set(groups.map((g) => g ?? 1))].sort((a, b) => a - b);
  const map = new Map(distinct.map((g, i) => [g, i + 1]));
  return (group) => map.get(group ?? 1) ?? 1;
}
