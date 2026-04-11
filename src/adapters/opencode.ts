import { log } from '../utils/logger.js';
import type { CLIAdapter, ExecOptions, ExecResult, AdapterCapabilities } from './base.js';
import { commandExists, spawnProc, setupAbort, setupTimeout, stripAnsi } from './base.js';

function cleanJsonLines(text: string): string {
  const lines = text.split('\n').filter(Boolean);
  const results: string[] = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r.type === 'text' && r.part?.text) {
        results.push(r.part.text);
      }
    } catch {
      if (!line.startsWith('{')) {
        results.push(line);
      }
    }
  }
  return results.join('\n');
}

export class OpenCodeAdapter implements CLIAdapter {
  readonly name = 'opencode';
  readonly displayName = 'OpenCode';
  readonly command = 'opencode';
  readonly capabilities: AdapterCapabilities = {
    streaming: false,
    jsonOutput: true,
    sessionResume: true,
    modes: ['auto'],
    hasEffort: false,
    hasModel: true,
    hasSearch: false,
    hasBudget: false,
  };

  async isAvailable(): Promise<boolean> { return commandExists(this.command); }

  execute(prompt: string, opts: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      const { settings } = opts;
      const args = ['run', prompt, '--format', 'json'];

      if (settings.model) {
        args.push('-m', settings.model);
      }

      const workDir = settings.workDir || opts.workDir;
      if (workDir) {
        args.push('--dir', workDir);
      }

      const sessionId = settings.sessionIds[this.name];
      if (sessionId) {
        args.push('-s', sessionId);
      }

      if (opts.extraArgs) args.push(...opts.extraArgs);

      log.debug(`[opencode] executing`);

      const proc = spawnProc(this.command, args, {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      setupAbort(proc, opts.signal);
      const timer = setupTimeout(proc, opts.timeout);

      let stdout = '';
      let stderr = '';
      proc.stdout!.on('data', (c: Buffer) => { stdout += c.toString(); });
      proc.stderr!.on('data', (c: Buffer) => { stderr += c.toString(); });

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (opts.signal?.aborted) { resolve({ text: '已取消', error: true }); return; }

        try {
          const lines = stdout.trim().split('\n').filter(Boolean);
          const results: string[] = [];
          let sessionId: string | undefined;

          for (const line of lines) {
            try {
              const r = JSON.parse(line);
              if (r.type === 'text' && r.part?.text) {
                results.push(r.part.text);
              }
              if (r.sessionID && !sessionId) {
                sessionId = r.sessionID;
              }
            } catch { /* skip invalid json lines */ }
          }

          if (results.length > 0) {
            resolve({
              text: results.join('\n'),
              error: code !== 0,
              sessionId,
            });
            return;
          }
        } catch { /* fallthrough */ }

        const rawText = stripAnsi(stdout.trim() || stderr.trim());
        const cleanText = cleanJsonLines(rawText);
        resolve({ text: cleanText || `exit ${code}`, error: code !== 0 });
      });
      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        resolve({ text: `无法启动 OpenCode: ${err.message}`, error: true });
      });
    });
  }
}
