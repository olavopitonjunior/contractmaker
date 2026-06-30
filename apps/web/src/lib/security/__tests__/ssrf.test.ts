import { describe, it, expect } from "vitest";
import { isPrivateHost } from "../ssrf";

describe("isPrivateHost", () => {
  it("blocks loopback and localhost", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("app.localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("127.255.255.254")).toBe(true);
  });

  it("blocks the cloud metadata endpoint (IMDS) in all forms", () => {
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    // IPv4-mapped IPv6 — o bypass que o guard antigo deixava passar (H2).
    expect(isPrivateHost("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateHost("[::ffff:169.254.169.254]")).toBe(true);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isPrivateHost("10.0.0.5")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
  });

  it("blocks CGNAT and 0.0.0.0", () => {
    expect(isPrivateHost("100.64.0.1")).toBe(true);
    expect(isPrivateHost("0.0.0.0")).toBe(true);
  });

  it("blocks IPv6 loopback / ULA / link-local", () => {
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("[::1]")).toBe(true);
    expect(isPrivateHost("fc00::1")).toBe(true);
    expect(isPrivateHost("fd12:3456::1")).toBe(true);
    expect(isPrivateHost("fe80::1")).toBe(true);
  });

  it("allows public hosts", () => {
    expect(isPrivateHost("imobpro.ia.br")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("172.15.0.1")).toBe(false); // logo fora do bloco privado
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("100.63.0.1")).toBe(false); // logo abaixo do CGNAT
    expect(isPrivateHost("app.clicksign.com")).toBe(false);
  });
});
