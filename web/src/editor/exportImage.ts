import type { StrategyDoc } from '@backupviiz/shared';
import { MEDIA_META } from './panels';

const W = 190;
const H = 76;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildSvg(doc: StrategyDoc, title: string): { svg: string; width: number; height: number } {
  const pad = 40;
  const xs = doc.nodes.map((n) => n.position.x);
  const ys = doc.nodes.map((n) => n.position.y);
  const minX = Math.min(0, ...xs) - pad;
  const minY = Math.min(0, ...ys) - pad - 30;
  const width = Math.max(320, Math.max(0, ...xs) + W + pad - minX);
  const height = Math.max(200, Math.max(0, ...ys) + H + pad - minY);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,Segoe UI,Arial,sans-serif">`,
    `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#566070"/></marker></defs>`,
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${minX + 16}" y="${minY + 28}" font-size="18" font-weight="700" fill="#14181f">${esc(title)}</text>`,
  ];
  for (const e of doc.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const x1 = a.position.x + W,
      y1 = a.position.y + H / 2,
      x2 = b.position.x,
      y2 = b.position.y + H / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    parts.push(`<path d="M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}" fill="none" stroke="#566070" stroke-width="2" marker-end="url(#a)"/>`);
    const label = [e.method, e.schedule].filter(Boolean).join(' · ');
    if (label) parts.push(`<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" font-size="11" text-anchor="middle" fill="#566070">${esc(label)}</text>`);
  }
  for (const n of doc.nodes) {
    const { x, y } = n.position;
    const stroke = n.kind === 'source' ? '#2557d6' : '#566070';
    parts.push(
      `<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="10" fill="#f5f6f8" stroke="${stroke}" stroke-width="2"/>`,
      `<text x="${x + 12}" y="${y + 26}" font-size="14" font-weight="600" fill="#14181f">${esc(n.label.slice(0, 24))}</text>`,
      `<text x="${x + 12}" y="${y + 46}" font-size="11" fill="#566070">${esc(MEDIA_META[n.mediaType].label)} · ${n.location === 'offsite' ? 'hors site' : 'sur site'}</text>`,
      `<text x="${x + 12}" y="${y + 64}" font-size="10" fill="#566070">${n.kind === 'source' ? 'SOURCE' : 'SUPPORT'}${n.immutable ? ' · IMMUABLE' : ''}</text>`,
    );
  }
  parts.push('</svg>');
  return { svg: parts.join(''), width, height };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'strategie';

export function exportSvg(doc: StrategyDoc, name: string) {
  download(new Blob([buildSvg(doc, name).svg], { type: 'image/svg+xml' }), `${safeName(name)}.svg`);
}

export async function exportPng(doc: StrategyDoc, name: string) {
  const { svg, width, height } = buildSvg(doc, name);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Export impossible'));
    img.src = url;
  });
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = width * scale;
  c.height = height * scale;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (blob) download(blob, `${safeName(name)}.png`);
}
