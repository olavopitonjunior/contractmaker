import { describe, it, expect } from "vitest";
import { sniffFileType, signatureMatchesMime } from "../file-signature";

function buf(bytes: number[], pad = 12): Buffer {
  const arr = [...bytes];
  while (arr.length < pad) arr.push(0);
  return Buffer.from(arr);
}

const PDF = buf([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG = buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = buf([0xff, 0xd8, 0xff, 0xe0]);
const GIF = buf([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = buf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const ZIP = buf([0x50, 0x4b, 0x03, 0x04]);
const EXE = buf([0x4d, 0x5a, 0x90, 0x00]); // MZ (PE)

describe("sniffFileType", () => {
  it.each([
    [PDF, "pdf"],
    [PNG, "png"],
    [JPEG, "jpeg"],
    [GIF, "gif"],
    [WEBP, "webp"],
    [ZIP, "zip"],
    [EXE, "unknown"],
  ])("detecta assinatura", (b, expected) => {
    expect(sniffFileType(b as Buffer)).toBe(expected);
  });

  it("buffer curto → unknown", () => {
    expect(sniffFileType(Buffer.from([0x25, 0x50]))).toBe("unknown");
  });
});

describe("signatureMatchesMime", () => {
  it("aceita quando bytes batem com o MIME", () => {
    expect(signatureMatchesMime(PDF, "application/pdf")).toBe(true);
    expect(signatureMatchesMime(PNG, "image/png")).toBe(true);
    expect(signatureMatchesMime(JPEG, "image/jpeg")).toBe(true);
  });

  it("rejeita executável renomeado como PDF", () => {
    expect(signatureMatchesMime(EXE, "application/pdf")).toBe(false);
  });

  it("rejeita PNG declarado como JPEG", () => {
    expect(signatureMatchesMime(PNG, "image/jpeg")).toBe(false);
  });

  it("MIME sem assinatura conhecida passa (gate de allowlist é do caller)", () => {
    expect(signatureMatchesMime(EXE, "application/octet-stream")).toBe(true);
  });
});
