import { log } from '../utils/logger.js';
import type { CLIAdapter, ExecOptions, ExecResult, AdapterCapabilities } from './base.js';
import { commandExists, spawnProc, setupAbort, setupTimeout, stripAnsi } from './base.js';

function cleanOpenClawOutput(text: string): string {
  const lines = text.split('\n');
  const filtered = lines.filter(line => {
    const l = line.trim();
    if (!l) return false;
    if (l.startsWith('[plugins]')) return false;
    if (l.startsWith('[mnemo]')) return false;
    if (l.startsWith('Config warnings:')) return false;
    if (l.startsWith('- plugins.')) return false;
    if (l.startsWith('Registered')) return false;
    if (l.startsWith('Server mode')) return false;
    return true;
  });
  return filtered.join('\n').trim();
}

export class OpenClawAdapter implements CLIAdapter {
  readonly name = 'openclaw';
  readonly displayName = 'OpenClaw';
  readonly command = 'openclaw';
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

  async isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  execute(prompt: string, opts: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      const { settings } = opts;
      const args = ['agent', '--message', prompt, '--local'];

      if (settings.model) {
        args.push('--model', settings.model);
      }

      const sessionId = settings.sessionIds[this.name];
      if (sessionId) {
        args.push('--session-id', sessionId);
      } else {
        args.push('--agent', 'main');
      }

      if (opts.extraArgs) args.push(...opts.extraArgs);

      log.debug(`[openclaw] executing`);

      const proc = spawnProc(this.command, args, {
        cwd: settings.workDir || opts.workDir,
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
        if (opts.signal?.aborted) {
          resolve({ text: '已取消', error: true });
          return;
        }

        const stdoutText = stripAnsi(stdout.trim());
        const stderrText = stripAnsi(stderr.trim());

        try {
          const r = JSON.parse(stdoutText);
          const content = r.result || r.response || r.message || r.content;
          resolve({
            text: typeof content === 'string' ? content : cleanOpenClawOutput(stdoutText || stderrText),
            error: !!r.error || code !== 0,
            sessionId: r.sessionId || r.session_id,
          });
          return;
        } catch { /* not JSON */ }

        const cleanText = cleanOpenClawOutput(stdoutText || stderrText);
        const sessionMatch = cleanText.match(/session[:\s]+([a-f0-9-]{8,})/i);
        resolve({
          text: cleanText || `完成`,
          error: code !== 0,
          sessionId: sessionMatch ? sessionMatch[1] : undefined,
        });
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        resolve({ text: `无法启动 OpenClaw: ${err.message}`, error: true });
      });
    });
  }
}
