// lonlii's AI runs on OpenRouter (openrouter.ai). only FREE models are ever used: the model list comes
// live from OpenRouter, filtered down to the ":free" ones, and send() refuses anything else.
window.LonliiAI = (() => {
  const API = "https://openrouter.ai/api/v1";

  // the api key is public on purpose: lonlii is a static site with no server to hide it on. it's only
  // scrambled so it isn't plain text in the source, because bots that scan github for leaked keys would
  // get it switched off. anyone can still see it in the browser's network tab. it's a free-tier key, so
  // it can only use free models, about 50 messages a day shared by everyone.
  const SCRAMBLED = ["==wDcZVWNogWSpFTAxFTGdBCep", "lDW1VCJ8VUdxRSSdBEEhgCQpwD", "e11XVdFUOtUVTEhRLoACKogXZR", "lWYBFTNR1FZJETEtxADRwH"];
  const SALT = "lonlii:study-hall";
  const key = () =>
    [...atob(SCRAMBLED.join("").split("").reverse().join(""))]
      .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ SALT.charCodeAt(i % SALT.length)))
      .join("");

  // free models we like best, in order. "auto" tries these first, then any other free model.
  const PREFERRED = [
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3.5-super-vl:free",
    "thinkingmachines/inkling:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-3.5-lightning:free",
    "poolside/laguna-s-2.1:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
  ];

  const isFree = (id) => typeof id === "string" && id.endsWith(":free");

  class LimitError extends Error {}

  // straight to openrouter, or through the bare proxy when this network blocks it
  async function request(url, init) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (init?.signal?.aborted || !window.lonliiProxy) throw e;
      return lonliiProxy.fetch(url, init);
    }
  }

  /* ---------- models ---------- */

  let modelList = null;

  // every free chat model on openrouter right now (cached for 6 hours)
  function models() {
    return (modelList ??= (async () => {
      try {
        const cached = JSON.parse(localStorage.getItem("lonlii_aiModels"));
        if (cached && Date.now() - cached.time < 6 * 3600e3 && cached.list.length) return cached.list;
      } catch {}

      const { data } = await (await request(`${API}/models`)).json();
      const list = data
        .filter((m) => isFree(m.id))
        .filter((m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
        .filter((m) => (m.architecture?.output_modalities ?? ["text"]).includes("text"))
        .filter((m) => !/safety|guard|moderation/i.test(m.id))
        .map((m) => ({ id: m.id, name: m.name.replace(/\s*\(free\)\s*$/i, ""), context: m.context_length }))
        .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));

      try { localStorage.setItem("lonlii_aiModels", JSON.stringify({ time: Date.now(), list })); } catch {}
      return list;
    })().catch((e) => {
      modelList = null;
      throw e;
    }));
  }

  const rank = (id) => (PREFERRED.includes(id) ? PREFERRED.indexOf(id) : PREFERRED.length);

  /* ---------- chatting ---------- */

  // streams a reply. onDelta({ content, reasoning }) gets each new piece of text as it arrives.
  // returns the model that answered. free models are often busy, so it moves down the list of free
  // models (three at a time, which openrouter tries in order) until one answers.
  async function send({ messages, model = "auto", signal, onDelta }) {
    const free = (await models()).map((m) => m.id);
    const order = model === "auto" ? free : [model, ...free.filter((id) => id !== model)];
    if (!order.every(isFree)) throw new Error("lonlii only uses free models.");

    let lastError = "No free models are answering right now. Try again in a minute.";
    for (let i = 0; i < Math.min(order.length, 9); i += 3) {
      const group = order.slice(i, i + 3);
      let res;
      res = await request(`${API}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${key()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": location.origin,
          "X-Title": "lonlii",
        },
        body: JSON.stringify({ models: group, messages, stream: true, reasoning: { effort: "low" } }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        const message = error?.error?.message ?? `error ${res.status}`;
        if (res.status === 429 && /per-day|per day|credits/i.test(message)) {
          throw new LimitError("lonlii's AI has used up today's free messages (it's shared by everyone). It resets tomorrow.");
        }
        if (res.status === 401 || res.status === 403) throw new Error("The AI key isn't working anymore.");
        lastError = message;
        continue; // busy / missing model: try the next three
      }

      const answered = await read(res, onDelta);
      if (answered.ok) return answered.model;
      lastError = answered.error;
      if (answered.wrote) throw new Error(answered.error); // it got partway, don't start over silently
    }
    throw new Error(lastError);
  }

  // reads openrouter's server-sent events
  async function read(res, onDelta) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let model = null;
    let wrote = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue; // ": OPENROUTER PROCESSING" keep-alives
        const data = line.slice(6).trim();
        if (data === "[DONE]") return { ok: wrote, model, wrote, error: "The model didn't say anything. Try again." };
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) return { ok: false, wrote, error: chunk.error.message ?? "The model stopped with an error." };
        model ??= chunk.model;
        const delta = chunk.choices?.[0]?.delta ?? {};
        if (delta.content || delta.reasoning) {
          wrote ||= Boolean(delta.content);
          onDelta?.({ content: delta.content ?? "", reasoning: delta.reasoning ?? "" });
        }
      }
    }
    return { ok: wrote, model, wrote, error: "The model didn't say anything. Try again." };
  }

  return { models, send, isFree, LimitError };
})();
