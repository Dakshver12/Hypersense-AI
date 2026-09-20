export const $ = (id) => document.getElementById(id);

export function renderQuestion(text) {
  const target = $("question");
  target.replaceChildren();
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  let fence = null,
    code = [],
    paragraph = [];
  const inline = (parent, value) => {
    const pattern = /(`+)([^`]+)\1|\*\*([^*]+)\*\*/g;
    let last = 0,
      match;
    while ((match = pattern.exec(value))) {
      parent.appendChild(document.createTextNode(value.slice(last, match.index)));
      const node = document.createElement(match[3] ? "strong" : "code");
      node.textContent = match[3] || match[2];
      parent.appendChild(node);
      last = pattern.lastIndex;
    }
    parent.appendChild(document.createTextNode(value.slice(last)));
  };
  const flush = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    inline(p, paragraph.join(" "));
    target.appendChild(p);
    paragraph = [];
  };
  const flushCode = () => {
    const pre = document.createElement("pre"),
      node = document.createElement("code");
    node.textContent = code.join("\n");
    pre.appendChild(node);
    target.appendChild(pre);
    code = [];
  };
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        flushCode();
        fence = null;
      } else code.push(line);
      continue;
    }
    if (marker) {
      flush();
      fence = marker[1];
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  if (fence) flushCode();
  flush();
}
