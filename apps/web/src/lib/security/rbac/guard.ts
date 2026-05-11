import { PermissionKey } from "./permissions";
import { EffectivePermissions, can, getEffectivePermissions } from "./check";
import {
  AccountCapability,
  userHasAccountCapability,
} from "@/lib/asaas/account";

export class PermissionDeniedError extends Error {
  status = 403;
  code = "PERMISSION_DENIED";
  requiredPermission: PermissionKey;

  constructor(permission: PermissionKey) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
    this.requiredPermission = permission;
  }
}

export class MembershipRequiredError extends Error {
  status = 403;
  code = "MEMBERSHIP_REQUIRED";

  constructor() {
    super("User is not a member of this organization");
    this.name = "MembershipRequiredError";
  }
}

export class AccountCapabilityDeniedError extends Error {
  status = 403;
  code = "ACCOUNT_CAPABILITY_DENIED";
  capability: AccountCapability;
  accountId: string;

  constructor(capability: AccountCapability, accountId: string) {
    super(`Account capability denied: ${capability} on account ${accountId}`);
    this.name = "AccountCapabilityDeniedError";
    this.capability = capability;
    this.accountId = accountId;
  }
}

/**
 * Lança AccountCapabilityDeniedError se o user não tem a capability na conta.
 * Owner da org bypassa via userHasAccountCapability.
 */
export async function requireAccountCapability(params: {
  userId: string;
  accountId: string;
  capability: AccountCapability;
}): Promise<void> {
  const ok = await userHasAccountCapability(
    params.userId,
    params.accountId,
    params.capability
  );
  if (!ok) {
    throw new AccountCapabilityDeniedError(params.capability, params.accountId);
  }
}

/**
 * Resolve permissions efetivas e lança PermissionDeniedError se a permission
 * não estiver presente. Usar no topo de handlers de rota.
 */
export async function requirePermission(params: {
  userId: string;
  orgId: string;
  permission: PermissionKey;
}): Promise<EffectivePermissions> {
  const effective = await getEffectivePermissions(params.userId, params.orgId);
  if (!effective) throw new MembershipRequiredError();
  if (!can(effective, params.permission)) {
    throw new PermissionDeniedError(params.permission);
  }
  return effective;
}

/**
 * Sanitiza input de criação de charge com base no role do user.
 * Campos proibidos são reescritos com defaults e um `warnings[]` é retornado.
 *
 * Nota: este helper é chamado em Fase 1b quando a rota de criação de charge
 * for implementada. Definido aqui para antecipar o contrato.
 */
export interface ChargeInputBase {
  billingType: string;
  value: number;
  dueDate: string;
  customer?: string;
  description?: string;
  discount?: unknown;
  fine?: unknown;
  interest?: unknown;
  splitJson?: unknown;
  kind?: string;
  externalReference?: string;
}

export interface ChargeSanitizationResult<T> {
  sanitized: T;
  warnings: string[];
}

export function sanitizeChargeInput<T extends ChargeInputBase>(
  role: string,
  input: T,
  defaults: {
    finePercent: number;
    interestPercentMonth: number;
    discountPreset?: unknown;
    defaultSplit?: unknown;
  }
): ChargeSanitizationResult<T> {
  const warnings: string[] = [];
  const out = { ...input } as T;

  if (role === "sales") {
    if (input.splitJson !== undefined) {
      out.splitJson = defaults.defaultSplit ?? undefined;
      warnings.push("splitJson: override ignorado — usado split padrão da organização");
    }
    if (input.discount !== undefined && defaults.discountPreset === undefined) {
      out.discount = undefined;
      warnings.push("discount: sales não pode definir desconto custom");
    }
    if (input.fine !== undefined) {
      out.fine = { value: defaults.finePercent, type: "PERCENTAGE" };
      warnings.push("fine: sobrescrito com default da organização");
    }
    if (input.interest !== undefined) {
      out.interest = { value: defaults.interestPercentMonth, type: "PERCENTAGE" };
      warnings.push("interest: sobrescrito com default da organização");
    }
    if (input.kind && input.kind !== "commission") {
      out.kind = "commission";
      warnings.push("kind: sales só pode criar charges do tipo 'commission'");
    }
  }

  return { sanitized: out, warnings };
}
