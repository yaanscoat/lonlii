// turns the AI's markdown into page elements. it builds the elements itself and never uses innerHTML,
// so nothing the AI writes can run as code on the page. supports what chat answers actually use:
// headings, paragraphs, lists, quotes, code blocks, tables, rules, **bold**, *italic*, ~~strike~~,
// `code` and [links](https://...).
window.renderMarkdown = (() => {
  const h = (tag, className, children = []) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);
    return node;
  };

  /* ---------- inline: bold, italic, code, links ---------- */

  const INLINE = [
    { re: /`([^`]+)`/, make: (m) => h("code", "", [m[1]]) },
    { re: /\*\*(.+?)\*\*|__(.+?)__/, make: (m) => h("strong", "", inline(m[1] ?? m[2])) },
    { re: /~~(.+?)~~/, make: (m) => h("del", "", inline(m[1])) },
    { re: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/, make: (m) => link(m[2], inline(m[1])) },
    { re: /(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?!\w)/, make: (m) => h("em", "", inline(m[1] ?? m[2])) },
    { re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/, make: (m) => link(m[0], [m[0]]) },
  ];

  function link(href, children) {
    const a = h("a", "", children);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  // finds whichever pattern starts first, renders it, and carries on with the rest of the text
  function inline(text) {
    const out = [];
    while (text) {
      let best = null;
      for (const rule of INLINE) {
        const m = rule.re.exec(text);
        if (m && (!best || m.index < best.m.index)) best = { m, rule };
      }
      if (!best) {
        out.push(text);
        break;
      }
      if (best.m.index) out.push(text.slice(0, best.m.index));
      out.push(best.rule.make(best.m));
      text = text.slice(best.m.index + best.m[0].length);
    }
    return out;
  }

  /* ---------- blocks ---------- */

  function codeBlock(lang, code) {
    const copy = h("button", "code-copy", ["Copy"]);
    copy.type = "button";
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy"), 1500);
      });
    });
    return h("div", "code-block", [h("div", "code-head", [h("span", "", [lang || "code"]), copy]), h("pre", "", [h("code", "", [code])])]);
  }

  const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  function table(rows) {
    const [head, , ...body] = rows;
    const thead = h("thead", "", [h("tr", "", cells(head).map((c) => h("th", "", inline(c))))]);
    const tbody = h("tbody", "", body.map((r) => h("tr", "", cells(r).map((c) => h("td", "", inline(c))))));
    return h("div", "table-wrap", [h("table", "", [thead, tbody])]);
  }

  function list(lines, ordered) {
    const el = h(ordered ? "ol" : "ul");
    let item = null;
    for (const line of lines) {
      const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
      if (m && line.search(/\S/) < 2) {
        item = h("li", "", inline(m[1]));
        el.append(item);
      } else if (m && item) {
        // a nested item: keep it simple and show it as a sub list
        let sub = item.querySelector(":scope > ul, :scope > ol");
        if (!sub) item.append((sub = h(/^\s*\d/.test(line) ? "ol" : "ul")));
        sub.append(h("li", "", inline(m[1])));
      } else if (item) {
        item.append(" ", ...inline(line.trim()));
      }
    }
    if (ordered) {
      const start = parseInt(lines[0].trim(), 10);
      if (start > 1) el.start = start;
    }
    return el;
  }

  return function render(markdown) {
    const root = document.createDocumentFragment();
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    let i = 0;

    const isList = (l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l);
    const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    const startsBlock = (l) => /^(```|~~~|#{1,6}\s|>|\s*([-*_])\s*\2\s*\2[\s\-*_]*$)/.test(l) || isList(l);

    while (i < lines.length) {
      const line = lines[i];

      // ```code```
      const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)/);
      if (fence) {
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        i++; // the closing fence (missing while a reply is still streaming in, which is fine)
        root.append(codeBlock(fence[2], body.join("\n")));
        continue;
      }

      if (!line.trim()) {
        i++;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        root.append(h(`h${Math.min(heading[1].length + 1, 6)}`, "", inline(heading[2].replace(/\s#+\s*$/, ""))));
        i++;
        continue;
      }

      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
        root.append(h("hr"));
        i++;
        continue;
      }

      if (line.startsWith(">")) {
        const quote = [];
        while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
        root.append(h("blockquote", "", [render(quote.join("\n"))]));
        continue;
      }

      if (isTableRow(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
        root.append(table(rows));
        continue;
      }

      if (isList(line)) {
        const items = [];
        const ordered = /^\s*\d/.test(line);
        while (i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) items.push(lines[i++]);
        root.append(list(items, ordered));
        continue;
      }

      // a paragraph runs until a blank line or the start of another kind of block
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++]);
      const p = h("p");
      para.forEach((text, n) => {
        if (n) p.append(h("br"));
        p.append(...inline(text.trim()));
      });
      root.append(p);
    }
    return root;
  };
})();
