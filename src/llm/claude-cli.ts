// AI 要約の呼び出し口。 Claude Code CLI (`claude -p`) を子プロセスで 1 回だけ動かし、 標準出力を返す。
// API キーは持たない (CLI のサブスクリプション認証を使う)。 API 課金や親セッションへの紐付けを
// 起こす環境変数は子へ渡さない。

import { spawn } from 'node:child_process';

export interface ClaudeOptions {
  /** CLI の実行ファイル。 既定は PATH の `claude`。 */
  bin?: string;
  /** モデル名またはエイリアス (例: haiku)。 */
  model?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

/** 1 回の呼び出しは 8〜11 秒かかる。 締切を短くすると黙って打ち切られるので余裕を持たせる。 */
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

const BLOCKED_ENV = /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|CLAUDE_CODE_USE_ANTHROPIC_AWS|CLAUDECODE|CONCORDIA_HOOK|LICTOR_.*)$/i;

/** OS・プロキシ設定は残し、 API 課金と親セッションへの紐付けにつながる変数だけを落とす。 */
export function subscriptionEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!BLOCKED_ENV.test(key)) env[key] = value;
  }
  return env;
}

export function claudeArgs(model: string): string[] {
  return ['-p', '--model', model, '--output-format', 'text'];
}

export function runClaude(prompt: string, options: ClaudeOptions = {}): Promise<string> {
  const bin = options.bin ?? process.env.TENDENTIA_CLAUDE_BIN ?? 'claude';
  const model = options.model ?? process.env.TENDENTIA_LLM_MODEL ?? 'haiku';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, claudeArgs(model), {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        env: subscriptionEnvironment(options.env ?? process.env),
      });
    } catch (error: unknown) {
      reject(new Error(`claude CLI を起動できません: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let failure: Error | null = null;
    const timer = setTimeout(() => {
      failure = new Error(`claude CLI が ${timeoutMs}ms 以内に終わりませんでした`);
      child.kill('SIGKILL');
    }, timeoutMs);
    const collect = (chunk: Buffer, isError: boolean): void => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        failure = new Error('claude CLI の出力が上限を超えました');
        child.kill('SIGKILL');
        return;
      }
      if (isError) stderr += chunk.toString('utf8');
      else stdout += chunk.toString('utf8');
    };
    child.stdout?.on('data', (chunk: Buffer) => collect(chunk, false));
    child.stderr?.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stdin?.on('error', (error) => { failure = error; child.kill('SIGKILL'); });
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`claude CLI: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`claude CLI が終了コード ${code} で終わりました: ${stderr.slice(0, 400)}`));
      else resolve(stdout);
    });
    child.stdin?.end(prompt, 'utf8');
  });
}
