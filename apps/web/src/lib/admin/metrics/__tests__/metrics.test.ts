import { describe, it, expect } from "vitest";
import { parseRange, InvalidRangeError } from "../range";
import {
  countByOrg,
  sumByOrg,
  countRowsByOrg,
  bucketByDay,
  sumField,
  countByKey,
} from "../aggregate";

describe("parseRange", () => {
  const now = new Date("2026-06-16T12:00:00.000Z");

  it("defaults to last 30 days", () => {
    const { from, to } = parseRange({}, now);
    expect(to.toISOString()).toBe(now.toISOString());
    expect(to.getTime() - from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("honors explicit from/to", () => {
    const { from, to } = parseRange({ from: "2026-01-01", to: "2026-02-01" }, now);
    expect(from.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(to.toISOString().slice(0, 10)).toBe("2026-02-01");
  });

  it("throws on invalid date", () => {
    expect(() => parseRange({ from: "not-a-date" }, now)).toThrow(InvalidRangeError);
  });
});

describe("countByOrg", () => {
  it("sums _count._all per orgId, skipping null orgId", () => {
    const m = countByOrg([
      { orgId: "a", _count: { _all: 3 } },
      { orgId: "a", _count: { _all: 2 } },
      { orgId: "b", _count: { _all: 5 } },
      { orgId: null, _count: { _all: 9 } },
    ]);
    expect(m.get("a")).toBe(5);
    expect(m.get("b")).toBe(5);
    expect(m.has("")).toBe(false);
  });

  it("accepts numeric _count", () => {
    const m = countByOrg([{ orgId: "a", _count: 4 }]);
    expect(m.get("a")).toBe(4);
  });
});

describe("sumByOrg", () => {
  it("sums a Decimal/number field per orgId", () => {
    const m = sumByOrg(
      [
        { orgId: "a", _sum: { costCents: 100 } },
        { orgId: "a", _sum: { costCents: 250 } },
        { orgId: "b", _sum: { costCents: null } },
      ],
      "costCents"
    );
    expect(m.get("a")).toBe(350);
    expect(m.get("b")).toBe(0);
  });

  it("coerces Decimal-like (toString) values", () => {
    const m = sumByOrg(
      [{ orgId: "a", _sum: { estimatedCostUsd: { toString: () => "1.5" } } }],
      "estimatedCostUsd"
    );
    expect(m.get("a")).toBeCloseTo(1.5);
  });
});

describe("countRowsByOrg", () => {
  it("counts joined rows by resolved orgId", () => {
    const rows = [
      { pipeline: { orgId: "a" } },
      { pipeline: { orgId: "a" } },
      { pipeline: { orgId: "b" } },
      { pipeline: { orgId: null } },
    ];
    const m = countRowsByOrg(rows, (r) => r.pipeline.orgId);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
  });
});

describe("bucketByDay", () => {
  it("buckets by UTC day, sorted ascending", () => {
    const rows = [
      { createdAt: new Date("2026-06-02T10:00:00Z"), v: 5 },
      { createdAt: new Date("2026-06-01T23:00:00Z"), v: 2 },
      { createdAt: new Date("2026-06-02T01:00:00Z"), v: 3 },
    ];
    const buckets = bucketByDay(
      rows,
      (r) => r.createdAt,
      (r) => r.v
    );
    expect(buckets).toEqual([
      { date: "2026-06-01", value: 2, count: 1 },
      { date: "2026-06-02", value: 8, count: 2 },
    ]);
  });
});

describe("sumField", () => {
  it("sums numeric values, ignoring nulls/NaN", () => {
    const total = sumField(
      [{ b: 100 }, { b: null }, { b: 250 }],
      (r) => r.b
    );
    expect(total).toBe(350);
  });
});

describe("countByKey", () => {
  it("counts a categorical groupBy field", () => {
    const out = countByKey(
      [
        { status: "PENDING", _count: { _all: 2 } },
        { status: "RECEIVED", _count: { _all: 5 } },
        { status: null, _count: { _all: 1 } },
      ],
      "status"
    );
    expect(out).toEqual({ PENDING: 2, RECEIVED: 5, "—": 1 });
  });
});
