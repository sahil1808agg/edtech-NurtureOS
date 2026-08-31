import { describe, it, expect, vi, afterEach } from "vitest";
import { runExtract, type ExtractOutput } from "./extract.js";
import { callModel } from "../llm/client.js";
import type { CallMeta, StageResult } from "./types.js";

vi.mock("../llm/client.js", () => ({
  callModel: vi.fn(),
}));

const META: CallMeta = {
  promptVersion: "extract:1",
  modelDeployment: "gemini-3.5-flash-lite",
  latencyMs: 100,
  inputTokens: 10,
  outputTokens: 10,
};

function cell(overrides: Partial<ExtractOutput["cells"][number]> = {}): ExtractOutput["cells"][number] {
  return {
    rawLabel: "test standard",
    section: "Number",
    subject: "Mathematics",
    values: [{ termIndex: 1, rawValue: "P" }],
    sourceRef: { page: 1, table: 1, row: 1, cell: 1 },
    confidence: 0.95,
    ...overrides,
  };
}

function output(overrides: Partial<ExtractOutput> = {}): ExtractOutput {
  return {
    cells: [cell()],
    narratives: [],
    scaleHint: "IB_OPCE",
    senIndicators: [],
    ...overrides,
  };
}

function mockOk(value: ExtractOutput) {
  vi.mocked(callModel).mockResolvedValue({ ok: true, value, meta: META } as StageResult<ExtractOutput>);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(callModel).mockReset();
});

describe("runExtract", () => {
  it("passes through a clean result", async () => {
    mockOk(output());
    const result = await runExtract({ reportId: "r1", pdfBuffer: Buffer.from("pdf") });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cells).toHaveLength(1);
      expect(result.value.scaleHint).toBe("IB_OPCE");
    }
  });

  it("calls callModel with the extract stage key", async () => {
    mockOk(output());
    await runExtract({ reportId: "r1", pdfBuffer: Buffer.from("pdf") });
    expect(callModel).toHaveBeenCalledWith("extract", expect.anything(), expect.anything());
  });

  it("declines when the model reports a SEN indicator", async () => {
    mockOk(output({ senIndicators: ["struggles to sit still"] }));
    const result = await runExtract({ reportId: "r1", pdfBuffer: Buffer.from("pdf") });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SEN_DETECTED");
      expect(result.error).toMatchObject({ indicators: ["struggles to sit still"] });
    }
  });

  it("rejects a cell below the confidence threshold", async () => {
    mockOk(output({ cells: [cell({ rawLabel: "shaky one", confidence: 0.5 })] }));
    const result = await runExtract({ reportId: "r1", pdfBuffer: Buffer.from("pdf") });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LOW_CONFIDENCE");
      expect(result.error).toMatchObject({ field: "shaky one", confidence: 0.5 });
    }
  });

  it("honours a custom confidence threshold from the environment", async () => {
    vi.stubEnv("EXTRACTION_CONFIDENCE_THRESHOLD", "0.4");
    mockOk(output({ cells: [cell({ confidence: 0.5 })] }));
    const result = await runExtract({ reportId: "r1", pdfBuffer: Buffer.from("pdf") });
    expect(result.ok).toBe(true);
  });

  it("passes through a provider error unchanged", async () => {
    vi.mocked(callModel).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_ERROR", status: 500, retryable: true },
    } as StageResult<ExtractOutput>);
    const result = await runExtract({ reportId: "r1", pdfBuffer: Buffer.from("pdf") });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: "PROVIDER_ERROR", status: 500, retryable: true });
    }
  });

  it("never invents a value for a dash or blank cell", async () => {
    mockOk(output({ cells: [cell({ values: [{ termIndex: 1, rawValue: null }] })] }));
    const result = await runExtract({ reportId: "r1", pdfBuffer: Buffer.from("pdf") });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cells[0].values[0].rawValue).toBeNull();
    }
  });
});
