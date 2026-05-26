import {
  createPayment,
  getPayment,
  cancelPayment,
  refundPayment,
} from "@/lib/asaas/payments";
import { upsertCustomer, getCustomer } from "@/lib/asaas/customers";
import {
  createTransfer as asaasCreateTransfer,
  cancelTransfer as asaasCancelTransfer,
} from "@/lib/asaas/transfers";
import type {
  AsaasPayment,
  AsaasCustomer,
  AsaasBillingType,
  CreatePaymentInput,
} from "@/lib/asaas/types";
import type { AsaasTransfer } from "@/lib/asaas/transfers";
import type { PaymentProvider } from "./provider";
import type {
  Charge,
  CreateChargeInput,
  CreateCustomerInput,
  CreateTransferInput,
  PaymentCustomer,
  Transfer,
} from "./types";

/** Mapeia o payment do Asaas pro DTO neutro Charge. */
function toCharge(p: AsaasPayment): Charge {
  return {
    id: p.id,
    customerId: p.customer,
    value: p.value,
    netValue: p.netValue ?? null,
    status: p.status,
    billingType: p.billingType as Charge["billingType"],
    dueDate: p.dueDate,
    invoiceUrl: p.invoiceUrl ?? null,
    bankSlipUrl: p.bankSlipUrl ?? null,
    externalReference: p.externalReference ?? null,
  };
}

function toCustomer(c: AsaasCustomer): PaymentCustomer {
  return { id: c.id, name: c.name, cpfCnpj: c.cpfCnpj, email: c.email ?? null };
}

function toTransfer(t: AsaasTransfer): Transfer {
  return { id: t.id, status: t.status, value: t.value };
}

/**
 * AsaasProvider — implementação concreta de PaymentProvider (Fase 0d). Delega
 * pras funções existentes de `lib/asaas/*` (não move nada) e mapeia os shapes
 * Asaas ↔ DTOs neutros. Construído com a apiKey da subconta da org.
 */
export class AsaasProvider implements PaymentProvider {
  readonly name = "asaas";

  constructor(private readonly apiKey: string) {}

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    const asaasInput: CreatePaymentInput = {
      customer: input.customerId,
      billingType: input.billingType as AsaasBillingType,
      value: input.value,
      dueDate: input.dueDate,
      description: input.description,
      externalReference: input.externalReference,
      split: input.splits,
    };
    const p = await createPayment({ input: asaasInput, apiKey: this.apiKey });
    return toCharge(p);
  }

  async getCharge(chargeId: string): Promise<Charge> {
    return toCharge(await getPayment({ asaasId: chargeId, apiKey: this.apiKey }));
  }

  async cancelCharge(chargeId: string): Promise<{ deleted: boolean; id: string }> {
    return cancelPayment({ asaasId: chargeId, apiKey: this.apiKey });
  }

  async refundCharge(chargeId: string, value?: number): Promise<Charge> {
    const p = await refundPayment({ asaasId: chargeId, value, apiKey: this.apiKey });
    return toCharge(p);
  }

  async upsertCustomer(input: CreateCustomerInput): Promise<PaymentCustomer> {
    const c = await upsertCustomer({
      input: {
        name: input.name,
        cpfCnpj: input.cpfCnpj,
        email: input.email,
        phone: input.phone,
        mobilePhone: input.mobilePhone,
      },
      apiKey: this.apiKey,
    });
    return toCustomer(c);
  }

  async getCustomer(customerId: string): Promise<PaymentCustomer> {
    return toCustomer(await getCustomer({ asaasId: customerId, apiKey: this.apiKey }));
  }

  async createTransfer(input: CreateTransferInput): Promise<Transfer> {
    const t = await asaasCreateTransfer({
      input: {
        value: input.value,
        description: input.description,
        pixAddressKey: input.pixAddressKey,
        pixAddressKeyType: input.pixAddressKeyType,
      },
      apiKey: this.apiKey,
    });
    return toTransfer(t);
  }

  async cancelTransfer(transferId: string): Promise<{ deleted: boolean; id: string }> {
    return asaasCancelTransfer({ asaasId: transferId, apiKey: this.apiKey });
  }
}
