// ログインの部品。 Cernere の埋め込みログイン (popup) で authCode を受け取り、 サーバで確かめて td_session を受け取る。
// 手順は spec/feature/personal-login.md#ログインの流れ (Aedilis と同じ形)。

import { escapeHtml } from './sanitize.ts';

export interface SessionInfo {
  loginAvailable: boolean;
  cernereUrl: string | null;
  user: { displayName: string | null } | null;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

export async function loadSession(): Promise<SessionInfo> {
  try {
    const response = await fetch('/api/session');
    if (!response.ok) return { loginAvailable: false, cernereUrl: null, user: null };
    return await response.json() as SessionInfo;
  } catch {
    return { loginAvailable: false, cernereUrl: null, user: null };
  }
}

/** popup から Cernere の authCode を受け取る。 送信元の Origin と popup が一致するものだけ受ける。 */
function receiveAuthCode(popup: Window, origin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const cleanup = (): void => {
      clearInterval(timer);
      window.removeEventListener('message', listener);
    };
    const listener = (event: MessageEvent): void => {
      const data = event.data as { type?: unknown; authCode?: unknown } | null;
      if (event.origin !== origin || event.source !== popup || data?.type !== 'cernere:auth' || typeof data.authCode !== 'string') return;
      cleanup();
      resolve(data.authCode);
    };
    const timer = setInterval(() => {
      if (popup.closed || Date.now() - started > LOGIN_TIMEOUT_MS) {
        cleanup();
        reject(new Error('ログインが中断されました'));
      }
    }, 1000);
    window.addEventListener('message', listener);
  });
}

async function login(cernereUrl: string): Promise<void> {
  // popup はクリックの直後に開く (後から開くとブラウザに止められる)。
  const popup = window.open('about:blank', `tendentia-login-${crypto.randomUUID()}`, 'width=540,height=740');
  if (!popup) throw new Error('ログイン用のポップアップを許可してください');
  try {
    const { nonce } = await post<{ nonce: string }>('/api/session/login/start');
    const url = new URL('/composite/login', cernereUrl);
    url.searchParams.set('origin', location.origin);
    const code = receiveAuthCode(popup, url.origin);
    popup.location.href = url.href;
    await post('/api/session/login/complete', { code: await code, nonce });
  } finally {
    popup.close();
  }
}

/** ヘッダにログイン / ログアウトを出す。 状態が変わったら onChange (画面の読み直し) を呼ぶ。 */
export function renderAccount(container: HTMLElement, session: SessionInfo, onChange: () => void): void {
  if (!session.loginAvailable || !session.cernereUrl) {
    container.innerHTML = '';
    return;
  }
  const cernereUrl = session.cernereUrl;
  container.innerHTML = session.user
    ? `<span class="td-account-name">${escapeHtml(session.user.displayName ?? 'ログイン中')} さん</span><button type="button" class="ghost" id="tdLogout">ログアウト</button><span id="tdAccountStatus" class="muted"></span>`
    : `<button type="button" id="tdLogin" title="ログインすると、 開いた記事と興味からあなた向けにマップが変わり、 好みの傾向も見られます">Cernere でログイン</button><span id="tdAccountStatus" class="muted"></span>`;
  const status = (text: string): void => {
    const element = document.getElementById('tdAccountStatus');
    if (element) element.textContent = text;
  };
  document.getElementById('tdLogin')?.addEventListener('click', () => {
    status('ログインしています…');
    login(cernereUrl).then(onChange, (error: unknown) => status(error instanceof Error ? error.message : String(error)));
  });
  document.getElementById('tdLogout')?.addEventListener('click', () => {
    post('/api/session/logout').then(onChange, (error: unknown) => status(error instanceof Error ? error.message : String(error)));
  });
}
