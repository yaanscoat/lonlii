// the AI chat page: the chat list, the conversation, and the box you type in.
// chats are saved in localStorage ("lonlii_aiChats"); the talking to OpenRouter is in openrouter.js.
(() => {
  const $ = (id) => document.getElementById(id);
  const thread = $("thread");
  const input = $("input");
  const sendButton = $("send");
  const modelSelect = $("modelSelect");

  const el = (tag, className, children = []) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);
    return node;
  };
  const icon = (name) => el("i", name);

  /* ---------- saved chats ---------- */

  let chats = [];
  try {
    chats = JSON.parse(localStorage.getItem("lonlii_aiChats")) ?? [];
  } catch {}

  function saveChats() {
    chats.sort((a, b) => b.updated - a.updated);
    chats = chats.slice(0, 40);
    try {
      localStorage.setItem("lonlii_aiChats", JSON.stringify(chats));
    } catch {
      // full: drop the oldest chats until it fits
      while (chats.length > 1) {
        chats.pop();
        try {
          localStorage.setItem("lonlii_aiChats", JSON.stringify(chats));
          break;
        } catch {}
      }
    }
  }

  let chat = null; // the open chat, or null for a new one
  let busy = null; // the AbortController while a reply is streaming in

  /* ---------- the chat list ---------- */

  function drawList() {
    const list = $("chatList");
    list.replaceChildren();
    if (!chats.length) list.append(el("p", "chat-empty", ["Your chats will show up here."]));
    for (const c of chats) {
      const open = el("button", "chat-open", [c.title]);
      open.type = "button";
      open.addEventListener("click", () => openChat(c.id));
      const del = el("button", "chat-delete", [icon("ri-delete-bin-line")]);
      del.type = "button";
      del.title = "Delete chat";
      del.addEventListener("click", () => deleteChat(c.id));
      list.append(el("div", `chat-item${chat?.id === c.id ? " on" : ""}`, [open, del]));
    }
  }

  function openChat(id) {
    if (busy) busy.abort();
    chat = chats.find((c) => c.id === id) ?? null;
    drawThread();
    drawList();
    closeSide();
  }

  function newChat() {
    if (busy) busy.abort();
    chat = null;
    drawThread();
    drawList();
    closeSide();
    input.focus();
  }

  function deleteChat(id) {
    chats = chats.filter((c) => c.id !== id);
    saveChats();
    if (chat?.id === id) chat = null;
    drawThread();
    drawList();
  }

  /* ---------- the conversation ---------- */

  const SUGGESTIONS = [
    "Explain photosynthesis like I'm 12",
    "Quiz me on the French Revolution",
    "Write a short story about a lonely robot",
    "Help me fix my JavaScript code",
  ];

  function drawThread() {
    thread.replaceChildren();
    if (!chat?.messages.length) return drawEmpty();
    chat.messages.forEach((m, i) => thread.append(message(m, i)));
    scrollDown(true);
  }

  function drawEmpty() {
    const { name } = lonliiProfile.get();
    const chips = SUGGESTIONS.map((text) => {
      const chip = el("button", "chip glass", [text]);
      chip.type = "button";
      chip.addEventListener("click", () => send(text));
      return chip;
    });
    const logo = new Image();
    logo.src = "/assets/img/lonelii.png";
    logo.alt = "";
    thread.append(
      el("div", "empty", [
        el("div", "empty-logo glass", [logo]),
        el("h1", "", [name ? `what's up, ${name}?` : "what's up?"]),
        el("p", "", ["Ask anything: homework, ideas, code, or just to talk."]),
        el("div", "chips", chips),
      ])
    );
  }

  const modelName = (id) => (id ? modelSelect.querySelector(`option[value="${CSS.escape(id)}"]`)?.textContent ?? id.replace(/:free$/, "") : "");

  function message(m, index) {
    if (m.role === "user") {
      return el("div", "msg user", [el("div", "bubble", [m.content]), lonliiProfile.avatar({ size: 30, still: true })]);
    }

    const logo = new Image();
    logo.src = "/assets/img/lonelii.png";
    logo.alt = "";
    const body = el("div", "msg-body");
    const head = el("div", "msg-head", [el("span", "msg-name", ["lonlii ai"]), el("span", "msg-model", [modelName(m.model)])]);
    const node = el("div", "msg ai", [el("div", "ai-avatar", [logo]), el("div", "msg-col", [head, body])]);
    fill(node, m, index, index === chat.messages.length - 1);
    return node;
  }

  // (re)draws an AI message's contents: its thinking, its answer, and the buttons under it
  function fill(node, m, index, isLast) {
    const body = node.querySelector(".msg-body");
    const open = body.querySelector("details")?.open;
    body.replaceChildren();
    node.querySelector(".msg-model").textContent = modelName(m.model);

    if (m.reasoning) {
      const summary = el("summary", "", [icon("ri-brain-line"), m.pending && !m.content ? " Thinking…" : " Thought about it"]);
      const details = el("details", "thinking", [summary, el("div", "thinking-text", [m.reasoning])]);
      details.open = open ?? false;
      body.append(details);
    }

    if (m.content) body.append(el("div", "md", [renderMarkdown(m.content)]));
    else if (m.pending && !m.reasoning) body.append(el("div", "typing", [el("span"), el("span"), el("span")]));

    if (m.error) {
      const retry = el("button", "", [icon("ri-refresh-line"), " Try again"]);
      retry.type = "button";
      retry.addEventListener("click", () => regenerate(index));
      body.append(el("div", "msg-error", [el("span", "", [m.error]), retry]));
    }

    if (!m.pending && m.content) {
      const copy = el("button", "", [icon("ri-file-copy-line")]);
      copy.type = "button";
      copy.title = "Copy";
      copy.addEventListener("click", () => {
        navigator.clipboard?.writeText(m.content);
        copy.replaceChildren(icon("ri-check-line"));
        setTimeout(() => copy.replaceChildren(icon("ri-file-copy-line")), 1500);
      });
      const actions = el("div", "msg-actions", [copy]);
      if (isLast) {
        const again = el("button", "", [icon("ri-refresh-line")]);
        again.type = "button";
        again.title = "Answer again";
        again.addEventListener("click", () => regenerate(index));
        actions.append(again);
      }
      body.append(actions);
    }
  }

  // keep following the reply as it comes in, unless you've scrolled up to read something
  let stick = true;
  thread.addEventListener("scroll", () => {
    stick = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  });
  function scrollDown(force) {
    if (force || stick) thread.scrollTop = thread.scrollHeight;
  }

  /* ---------- sending ---------- */

  function systemPrompt() {
    const { name } = lonliiProfile.get();
    return [
      "You are lonlii ai, the assistant built into lonlii, a hangout site for students with games, music and movies.",
      "Be friendly, casual and genuinely helpful. Keep answers short unless someone asks for detail.",
      "Use markdown when it helps (lists, tables, code blocks). Help people learn when it's schoolwork: explain, don't just hand over answers.",
      name ? `The user's name is ${name}.` : "",
      `Today is ${new Date().toDateString()}.`,
    ].filter(Boolean).join(" ");
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    if (!chat) {
      chat = { id: Date.now().toString(36), title: text.slice(0, 48), updated: Date.now(), messages: [] };
      chats.unshift(chat);
      thread.replaceChildren();
    }
    chat.messages.push({ role: "user", content: text });
    thread.append(message(chat.messages.at(-1), chat.messages.length - 1));
    input.value = "";
    grow();
    await reply();
  }

  async function reply() {
    const owner = chat; // you might switch chats while this one is still answering
    const m = { role: "assistant", content: "", reasoning: "", pending: true, model: null };
    owner.messages.push(m);
    owner.updated = Date.now();
    saveChats();
    drawList();
    const index = owner.messages.length - 1;
    const node = message(m, index);
    thread.append(node);
    stick = true;
    scrollDown(true);

    busy = new AbortController();
    setBusy(true);
    const history = owner.messages
      .slice(0, -1)
      .filter((x) => x.content && !x.error)
      .slice(-20)
      .map(({ role, content }) => ({ role, content }));

    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        fill(node, m, index, true);
        scrollDown();
      });
    };

    try {
      m.model = await LonliiAI.send({
        messages: [{ role: "system", content: systemPrompt() }, ...history],
        model: modelSelect.value,
        signal: busy.signal,
        onDelta: ({ content, reasoning }) => {
          m.content += content;
          m.reasoning += reasoning;
          redraw();
        },
      });
    } catch (e) {
      if (e.name !== "AbortError") m.error = e.message || "Something went wrong.";
      else if (!m.content) m.error = "Stopped before it answered.";
    } finally {
      cancelAnimationFrame(frame);
      m.pending = false;
      if (!m.reasoning) delete m.reasoning;
      busy = null;
      setBusy(false);
      owner.updated = Date.now();
      saveChats();
      if (chat === owner) {
        // only the newest answer gets an "answer again" button
        thread.querySelectorAll(".msg.ai").forEach((n) => n !== node && n.querySelector(".msg-actions button:nth-child(2)")?.remove());
        fill(node, m, index, true);
        scrollDown();
      }
    }
  }

  function regenerate(index) {
    if (busy) return;
    chat.messages.splice(index); // drop that answer (and anything after it)
    drawThread();
    reply();
  }

  function setBusy(on) {
    sendButton.classList.toggle("stop", on);
    sendButton.title = on ? "Stop" : "Send";
    sendButton.replaceChildren(icon(on ? "ri-stop-fill" : "ri-arrow-up-line"));
  }

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) busy.abort();
    else send(input.value);
  });

  // enter sends, shift+enter makes a new line (on phones the keyboard's return key adds a line)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !document.documentElement.classList.contains("is-touch")) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }
  input.addEventListener("input", grow);

  /* ---------- models ---------- */

  async function loadModels() {
    const saved = localStorage.getItem("lonlii_aiModel");
    try {
      for (const m of await LonliiAI.models()) {
        const option = el("option", "", [m.name]);
        option.value = m.id;
        modelSelect.append(option);
      }
    } catch {
      // can't reach openrouter's list right now; "auto" will try again when you send
    }
    if (saved && modelSelect.querySelector(`option[value="${CSS.escape(saved)}"]`)) modelSelect.value = saved;
    if (chat) drawThread(); // model names in the thread
  }

  modelSelect.addEventListener("change", () => {
    try { localStorage.setItem("lonlii_aiModel", modelSelect.value); } catch {}
  });

  /* ---------- sidebar on small screens ---------- */

  const closeSide = () => document.body.classList.remove("side-open");
  $("sideToggle").addEventListener("click", () => document.body.classList.toggle("side-open"));
  $("sideScrim").addEventListener("click", closeSide);
  $("newChat").addEventListener("click", newChat);

  // a new name or picture in settings shows up here too
  window.addEventListener("lonlii:profile", () => !chat && drawThread());

  drawList();
  drawThread();
  loadModels();
  if (!document.documentElement.classList.contains("is-touch")) input.focus();
})();
