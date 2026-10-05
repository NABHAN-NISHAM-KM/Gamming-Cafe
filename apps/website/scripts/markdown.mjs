// The small Markdown renderer shared by the help centre and the blog builders.
export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function inline(s, link) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${link(href)}">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

/** Just the Markdown the docs use: headings, paragraphs, lists, tables, fences, quotes, rules. */
export function render(md, link) {
  const out = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
    } else if (/^#{3,6} /.test(l)) {
      out.push(`<h3>${inline(l.replace(/^#+ /, ""), link)}</h3>`);
      i++;
    } else if (/^\|/.test(l)) {
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim(), link)));
      out.push(`<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`);
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      for (; i < lines.length && (/^\s*([-*]|\d+\.) /.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) {
        if (/^\s*([-*]|\d+\.) /.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.) (\[[ x]\] )?/, ""));
        else items[items.length - 1] += " " + lines[i].trim();
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x, link)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
    } else if (/^> /.test(l)) {
      const q = [];
      for (; i < lines.length && /^> ?/.test(lines[i]); i++) q.push(lines[i].replace(/^> ?/, ""));
      out.push(`<blockquote>${inline(q.join(" "), link)}</blockquote>`);
    } else if (/^---+$/.test(l.trim()) || !l.trim()) {
      i++;
    } else {
      const p = [];
      for (; i < lines.length && lines[i].trim() && !/^(#|```|\||>|\s*([-*]|\d+\.) )/.test(lines[i]); i++) p.push(lines[i].trim());
      out.push(`<p>${inline(p.join(" "), link)}</p>`);
    }
  }
  return out.join("\n");
}
