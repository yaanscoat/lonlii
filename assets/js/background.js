// the background behind everything. by default it's a looping minecraft video from YouTube, but
// it can be turned off, or swapped for your own image / video (uploaded, or pasted as a link).
// the choice is set in settings → proxy and saved in localStorage ("lonlii_bg"). uploaded files are
// too big for localStorage, so they're kept in IndexedDB instead.
window.lonliiBackground = (() => {
  // the default: "15 minute Minecraft Desert domain loop" (youtu.be/w7XcV62JTTs). the video is the same
  // 92.6 second scene over and over, so it plays straight through and only restarts every 15 minutes.
  // every restart briefly shows youtube's buttons, which is why it doesn't jump back every 92 seconds
  const MINECRAFT = { kind: "youtube", id: "w7XcV62JTTs", start: 0, end: 0 };

  /* ---------- saved choice ---------- */

  // { mode: "minecraft" | "upload" | "link" | "off", link?: string, dim?: number }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem("lonlii_bg"));
      if (saved?.mode) return saved;
      // people who switched the old video background off keep it off
      if (localStorage.getItem("lonlii_bgVideo") === "no") return { mode: "off", dim: 45 };
    } catch {}
    return { mode: "minecraft", dim: 45 };
  }

  function save(patch) {
    settings = { ...settings, ...patch };
    try { localStorage.setItem("lonlii_bg", JSON.stringify(settings)); } catch {}
  }

  let settings = load();

  /* ---------- uploaded files (IndexedDB) ---------- */

  function store(mode, ...args) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("lonlii", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("files");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("files", mode === "get" ? "readonly" : "readwrite");
        const req = tx.objectStore("files")[mode](...args);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      };
    });
  }

  const getUpload = () => store("get", "background").catch(() => null);
  const putUpload = (file) => store("put", { blob: file, name: file.name, type: file.type }, "background");

  /* ---------- links: what kind of background is this url? ---------- */

  function parseLink(raw) {
    let url;
    try {
      url = new URL(raw.trim());
    } catch {
      return null;
    }
    if (!/^(https?|data):$/.test(url.protocol)) return null;

    const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
    const seconds = (v) => {
      if (!v) return 0;
      const m = String(v).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/);
      return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : parseFloat(v) || 0;
    };

    // looptube.xyz/loop?vid=ID&segments=start,end,name
    if (host.endsWith("looptube.xyz") && url.searchParams.get("vid")) {
      const [start, end] = (url.searchParams.get("segments") ?? "").split(",").map(Number);
      return { kind: "youtube", id: url.searchParams.get("vid"), start: start || 0, end: end || 0 };
    }

    // youtube.com/watch?v=ID, youtu.be/ID, /embed/ID, /shorts/ID, /live/ID
    let id = null;
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
    else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1];
    }
    if (id) {
      const p = url.searchParams;
      return { kind: "youtube", id, start: seconds(p.get("start") ?? p.get("t")), end: seconds(p.get("end")) };
    }

    const path = url.pathname.toLowerCase();
    if (/^data:video\//.test(raw) || /\.(mp4|webm|ogv|mov|m4v)$/.test(path)) return { kind: "video", src: url.href };
    if (/^data:image\//.test(raw) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(path)) return { kind: "image", src: url.href };
    return { kind: "unknown", src: url.href }; // tried as an image, then as a video
  }

  /* ---------- drawing it ---------- */

  let layer = null;
  let objectUrl = null;
  let ytTimer = null;
  let token = 0; // bumps every time the background changes, so slow loads for an old one are dropped

  function clear() {
    clearInterval(ytTimer);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    layer.replaceChildren();
  }

  // fade the new background in once it can actually be seen
  function shown(el, t) {
    if (t !== token) return;
    el.classList.add("shown");
    document.body.classList.remove("no-bg");
  }

  // couldn't load (blocked, broken link, ...): fall back to the plain theme colors
  function failed(t, why) {
    if (t !== token) return;
    clear();
    document.body.classList.add("no-bg");
    status(why, true);
  }

  function showImage(src, t, onError) {
    const img = new Image();
    img.className = "bg-media";
    img.alt = "";
    img.decoding = "async";
    img.onload = () => shown(img, t);
    img.onerror = onError ?? (() => failed(t, "That image couldn't be loaded."));
    img.src = src;
    layer.append(img);
  }

  function showVideo(src, t, why = "That video couldn't be loaded.") {
    const video = document.createElement("video");
    video.className = "bg-media";
    Object.assign(video, { muted: true, loop: true, autoplay: true, playsInline: true, src });
    video.setAttribute("playsinline", ""); // ios needs the attribute, not just the property
    video.addEventListener("playing", () => shown(video, t), { once: true });
    video.addEventListener("error", () => failed(t, why));
    layer.append(video);
    video.play().catch(() => {});
  }

  let ytApi = null;
  function loadYouTubeApi() {
    ytApi ??= new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve();
      const before = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        before?.();
        resolve();
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => reject(new Error("blocked"));
      document.head.append(s);
    });
    ytApi.catch(() => (ytApi = null));
    return ytApi;
  }

  async function showYouTube({ id, start = 0, end = 0 }, t) {
    const holder = document.createElement("div");
    holder.className = "bg-media bg-youtube";
    holder.append(document.createElement("div"));
    layer.append(holder);

    // a network that blocks youtube never gets to "playing"
    const giveUp = setTimeout(() => failed(t, "YouTube didn't load, so the background is off. It might be blocked on this network."), 15000);

    try {
      await loadYouTubeApi();
    } catch {
      clearTimeout(giveUp);
      return failed(t, "YouTube is blocked on this network, so the background is off.");
    }
    if (t !== token) return clearTimeout(giveUp);

    let looping = false;
    let reveal = null;
    const player = new YT.Player(holder.firstChild, {
      videoId: id,
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0, start: Math.floor(start), origin: location.origin },
      events: {
        onReady: () => {
          player.mute();
          player.playVideo();
        },
        onStateChange: ({ data }) => {
          if (data === YT.PlayerState.PLAYING) {
            clearTimeout(giveUp);
            // wait out the pause button youtube flashes over a video when it starts
            clearTimeout(reveal);
            reveal = setTimeout(() => {
              looping = false;
              shown(holder, t);
            }, 2200);
          } else if (data === YT.PlayerState.ENDED) {
            restart();
          }
        },
        onError: () => {
          clearTimeout(giveUp);
          failed(t, "YouTube won't play that video here, so the background is off.");
        },
      },
    });

    // looping: fade out just before the end (the chosen part, or the whole video), jump back to the
    // start, and fade back in once youtube's buttons are gone again
    function restart() {
      clearTimeout(reveal);
      holder.classList.remove("shown");
      player.seekTo(start, true);
      player.playVideo();
    }
    ytTimer = setInterval(() => {
      if (t !== token || !player.getCurrentTime) return;
      const now = player.getCurrentTime();
      const stop = end > start ? end : player.getDuration() - 0.3;
      if (stop <= start || looping) return;
      if (now >= stop - 0.9) {
        looping = true;
        clearTimeout(reveal);
        holder.classList.remove("shown");
        setTimeout(restart, 900);
      }
    }, 200);
  }

  function show(source, t) {
    if (source.kind === "youtube") showYouTube(source, t);
    else if (source.kind === "video") showVideo(source.src, t);
    else if (source.kind === "image") showImage(source.src, t);
    else showImage(source.src, t, () => {
      layer.replaceChildren();
      showVideo(source.src, t, "That link couldn't be loaded. It needs to go straight to an image or video file.");
    });
  }

  async function apply() {
    layer ??= document.getElementById("bg-layer");
    if (!layer) return;
    const t = ++token;
    clear();
    document.documentElement.style.setProperty("--bg-dim", `${settings.dim ?? 45}%`);
    document.body.classList.add("no-bg"); // plain colors until the new background is ready to fade in
    status("");

    if (settings.mode === "off") return;
    if (settings.mode === "minecraft") return show(MINECRAFT, t);
    if (settings.mode === "link") {
      const source = parseLink(settings.link ?? "");
      return source ? show(source, t) : failed(t, "That link doesn't look right.");
    }
    if (settings.mode === "upload") {
      const file = await getUpload();
      if (t !== token) return;
      if (!file?.blob) return failed(t, "Your uploaded background is gone (the browser's site data was cleared). Upload it again.");
      objectUrl = URL.createObjectURL(file.blob);
      return file.type.startsWith("video/") ? showVideo(objectUrl, t) : showImage(objectUrl, t);
    }
  }

  // nothing behind a hidden tab needs to keep playing
  document.addEventListener("visibilitychange", () => {
    const media = layer?.querySelector("video");
    if (media) document.hidden ? media.pause() : media.play().catch(() => {});
  });

  /* ---------- the settings panel (settings → proxy → background) ---------- */

  function status(text, isError = false) {
    const el = document.getElementById("bgStatus");
    if (!el) return;
    el.textContent = text || describe();
    el.classList.toggle("error", isError);
  }

  function describe() {
    if (settings.mode === "minecraft") return "Playing the Minecraft loop.";
    if (settings.mode === "off") return "The background is off.";
    if (settings.mode === "link") return `Playing your link: ${settings.link}`;
    return `Playing your upload${settings.uploadName ? `: ${settings.uploadName}` : ""}.`;
  }

  function syncPanel() {
    document.querySelectorAll(".bg-picker [data-bg]").forEach((b) => b.classList.toggle("on", b.dataset.bg === settings.mode));
    const linkRow = document.getElementById("bgLinkForm");
    if (linkRow) linkRow.hidden = settings.mode !== "link";
    const linkInput = document.getElementById("bgLinkInput");
    if (linkInput && settings.link && !linkInput.value) linkInput.value = settings.link;
    const dim = document.getElementById("bgDim");
    if (dim) dim.value = settings.dim ?? 45;
  }

  const toast = (msg) => window.showToast?.("success", msg, "ri-image-2-line");

  function setMode(mode) {
    if (mode === "upload") return document.getElementById("bgFile")?.click();
    if (mode === "link") {
      save({ mode: "link" });
      syncPanel();
      document.getElementById("bgLinkInput")?.focus();
      if (settings.link) apply();
      return;
    }
    save({ mode });
    syncPanel();
    apply();
    toast(mode === "off" ? "Background turned off" : "Minecraft background is back");
  }

  function setLink(raw) {
    if (!parseLink(raw)) return status("Paste a full link that starts with https://", true);
    save({ mode: "link", link: raw.trim() });
    syncPanel();
    apply();
    toast("Background set from your link");
  }

  async function setUpload(file) {
    if (!file) return;
    if (!/^(image|video)\//.test(file.type)) return status("That file isn't an image or a video.", true);
    if (file.size > 300 * 1024 * 1024) return status("That file is over 300 MB. Try a smaller one.", true);
    try {
      await putUpload(file);
    } catch {
      return status("Your browser wouldn't save that file (private browsing can block this).", true);
    }
    save({ mode: "upload", uploadName: file.name });
    syncPanel();
    apply();
    toast("Background set from your file");
  }

  function wirePanel() {
    if (!document.querySelector(".bg-picker")) return;
    document.querySelectorAll(".bg-picker [data-bg]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.bg)));
    document.getElementById("bgFile")?.addEventListener("change", (e) => {
      setUpload(e.target.files[0]);
      e.target.value = "";
    });
    document.getElementById("bgLinkForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      setLink(document.getElementById("bgLinkInput").value);
    });
    document.getElementById("bgDim")?.addEventListener("input", (e) => {
      save({ dim: Number(e.target.value) });
      document.documentElement.style.setProperty("--bg-dim", `${settings.dim}%`);
    });
    syncPanel();
    status("");
  }

  function start() {
    wirePanel();
    apply();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  return { apply, parseLink, settings: () => ({ ...settings }) };
})();
