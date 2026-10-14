// ビルド済みの画面 (dist/web) を配る。 web 直下の決まったファイルだけを返し、 それ以外は index.html。
// パスはリクエストから組み立てず、 許可した名前の表で引く (パストラバーサルを起こさない)。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'hono';

const FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

export function staticEntry(pathname: string): { file: string; type: string } | null {
  if (pathname.startsWith('/api/')) return null;
  return FILES[pathname] ?? FILES['/'];
}

export function makeStaticHandler(webDir: string) {
  return async (context: Context): Promise<Response> => {
    const entry = staticEntry(new URL(context.req.url).pathname);
    if (!entry) return context.json({ error: 'not found' }, 404);
    try {
      const body = await readFile(join(webDir, entry.file));
      return new Response(body, { headers: { 'Content-Type': entry.type, 'Cache-Control': 'no-cache' } });
    } catch {
      return context.text('画面がビルドされていません (npm run build)', 503);
    }
  };
}
