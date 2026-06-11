import { AsaasProvider } from "./asaas-provider";
import type { PaymentProvider } from "./provider";

export type { PaymentProvider } from "./provider";
export { PaymentProviderError } from "./provider";
export * from "./types";

export type PaymentProviderName = "asaas";

/**
 * Resolve o PaymentProvider de uma org/conta (Fase 0d). Hoje só Asaas — o
 * `provider` param e o switch existem pra preservar opcionalidade (Celcoin et al.
 * reavaliados aos ~2k tenants; ver docs/payments-architecture.md). A apiKey vem
 * descriptografada de getAccountWithApiKey (lib/asaas/account.ts).
 */
export function getPaymentProvider(opts: {
  apiKey: string;
  provider?: PaymentProviderName;
}): PaymentProvider {
  const provider = opts.provider ?? "asaas";
  switch (provider) {
    case "asaas":
      return new AsaasProvider(opts.apiKey);
    default:
      // Exhaustiveness: hoje só "asaas". Novos providers entram aqui.
      return new AsaasProvider(opts.apiKey);
  }
}
