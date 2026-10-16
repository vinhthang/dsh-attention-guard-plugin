import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface OffloadResult {
  text: string;
  offloaded: boolean;
  logPath?: string;
}

export function getDiagnosticsDir(customDir?: string): string {
  let targetDir: string;
  if (customDir && customDir.trim() !== '') {
    targetDir = customDir.trim();
  } else if (process.env.DSH_HOME) {
    targetDir = path.join(process.env.DSH_HOME, 'diagnostics');
  } else {
    try {
      targetDir = path.join(os.homedir(), '.dsh', 'diagnostics');
    } catch {
      targetDir = path.join(os.tmpdir(), 'dsh-diagnostics');
    }
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    targetDir = path.join(os.tmpdir(), 'dsh-diagnostics');
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return targetDir;
}

export function offloadOutputIfLarge(
  command: string,
  output: string,
  maxChars: number = 2000,
  customDir?: string
): OffloadResult {
  if (!output || output.length <= maxChars) {
    return { text: output, offloaded: false };
  }

  const dir = getDiagnosticsDir(customDir);
  const filename = `${Date.now()}_test_failure.log`;
  const logPath = path.join(dir, filename);

  fs.writeFileSync(logPath, output, 'utf-8');

  const summarizedText =
    `[Attention Guard: Output (${output.length} chars) offloaded to ${logPath}]\n\n` +
    output.slice(0, 500) +
    `\n\n... [output offloaded, see ${logPath}] ...\n\n` +
    output.slice(-500);

  return {
    text: summarizedText,
    offloaded: true,
    logPath,
  };
}
