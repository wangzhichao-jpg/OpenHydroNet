const token =
  new URLSearchParams(location.hash.slice(1)).get('token') ||
  sessionStorage.getItem('ohn-session') ||
  '';
if (token) sessionStorage.setItem('ohn-session', token);
export async function api(path: string, data?: any, method?: string) {
  const r = await fetch('/api/' + path, {
    method: method || (data ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!r.ok) {
    let err;
    try {
      err = (await r.json()).error;
    } catch {}
    throw new Error(err || `请求失败 ${r.status}`);
  }
  if (r.headers.get('content-type')?.startsWith('application/json')) return r.json();
  return r.text();
}
declare global {
  interface Window {
    desktop?: {
      open: () => Promise<any>;
      save: (data: any) => Promise<any>;
      draft: (data?: any) => Promise<any>;
      export: (data: { name: string; content: string; kind: string }) => Promise<any>;
      version: () => Promise<any>;
    };
  }
}
export async function download(name: string, content: string, kind = 'json') {
  if (window.desktop) return window.desktop.export({ name, content, kind });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([content], {
      type:
        kind === 'csv'
          ? 'text/csv;charset=utf-8'
          : kind === 'svg'
            ? 'image/svg+xml'
            : 'application/json;charset=utf-8',
    }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
