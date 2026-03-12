import { describe, it, expect, afterEach } from "vitest";
import { parseEnvInt } from "../src/utils/env-utils.js";

describe("parseEnvInt", () => {
  const envKey = "TEST_PARSE_INT";

  afterEach(() => {
    delete process.env[envKey];
  });

  it("returns default when env var is not set", () => {
    expect(parseEnvInt(envKey, 42)).toBe(42);
  });

  it("returns default when env var is empty", () => {
    process.env[envKey] = "";
    expect(parseEnvInt(envKey, 42)).toBe(42);
  });

  it("parses valid integer", () => {
    process.env[envKey] = "100";
    expect(parseEnvInt(envKey, 42)).toBe(100);
  });

  it("returns default for NaN values", () => {
    process.env[envKey] = "not-a-number";
    expect(parseEnvInt(envKey, 42)).toBe(42);
  });

  it("returns default when below min", () => {
    process.env[envKey] = "0";
    expect(parseEnvInt(envKey, 42, 1)).toBe(42);
  });

  it("returns default when above max", () => {
    process.env[envKey] = "200";
    expect(parseEnvInt(envKey, 42, 1, 100)).toBe(42);
  });

  it("returns value when within range", () => {
    process.env[envKey] = "50";
    expect(parseEnvInt(envKey, 42, 1, 100)).toBe(50);
  });

  it("returns value at min boundary", () => {
    process.env[envKey] = "1";
    expect(parseEnvInt(envKey, 42, 1, 100)).toBe(1);
  });

  it("returns value at max boundary", () => {
    process.env[envKey] = "100";
    expect(parseEnvInt(envKey, 42, 1, 100)).toBe(100);
  });

  it("handles negative values", () => {
    process.env[envKey] = "-5";
    expect(parseEnvInt(envKey, 42)).toBe(-5);
  });

  it("handles float strings by truncating", () => {
    process.env[envKey] = "3.14";
    expect(parseEnvInt(envKey, 42)).toBe(3);
  });
});
