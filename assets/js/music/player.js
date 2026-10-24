// the music player: a queue, and two ways to actually play sound.
//
//  1. YouTube's official embedded player. it plays from the visitor's own connection, so YouTube
//     doesn't bot-check it the way it does the shared bare server.
//  2. SoundCloud through the bare proxy, when YouTube can't play a song (blocked network,
//     the label disabled embedding, or the embed never starts).
//
// the ui listens with player.on("change" | "progress" | "state", fn).
window.MusicPlayer = (() => {
  const listeners = {};
  const emit = (type, data) => (listeners[type] ?? []).forEach((fn) => fn(data));

  const state = {
    queue: [],
    index: -1,
    playing: false,
    loading: false,
    engine: null, // "yt" | "sc"
    time: 0,
    duration: 0,
    volume: Number(localStorage.getItem("lonlii_musicVolume") ?? 80),
    shuffle: false,
    repeat: "off", // "off" | "all" | "one"
    radio: true, // keep going with similar songs at the end of the queue
    note: "", // e.g. "playing from SoundCloud"
  };

  const current = () => state.queue[state.index] ?? null;
  let loadId = 0; // bumps on every song change, so slow requests for a skipped song are ignored

  /* ---------- engine 1: youtube embed ---------- */

  let yt = null;
  let ytReady = null;
  let ytStartTimer = null;

  function loadYouTube() {
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("youtube player didn't load")), 9000);
      window.onYouTubeIframeAPIReady = () => {
        yt = new YT.Player("yt-player", {
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, origin: location.origin },
          events: {
            onReady: () => {
              clearTimeout(timeout);
              yt.setVolume(state.volume);
              resolve(yt);
            },
            onStateChange: onYouTubeState,
            onError: (e) => fallback(`YouTube can't play this (error ${e.data})`),
          },
        });
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("youtube is blocked"));
      };
      document.head.append(s);
    });
    ytReady.catch(() => (ytReady = null));
    return ytReady;
  }

  function onYouTubeState({ data }) {
    if (state.engine !== "yt") return;
    if (data === YT.PlayerState.PLAYING) {
      clearTimeout(ytStartTimer);
      set({ playing: true, loading: false });
    } else if (data === YT.PlayerState.PAUSED) {
      set({ playing: false });
    } else if (data === YT.PlayerState.BUFFERING) {
      set({ loading: true });
    } else if (data === YT.PlayerState.ENDED) {
      ended();
    }
  }

  async function playYouTube(track) {
    const player = await loadYouTube();
    state.engine = "yt";
    player.loadVideoById(track.id);
    player.setVolume(state.volume);
    // a network that blocks googlevideo never gets past "unstarted"
    clearTimeout(ytStartTimer);
    ytStartTimer = setTimeout(() => {
      if (state.engine === "yt" && current() === track && !state.playing) fallback("YouTube didn't start");
    }, 12000);
  }

  /* ---------- engine 2: soundcloud through bare ---------- */

  const audio = new Audio();
  audio.preload = "auto";
  let hls = null;

  audio.addEventListener("playing", () => state.engine === "sc" && set({ playing: true, loading: false }));
  audio.addEventListener("pause", () => state.engine === "sc" && set({ playing: false }));
  audio.addEventListener("waiting", () => state.engine === "sc" && set({ loading: true }));
  audio.addEventListener("ended", () => state.engine === "sc" && ended());
  audio.addEventListener("error", () => state.engine === "sc" && set({ loading: false, note: "this song couldn't be played" }));

  async function playSoundCloud(track) {
    stopSoundCloud();
    state.engine = "sc";
    const id = loadId;
    const { url, kind } = await SC.stream(track);
    if (id !== loadId) return; // skipped meanwhile
    audio.volume = state.volume / 100;
    if (kind === "hls" && window.Hls?.isSupported()) {
      hls = new Hls({ loader: lonliiBareHlsLoader() });
      hls.loadSource(url);
      hls.attachMedia(audio);
      hls.on(Hls.Events.ERROR, (_e, d) => d.fatal && set({ loading: false, note: "this song couldn't be played" }));
    } else if (kind === "hls" && audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = url; // safari plays hls natively
    } else {
      // whole file through bare, then play it locally (seeking stays instant)
      const blob = await (await lonliiProxy.fetch(url)).blob();
      if (id !== loadId) return;
      audio.src = URL.createObjectURL(blob);
    }
    await audio.play().catch(() => set({ playing: false, loading: false }));
  }

  function stopSoundCloud() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    audio.pause();
    if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    audio.removeAttribute("src");
    audio.load();
  }

  // youtube couldn't do it: find the same song on soundcloud
  async function fallback(reason) {
    const track = current();
    if (!track || state.engine === "sc") return;
    clearTimeout(ytStartTimer);
    yt?.stopVideo?.();
    set({ loading: true, note: `${reason}, trying SoundCloud…` });
    try {
      const match = track.sc ? track : await SC.match(track);
      if (current() !== track) return;
      if (!match) throw new Error("not on SoundCloud");
      set({ note: "playing from SoundCloud" });
      await playSoundCloud(match);
    } catch {
      if (current() !== track) return;
      set({ loading: false, playing: false, note: "couldn't play this song anywhere, skipping" });
      setTimeout(() => current() === track && next(), 1800);
    }
  }

  /* ---------- queue ---------- */

  function set(patch) {
    Object.assign(state, patch);
    emit("state", state);
  }

  async function load() {
    const track = current();
    if (!track) return;
    loadId++;
    clearTimeout(ytStartTimer);
    yt?.stopVideo?.();
    stopSoundCloud();
    set({ loading: true, playing: false, time: 0, duration: track.duration ?? 0, note: "" });
    emit("change", track);
    remember(track);
    updateMediaSession(track);

    try {
      if (track.source === "sc") {
        if (track.unplayable) throw new Error("preview only");
        await playSoundCloud(track);
      } else {
        await playYouTube(track);
      }
    } catch (e) {
      if (track.source === "yt") fallback(e.message);
      else set({ loading: false, note: "this song can't be played here" });
    }
  }

  function play(tracks, index = 0) {
    state.queue = tracks.filter((t) => t.type === "track");
    state.index = Math.max(0, Math.min(index, state.queue.length - 1));
    if (state.shuffle) shuffleRest();
    load();
  }

  function shuffleRest() {
    const rest = state.queue.splice(state.index + 1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    state.queue.push(...rest);
  }

  function addNext(track) {
    state.queue.splice(state.index + 1, 0, track);
    if (state.index === -1) play([track]);
    emit("state", state);
  }

  function addToQueue(track) {
    state.queue.push(track);
    if (state.index === -1) play([track]);
    emit("state", state);
  }

  async function next() {
    if (state.index < state.queue.length - 1) {
      state.index++;
      return load();
    }
    if (state.repeat === "all" && state.queue.length) {
      state.index = 0;
      return load();
    }
    // end of the queue: keep the music going with youtube music's radio for the last song
    const last = current();
    if (state.radio && last?.source === "yt") {
      try {
        const seen = new Set(state.queue.map((t) => t.id));
        const more = (await YTM.radio(last.id)).filter((t) => !seen.has(t.id));
        if (more.length) {
          state.queue.push(...more);
          state.index++;
          return load();
        }
      } catch {}
    }
    set({ playing: false });
  }

  function previous() {
    // like every music app: restart the song unless we're at the very start of it
    if (state.time > 3 || state.index <= 0) return seek(0);
    state.index--;
    load();
  }

  function ended() {
    if (state.repeat === "one") {
      seek(0);
      resume();
    } else {
      next();
    }
  }

  function jump(index) {
    state.index = index;
    load();
  }

  /* ---------- controls ---------- */

  function resume() {
    if (state.engine === "yt") yt?.playVideo();
    else audio.play().catch(() => {});
  }

  function pause() {
    if (state.engine === "yt") yt?.pauseVideo();
    else audio.pause();
  }

  const toggle = () => (state.playing ? pause() : current() ? resume() : null);

  function seek(seconds) {
    if (state.engine === "yt") yt?.seekTo(seconds, true);
    else if (Number.isFinite(audio.duration)) audio.currentTime = seconds;
    set({ time: seconds });
  }

  function setVolume(v) {
    state.volume = Math.max(0, Math.min(100, Math.round(v)));
    yt?.setVolume?.(state.volume);
    audio.volume = state.volume / 100;
    try { localStorage.setItem("lonlii_musicVolume", state.volume); } catch {}
    emit("state", state);
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    if (state.shuffle) shuffleRest();
    emit("state", state);
  }

  function cycleRepeat() {
    state.repeat = { off: "all", all: "one", one: "off" }[state.repeat];
    emit("state", state);
  }

  // progress: neither engine reports time on its own often enough for a smooth bar
  setInterval(() => {
    if (!current()) return;
    if (state.engine === "yt" && yt?.getCurrentTime) {
      state.time = yt.getCurrentTime() || 0;
      state.duration = yt.getDuration() || state.duration;
    } else if (state.engine === "sc") {
      state.time = audio.currentTime || 0;
      if (Number.isFinite(audio.duration)) state.duration = audio.duration;
    }
    emit("progress", state);
    if ("mediaSession" in navigator && state.duration) {
      try {
        navigator.mediaSession.setPositionState({ duration: state.duration, position: Math.min(state.time, state.duration), playbackRate: 1 });
      } catch {}
    }
  }, 250);

  /* ---------- lock screen / media keys (phones, tablets, keyboards) ---------- */

  function updateMediaSession(track) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists.map((a) => a.name).join(", "),
      album: track.album?.name ?? "",
      artwork: track.thumb ? [{ src: track.thumb, sizes: "544x544" }] : [],
    });
  }

  if ("mediaSession" in navigator) {
    const handlers = {
      play: resume,
      pause,
      previoustrack: previous,
      nexttrack: next,
      seekto: (d) => seek(d.seekTime),
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
    }
  }

  /* ---------- recently played ---------- */

  function remember(track) {
    try {
      const slim = { ...track, sc: track.sc ? { id: track.sc.id, media: track.sc.media, track_authorization: track.sc.track_authorization } : undefined };
      const recent = JSON.parse(localStorage.getItem("lonlii_musicRecent") ?? "[]").filter((t) => !(t.id === track.id && t.source === track.source));
      localStorage.setItem("lonlii_musicRecent", JSON.stringify([slim, ...recent].slice(0, 50)));
    } catch {}
  }

  return {
    state,
    current,
    on: (type, fn) => (listeners[type] ??= []).push(fn),
    play, next, previous, jump, toggle, resume, pause, seek, setVolume,
    toggleShuffle, cycleRepeat, addNext, addToQueue,
  };
})();
