import { log } from '../utils/logger.js';
import type { CLIAdapter, ExecOptions, ExecResult, AdapterCapabilities } from './base.js';
import { commandExists, spawnProc, setupAbort, setupTimeout, stripAnsi } from './base.js';
import { randomUUID } from 'node:crypto';

function extractOpenClawContent(text: string): string {
  const lines = text.split('\n');
  const contentLines: string[] = [];
  let inContent = false;

  for (const line of lines) {
    const stripped = stripAnsi(line);
    const l = stripped.trim();

    // Skip plugin/logs
    if (l.startsWith('[plugins]')) continue;
    if (l.startsWith('[mnemo]')) continue;
    if (l.startsWith('[agent/')) continue;
    if (l.startsWith('[tools]')) continue;
    if (l.startsWith('[diagnostic]')) continue;
    if (l.startsWith('[compaction-')) continue;
    if (l.startsWith('Config warnings:')) continue;
    if (l.startsWith('- plugins.')) continue;
    if (l.startsWith('Registered')) continue;
    if (l.startsWith('Server mode')) continue;
    if (l.startsWith('low context window')) continue;
    if (l.startsWith('tools.profile')) continue;
    if (l.startsWith('Auto-provisioned')) continue;
    if (l.startsWith('Claim your')) continue;
    if (l.startsWith('Compaction safeguard')) continue;
    if (l.startsWith('Compaction detected')) continue;
    if (l.startsWith('Ingest accepted')) continue;
    if (l.includes('FailoverError')) continue;
    if (l.includes('session file locked')) continue;
    if (!l) continue;

    // This looks like content
    inContent = true;
    contentLines.push(stripped);
  }

  return contentLines.join('\n').trim();
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

      // Support for agent selection
      const openClawSettings = settings as any;
      if (openClawSettings.currentOpenClawAgent) {
        args.push('--agent', openClawSettings.currentOpenClawAgent);
      }

      if (settings.model) {
        args.push('--model', settings.model);
      }

      const sessionId = settings.sessionIds[this.name];
      if (sessionId) {
        args.push('--session-id', sessionId);
      } else {
        // Generate unique session to avoid lock conflicts
        args.push('--session-id', `wx-${randomUUID().slice(0, 8)}`);
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

        // Try JSON first
        const jsonLines = stdoutText.split('\n').filter(l => l.trim().startsWith('{'));
        for (const line of jsonLines) {
          try {
            const r = JSON.parse(line);
            if (r.text || r.result || r.response || r.message || r.content) {
              const content = r.text || r.result || r.response || r.message || r.content;
              resolve({
                text: typeof content === 'string' ? content : JSON.stringify(content),
                error: !!r.error || code !== 0,
                sessionId: r.sessionId || r.session_id,
              });
              return;
            }
          } catch { continue; }
        }

        // Extract content from logs
        const content = extractOpenClawContent(stdoutText || stderrText);
        const sessionMatch = stdoutText.match(/sessionID[":\s]+([a-f0-9-]{8,})/i) ||
                             stdoutText.match(/session[-_]?id[":\s]+([a-f0-9-]{8,})/i);

        resolve({
          text: content || `完成`,
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
