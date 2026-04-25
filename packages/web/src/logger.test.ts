/**
 * Logger shim — level filtering + setter behaviour.
 *
 * Tiny suite. The shim is ~30 lines of code; what matters is that
 * `setLogLevel` actually gates each method, that the default is
 * `debug` (preserving today's trace volume), and that `silent`
 * suppresses every level including `error`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLogLevel, type LogLevel, logger, setLogLevel } from "./logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalLevel: LogLevel;

  beforeEach(() => {
    originalLevel = getLogLevel();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setLogLevel(originalLevel);
    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("defaults to debug so every level routes through console", () => {
    expect(getLogLevel()).toBe("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("warn level drops debug + info but keeps warn + error", () => {
    setLogLevel("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("silent drops every level including error", () => {
    setLogLevel("silent");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("forwards every argument verbatim", () => {
    setLogLevel("debug");
    const obj = { a: 1 };
    logger.debug("ctx", 42, obj);
    expect(logSpy).toHaveBeenCalledWith("ctx", 42, obj);
  });
});
