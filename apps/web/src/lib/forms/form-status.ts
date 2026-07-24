/**
 * Predicados puros de estado do formulário — SEM dependências de servidor
 * (prisma, next/server), de propósito: precisam rodar tanto no gate server-side
 * (`form-gate.ts`) quanto em componentes client (headers de deal de vendas e
 * locação). Importar de `form-gate.ts` num client arrastaria o prisma pro
 * bundle do browser.
 */

/**
 * "Enviado" = o formulário terminou o preenchimento por um dos dois caminhos:
 *
 *  - `completedAt` setado — o cliente finalizou pelo link público.
 *  - `status === "vinculado"` — nasceu preso a um contrato criado por outra via
 *    (import de CCV, cadastro rápido com upload, proposta). Esses NUNCA passam
 *    pelo finalize, então nunca ganham `completedAt`.
 *
 * É o mesmo critério do ramo "finished" de `isFormClosed` (form-gate.ts) e da
 * validação da rota `/api/forms/[token]/lock`. Único ponto de verdade pra saber
 * se dá pra reabrir.
 *
 * `completedAt` aceita `Date | string` porque o server passa `Date` e os
 * componentes client recebem ISO string — só a veracidade importa aqui.
 */
export function isFormFinished(form: {
  completedAt: Date | string | null;
  status?: string | null;
}): boolean {
  return Boolean(form.completedAt) || form.status === "vinculado";
}
