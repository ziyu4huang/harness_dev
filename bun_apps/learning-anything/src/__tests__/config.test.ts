/**
 * Tests for the config module — model resolution, env vars, constants.
 */
import { describe, test, expect } from "bun:test";
import {
  MODELS,
  resolveModelId,
  isProModel,
  isFlashModel,
  MODEL_PARAMS,
  getModelParams,
  getEnv,
  LIMITS,
  SYSTEM_PROMPTS,
} from "../config.js";

// ─── MODELS constant ──────────────────────────────────────────────────────────

describe("MODELS", () => {
  test("has pro and flash keys", () => {
    expect(MODELS.pro).toBeDefined();
    expect(MODELS.flash).toBeDefined();
  });

  test("pro and flash are distinct strings", () => {
    expect(typeof MODELS.pro).toBe("string");
    expect(typeof MODELS.flash).toBe("string");
    expect(MODELS.pro).not.toBe(MODELS.flash);
  });
});

// ─── resolveModelId ───────────────────────────────────────────────────────────

describe("resolveModelId", () => {
  test("resolves 'pro' to the pro model id", () => {
    expect(resolveModelId("pro")).toBe(MODELS.pro);
  });

  test("resolves 'flash' to the flash model id", () => {
    expect(resolveModelId("flash")).toBe(MODELS.flash);
  });

  test("falls back to flash for unknown keys", () => {
    expect(resolveModelId("unknown")).toBe(MODELS.flash);
    expect(resolveModelId("")).toBe(MODELS.flash);
    expect(resolveModelId("gpt-4")).toBe(MODELS.flash);
  });
});

// ─── isProModel / isFlashModel ────────────────────────────────────────────────

describe("isProModel", () => {
  test("returns true for pro", () => {
    expect(isProModel("pro")).toBe(true);
  });

  test("returns false for flash", () => {
    expect(isProModel("flash")).toBe(false);
  });

  test("returns false for unknown", () => {
    expect(isProModel("unknown")).toBe(false);
  });
});

describe("isFlashModel", () => {
  test("returns true for flash", () => {
    expect(isFlashModel("flash")).toBe(true);
  });

  test("returns false for pro", () => {
    expect(isFlashModel("pro")).toBe(false);
  });

  test("returns true for unknown (fallback is flash)", () => {
    expect(isFlashModel("unknown")).toBe(true);
  });
});

// ─── MODEL_PARAMS ─────────────────────────────────────────────────────────────

describe("MODEL_PARAMS", () => {
  test("has params for pro and flash", () => {
    expect(MODEL_PARAMS.pro).toBeDefined();
    expect(MODEL_PARAMS.flash).toBeDefined();
  });

  test("pro has higher maxTokens than flash", () => {
    expect(MODEL_PARAMS.pro.maxTokens).toBeGreaterThan(MODEL_PARAMS.flash.maxTokens);
  });

  test("each tier has temperature, maxTokens, topP", () => {
    for (const key of ["pro", "flash"] as const) {
      expect(typeof MODEL_PARAMS[key].temperature).toBe("number");
      expect(typeof MODEL_PARAMS[key].maxTokens).toBe("number");
      expect(typeof MODEL_PARAMS[key].topP).toBe("number");
    }
  });
});

describe("getModelParams", () => {
  test("returns pro params for pro key", () => {
    expect(getModelParams("pro")).toBe(MODEL_PARAMS.pro);
  });

  test("returns flash params for flash key", () => {
    expect(getModelParams("flash")).toBe(MODEL_PARAMS.flash);
  });

  test("falls back to flash for unknown key", () => {
    expect(getModelParams("unknown")).toBe(MODEL_PARAMS.flash);
  });
});

// ─── getEnv ───────────────────────────────────────────────────────────────────

describe("getEnv", () => {
  test("returns all expected fields", () => {
    const env = getEnv();
    expect(env).toHaveProperty("apiKey");
    expect(env).toHaveProperty("baseUrl");
    expect(env).toHaveProperty("port");
    expect(env).toHaveProperty("host");
    expect(env).toHaveProperty("graphPath");
    expect(env).toHaveProperty("dashboardUrl");
    expect(env).toHaveProperty("logLevel");
    expect(env).toHaveProperty("rateLimitMax");
    expect(env).toHaveProperty("rateLimitWindowMs");
  });

  test("port is a number", () => {
    const env = getEnv();
    expect(typeof env.port).toBe("number");
    expect(env.port).toBeGreaterThan(0);
  });

  test("baseUrl is a non-empty string", () => {
    const env = getEnv();
    expect(typeof env.baseUrl).toBe("string");
    expect(env.baseUrl.length).toBeGreaterThan(0);
  });
});

// ─── LIMITS ───────────────────────────────────────────────────────────────────

describe("LIMITS", () => {
  test("has all expected limit constants", () => {
    expect(typeof LIMITS.maxGraphSizeMB).toBe("number");
    expect(typeof LIMITS.maxQueryResults).toBe("number");
    expect(typeof LIMITS.maxAgentSteps).toBe("number");
    expect(typeof LIMITS.agentTimeoutMs).toBe("number");
    expect(typeof LIMITS.requestTimeoutMs).toBe("number");
    expect(typeof LIMITS.maxContextNodes).toBe("number");
    expect(typeof LIMITS.maxBodySizeBytes).toBe("number");
  });

  test("values are reasonable positive numbers", () => {
    expect(LIMITS.maxGraphSizeMB).toBeGreaterThan(0);
    expect(LIMITS.maxQueryResults).toBeGreaterThan(0);
    expect(LIMITS.maxAgentSteps).toBeGreaterThan(0);
    expect(LIMITS.agentTimeoutMs).toBeGreaterThan(0);
    expect(LIMITS.requestTimeoutMs).toBeGreaterThan(0);
    expect(LIMITS.maxContextNodes).toBeGreaterThan(0);
    expect(LIMITS.maxBodySizeBytes).toBeGreaterThan(0);
  });

  test("agentTimeoutMs is greater than requestTimeoutMs", () => {
    expect(LIMITS.agentTimeoutMs).toBeGreaterThan(LIMITS.requestTimeoutMs);
  });
});

// ─── SYSTEM_PROMPTS ───────────────────────────────────────────────────────────

describe("SYSTEM_PROMPTS", () => {
  test("has all expected prompt keys", () => {
    const keys = Object.keys(SYSTEM_PROMPTS);
    expect(keys).toContain("graphAnalyst");
    expect(keys).toContain("rootCauseAnalyst");
    expect(keys).toContain("codeReviewer");
    expect(keys).toContain("workflowDesigner");
    expect(keys).toContain("explainAnalyst");
    expect(keys).toContain("diffAnalyst");
    expect(keys).toContain("onboardingGuide");
    expect(keys).toContain("fileAnalyst");
    expect(keys).toContain("projectSummarizer");
  });

  test("each prompt is a non-empty string", () => {
    for (const [key, prompt] of Object.entries(SYSTEM_PROMPTS)) {
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(10);
    }
  });
});
