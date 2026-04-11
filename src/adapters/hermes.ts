import { log } from '../utils/logger.js';
import type { CLIAdapter, ExecOptions, ExecResult, AdapterCapabilities } from './base.js';
import { commandExists, spawnProc, setupAbort, setupTimeout, stripAnsi } from './base.js';

export class HermesAdapter implements CLIAdapter {
  readonly name = 'hermes';
  readonly displayName = 'Hermes';
  readonly command = 'hermes';
  readonly capabilities: AdapterCapabilities = {
    streaming: false,
    jsonOutput: false,
    sessionResume: true,
    modes: ['auto', 'safe'],
    hasEffort: false,
    hasModel: true,
    hasSearch: false,
    hasBudget: false,
  };

  async isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  execute(prompt: string, opts: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      const { settings } = opts;
      const args = ['chat', '-q', prompt, '-Q'];

      if (settings.mode === 'auto') {
        args.push('--yolo');
      }

      if (settings.model) {
        args.push('-m', settings.model);
      }

      const workDir = settings.workDir || opts.workDir;

      const sessionId = settings.sessionIds[this.name];
      if (sessionId) {
        args.push('--resume', sessionId);
      }

      if (opts.extraArgs) args.push(...opts.extraArgs);

      log.debug(`[hermes] executing`);

      const proc = spawnProc(this.command, args, {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      setupAbort(proc, opts.signal);
      const timer = setupTimeout(proc, opts.timeout);

      let stdout = '';
      let stderr = '';
      proc.stdout!.on('data', (c: Buffer) => {
        stdout += c.toString();
      });
      proc.stderr!.on('data', (c: Buffer) => {
        stderr += c.toString();
      });

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (opts.signal?.aborted) {
          resolve({ text: '已取消', error: true });
          return;
        }

        const text = stripAnsi(stdout.trim() || stderr.trim());
        const sessionMatch = text.match(/session[:\s]+([a-f0-9-]{20,})/i);

        resolve({
          text: text || `exit ${code}`,
          error: code !== 0,
          sessionId: sessionMatch ? sessionMatch[1] : undefined,
        });
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        resolve({ text: `无法启动 Hermes: ${err.message}`, error: true });
      });
    });
  }
}
