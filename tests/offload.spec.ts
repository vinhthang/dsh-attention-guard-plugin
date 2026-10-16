import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDiagnosticsDir, offloadOutputIfLarge } from '../src/offload.js';

describe('offload module', () => {
  let tempTestDir: string;

  beforeEach(() => {
    tempTestDir = path.join(os.tmpdir(), `dsh-test-diag-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe('getDiagnosticsDir', () => {
    it('uses customDir when provided', () => {
      const custom = path.join(tempTestDir, 'custom-sub');
      const dir = getDiagnosticsDir(custom);
      expect(dir).toBe(custom);
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('uses process.env.DSH_HOME when customDir is omitted', () => {
      const originalDshHome = process.env.DSH_HOME;
      try {
        process.env.DSH_HOME = path.join(tempTestDir, 'dsh-home');
        const dir = getDiagnosticsDir();
        expect(dir).toBe(path.join(tempTestDir, 'dsh-home', 'diagnostics'));
        expect(fs.existsSync(dir)).toBe(true);
      } finally {
        process.env.DSH_HOME = originalDshHome;
      }
    });

    it('falls back to default .dsh/diagnostics or tmpdir when DSH_HOME is unset', () => {
      const originalDshHome = process.env.DSH_HOME;
      try {
        delete process.env.DSH_HOME;
        const dir = getDiagnosticsDir();
        expect(dir).toContain('diagnostics');
        expect(fs.existsSync(dir)).toBe(true);
      } finally {
        process.env.DSH_HOME = originalDshHome;
      }
    });
  });

  describe('offloadOutputIfLarge', () => {
    it('passes through output smaller than maxChars without offloading', () => {
      const smallText = 'Simple short output';
      const result = offloadOutputIfLarge('cargo test', smallText, 2000, tempTestDir);
      expect(result.offloaded).toBe(false);
      expect(result.text).toBe(smallText);
      expect(result.logPath).toBeUndefined();
    });

    it('passes through empty output', () => {
      const result = offloadOutputIfLarge('cargo test', '', 2000, tempTestDir);
      expect(result.offloaded).toBe(false);
      expect(result.text).toBe('');
    });

    it('offloads large output to disk and returns summarized text', () => {
      // Create a 3000-character string
      const prefix = 'A'.repeat(500);
      const middle = 'M'.repeat(2000);
      const suffix = 'Z'.repeat(500);
      const largeOutput = prefix + middle + suffix;

      const result = offloadOutputIfLarge('pytest', largeOutput, 2000, tempTestDir);

      expect(result.offloaded).toBe(true);
      expect(result.logPath).toBeDefined();
      expect(fs.existsSync(result.logPath!)).toBe(true);

      // Verify file content matches original full output
      const savedContent = fs.readFileSync(result.logPath!, 'utf-8');
      expect(savedContent).toBe(largeOutput);

      // Verify summarized text structure
      expect(result.text).toContain(`[Attention Guard: Output (${largeOutput.length} chars) offloaded to ${result.logPath}]`);
      expect(result.text).toContain('... [output offloaded, see ');
      expect(result.text.startsWith(`[Attention Guard: Output (${largeOutput.length} chars) offloaded to ${result.logPath}]\n\n${prefix}`)).toBe(true);
      expect(result.text.endsWith(`${suffix}`)).toBe(true);
    });
  });
});
