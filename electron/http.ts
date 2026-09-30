import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request } from 'node:https';

/*
 * HTTPS client tối giản dùng thay cho fetch.
 *
 * Vì sao không dùng fetch: bản cho Windows 7/8.1 phải chạy trên Electron 22
 * (bản cuối hỗ trợ Win7) = Node 16, chưa có fetch toàn cục và Readable.fromWeb.
 * node:https có mặt ở mọi phiên bản và dùng bộ CA đóng gói sẵn của Node, nên
 * không phụ thuộc kho chứng chỉ gốc (thường đã cũ) của Windows 7.
 *
 * Chỉ đi https; redirect cũng phải là https.
 */

export interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  /** Stream nội dung; người gọi phải đọc hết hoặc destroy(). */
  body: IncomingMessage;
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Tổng thời gian cho cả request lẫn đọc nội dung. */
  timeoutMs: number;
}

const MAX_REDIRECTS = 5;

export function httpRequest(url: string, options: HttpOptions): Promise<HttpResponse> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  return send(new URL(url), options, signal, 0);
}

function send(url: URL, options: HttpOptions, signal: AbortSignal, redirects: number): Promise<HttpResponse> {
  if (url.protocol !== 'https:') return Promise.reject(new Error(`Chỉ cho phép https: ${url.origin}`));
  const body = options.body === undefined ? undefined : Buffer.from(options.body, 'utf8');
  const headers: Record<string, string> = { ...options.headers };
  if (body) headers['Content-Length'] = String(body.length);

  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method ?? 'GET', headers, signal }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('Quá nhiều lần chuyển hướng.'));
        // 303 (và 301/302 sau POST theo thông lệ trình duyệt) -> chuyển thành GET.
        const next = status === 307 || status === 308 ? options : { ...options, method: 'GET' as const, body: undefined };
        resolve(send(new URL(location, url), next, signal, redirects + 1));
        return;
      }
      resolve({ status, headers: res.headers, body: res });
    });
    req.on('error', (err) =>
      reject(signal.aborted ? new Error(`Hết thời gian chờ (${options.timeoutMs / 1000}s) khi kết nối ${url.host}`) : err),
    );
    req.end(body);
  });
}

export async function httpText(url: string, options: HttpOptions): Promise<{ status: number; text: string }> {
  const res = await httpRequest(url, options);
  const chunks: Buffer[] = [];
  for await (const chunk of res.body) chunks.push(chunk as Buffer);
  return { status: res.status, text: Buffer.concat(chunks).toString('utf8') };
}
