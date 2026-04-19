import { authenticator } from "otplib";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { encryptSecret, decryptSecret, EncryptedSecret } from "./crypto";

authenticator.options = {
  window: 1, // tolerância 30s antes/depois para clock skew
  step: 30,
  digits: 6,
};

const ISSUER = "Contractmaker";

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildProvisioningUri(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

export async function buildQrCodeDataUrl(provisioningUri: string): Promise<string> {
  return QRCode.toDataURL(provisioningUri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const cleaned = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    return authenticator.verify({ token: cleaned, secret });
  } catch {
    return false;
  }
}

// ---------- Recovery codes ----------

const RECOVERY_CODE_COUNT = 10;

export interface RecoveryCodeBundle {
  plaintext: string[];           // mostrado UMA vez ao usuário
  hashedJson: string;            // salvar em TwoFactorSecret.recoveryCodesEnc
}

function generateSingleRecoveryCode(): string {
  const bytes = crypto.randomBytes(5);
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 5)}-${hex.slice(5, 10)}`;
}

export async function generateRecoveryCodes(): Promise<RecoveryCodeBundle> {
  const plaintext: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = generateSingleRecoveryCode();
    plaintext.push(code);
    hashes.push(await bcrypt.hash(code, 10));
  }
  return {
    plaintext,
    hashedJson: JSON.stringify(hashes),
  };
}

export async function verifyRecoveryCode(
  storedJson: string,
  providedCode: string
): Promise<{ valid: boolean; remainingJson: string }> {
  const cleaned = providedCode.replace(/\s/g, "").toUpperCase();
  let hashes: string[];
  try {
    hashes = JSON.parse(storedJson) as string[];
  } catch {
    return { valid: false, remainingJson: storedJson };
  }

  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    if (!hash) continue;
    if (await bcrypt.compare(cleaned, hash)) {
      // Invalida o código usado
      hashes[i] = "";
      return { valid: true, remainingJson: JSON.stringify(hashes) };
    }
  }
  return { valid: false, remainingJson: storedJson };
}

export function countRemainingRecoveryCodes(storedJson: string): number {
  try {
    const hashes = JSON.parse(storedJson) as string[];
    return hashes.filter((h) => !!h).length;
  } catch {
    return 0;
  }
}

// ---------- Encrypted secret helpers ----------

export function encryptTotpSecret(secret: string): EncryptedSecret {
  return encryptSecret(secret);
}

export function decryptTotpSecret(enc: EncryptedSecret): string {
  return decryptSecret(enc);
}
