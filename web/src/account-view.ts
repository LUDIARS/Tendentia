import { escapeHtml } from './sanitize.ts';
export interface SessionInfo { loginAvailable: boolean; cernereUrl: string | null; user: { displayName: string | null } | null }
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const owners = new WeakMap<HTMLElement, AbortController>();
async function post<T>(path: string, body: unknown = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const json = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}
export async function loadSession(): Promise<SessionInfo> {
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    const session = await response.json() as SessionInfo;
    // A stale opaque cookie is rejected, but the public login configuration is
    // still sufficient to render the explicit reauthentication action.
    if (response.ok || response.status === 403) return session;
  } catch { /* Offline UI has no personal access; server still enforces every operation. */ }
  return { loginAvailable: false, cernereUrl: null, user: null };
}
function base64url(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function receiveAuthCode(popup: Window, origin: string, state: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const cleanup = (): void => { clearInterval(timer); window.removeEventListener('message', listener); signal.removeEventListener('abort', aborted); };
    const aborted = (): void => { cleanup(); reject(new Error('ログインが中断されました')); };
    const listener = (event: MessageEvent): void => {
      const data = event.data as { type?: unknown; authCode?: unknown; state?: unknown } | null;
      if (event.origin !== origin || event.source !== popup || data?.type !== 'cernere:auth' || data.state !== state ||
        typeof data.authCode !== 'string' || !data.authCode || data.authCode.length > 2048) return;
      cleanup(); resolve(data.authCode);
    };
    const timer = setInterval(() => { if (popup.closed || Date.now() - started > LOGIN_TIMEOUT_MS) aborted(); }, 500);
    window.addEventListener('message', listener);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
async function login(cernereUrl: string, signal: AbortSignal): Promise<void> {
  const popup = window.open('about:blank', `tendentia-login-${crypto.randomUUID()}`, 'width=540,height=740');
  if (!popup) throw new Error('ログイン用のポップアップを許可してください');
  const lifetime = new AbortController();
  const owned = AbortSignal.any([signal, lifetime.signal]);
  const closed = setInterval(() => { if (popup.closed) lifetime.abort(); }, 500);
  const timeout = setTimeout(() => lifetime.abort(), LOGIN_TIMEOUT_MS);
  let pendingNonce: string | undefined;
  let completed = false;
  try {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const { nonce, clientId } = await post<{ nonce: string; clientId: string }>('/api/session/login/start', { challenge, state }, owned);
    pendingNonce = nonce;
    owned.throwIfAborted();
    const url = new URL('/composite/login', cernereUrl);
    url.searchParams.set('origin', location.origin); url.searchParams.set('client_id', clientId);
    url.searchParams.set('code_challenge', challenge); url.searchParams.set('state', state);
    const code = receiveAuthCode(popup, url.origin, state, owned);
    // Observe rejection even when assigning popup.location fails.
    void code.catch(() => {});
    popup.location.href = url.href;
    const authCode = await code;
    clearInterval(closed); // Cr closes its popup after the verified handoff; exchange still owns busy state.
    await post('/api/session/login/complete', { code: authCode, nonce, state, verifier }, owned);
    owned.throwIfAborted();
    completed = true;
  } finally {
    clearInterval(closed); clearTimeout(timeout); lifetime.abort(); popup.close();
    if (!completed && pendingNonce) {
      // Independent bounded cleanup also reaches the server after pagehide/owner abort.
      void fetch('/api/session/login/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: pendingNonce }), keepalive: true, signal: AbortSignal.timeout(10_000) })
        .catch(() => { /* Lost cleanup cannot revive the owner; pending/grant expiry remains bounded. */ });
    }
  }
}
/** Re-render/disconnect/pagehide ends owned resources. @implements SPEC-TD-SCOPED-SESSION */
export function renderAccount(container: HTMLElement, session: SessionInfo, onChange: () => void): void {
  owners.get(container)?.abort();
  const owner = new AbortController(); owners.set(container, owner);
  if (!session.loginAvailable || !session.cernereUrl) { container.innerHTML = ''; return; }
  const cernereUrl = session.cernereUrl;
  container.innerHTML = session.user
    ? `<span class="td-account-name">${escapeHtml(session.user.displayName ?? 'ログイン中')} さん</span><button type="button" class="ghost" id="tdLogout">ログアウト</button><span id="tdAccountStatus" class="muted"></span>`
    : '<button type="button" id="tdLogin">Cernere でログイン</button><span id="tdAccountStatus" class="muted"></span>';
  let busy = false;
  const observer = new MutationObserver(() => { if (!container.isConnected) owner.abort(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const pagehide = (): void => owner.abort();
  window.addEventListener('pagehide', pagehide, { once: true });
  owner.signal.addEventListener('abort', () => { observer.disconnect(); window.removeEventListener('pagehide', pagehide); }, { once: true });
  const act = (button: HTMLButtonElement | null, task: () => Promise<void>): void => {
    button?.addEventListener('click', () => {
      if (busy || owner.signal.aborted) return;
      busy = true; button.disabled = true;
      const status = container.querySelector('#tdAccountStatus');
      if (status) status.textContent = '処理しています…';
      void task().then(() => { if (!owner.signal.aborted) onChange(); }, (error: unknown) => {
        if (status && !owner.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
      }).finally(() => { busy = false; if (!owner.signal.aborted) button.disabled = false; });
    }, { signal: owner.signal });
  };
  act(container.querySelector('#tdLogin'), () => login(cernereUrl, owner.signal));
  act(container.querySelector('#tdLogout'), async () => { await post('/api/session/logout', {}, owner.signal); });
}
