#!/usr/bin/env node
// Builds content/index.json and feed.xml from content/posts/*.md (front-matter + small Markdown subset).
// Usage: node tools/build_content.mjs [--check]   (--check fails if generated files are out of date)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'content/posts'), SITE = 'https://aetherion.o-r.kr';
const TYPES = { patch: '패치 노트', blog: '블로그', event: '이벤트', notice: '공지' };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => /^(https?:\/\/|\/)/.test(u.replace(/&amp;/g, '&')) ? `<a href="${u}"${u.startsWith('http') ? ' rel="noopener"' : ''}>${t}</a>` : t);
export function md(src) {
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of src.split('\n')) {
    let m;
    if (!line.trim()) { close(); continue; }
    if ((m = line.match(/^(#{2,4})\s+(.*)/))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)/)) || (m = line.match(/^\s*\d+\.\s+(.*)/))) {
      const t = /^\s*\d+\./.test(line) ? 'ol' : 'ul'; if (list !== t) { close(); out.push(`<${t}>`); list = t; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    close(); out.push(`<p>${inline(line)}</p>`);
  }
  close(); return out.join('\n');
}
export function parse(file, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/); if (!m) throw Error(file + ': missing front-matter');
  const fm = Object.fromEntries(m[1].split('\n').filter(Boolean).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const k of ['type', 'title', 'date', 'summary']) if (!fm[k]) throw Error(`${file}: front-matter "${k}" is required`);
  if (!TYPES[fm.type]) throw Error(`${file}: type must be patch|blog|event|notice`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) throw Error(`${file}: date must be YYYY-MM-DD`);
  if (fm.type === 'patch') { for (const s of ['신규', '개선', '수정', '알려진 문제']) if (!new RegExp('^## ' + s + '\\s*$', 'm').test(m[2])) throw Error(`${file}: patch note needs "## ${s}" section`); if (!/AETHERION 팀/.test(m[2])) throw Error(`${file}: patch note must be signed "AETHERION 팀"`); }
  const slug = file.replace(/\.md$/, '');
  return { slug, type: fm.type, type_label: TYPES[fm.type], title: fm.title, date: fm.date, version: fm.version || null, pinned: fm.pinned === 'true', summary: fm.summary, url: `/news/post/?p=${slug}`, html: md(m[2].trim()) };
}
const vnum = p => +(p.version || 'v0').replace(/\D/g, '') || 0;
function build() {
  const posts = readdirSync(DIR).filter(f => f.endsWith('.md')).map(f => parse(f, readFileSync(join(DIR, f), 'utf8')))
    
    .sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date) || vnum(b) - vnum(a) || a.type.localeCompare(b.type) || b.slug.localeCompare(a.slug));
  const index = JSON.stringify({ generated_from: 'content/posts', count: posts.length, posts }, null, 1) + '\n';
  const rfc = d => new Date(d + 'T09:00:00+09:00').toUTCString();
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>AETHERION 소식</title><link>${SITE}/news/</link><description>AETHERION 패치 노트, 블로그, 이벤트</description><language>ko</language>
${posts.map(p => `<item><title>${esc(`[${p.type_label}] ${p.title}`)}</title><link>${SITE}${esc(p.url)}</link><guid isPermaLink="false">aetherion-${p.slug}</guid><pubDate>${rfc(p.date)}</pubDate><description>${esc(p.summary)}</description></item>`).join('\n')}
</channel></rss>
`;
  return { index, feed, posts };
}
const { index, feed, posts } = build();
const files = [[join(ROOT, 'content/index.json'), index], [join(ROOT, 'feed.xml'), feed]];
if (process.argv.includes('--check')) {
  const stale = files.filter(([p, c]) => !existsSync(p) || readFileSync(p, 'utf8') !== c);
  if (stale.length) { console.error('Generated content is out of date. Run: node tools/build_content.mjs'); process.exit(1); }
  console.log(`PASS content up to date (${posts.length} posts)`);
} else { for (const [p, c] of files) writeFileSync(p, c); console.log(`built ${posts.length} posts -> content/index.json, feed.xml`); }
