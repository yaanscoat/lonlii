// the intro: a lock-screen style welcome that waits for the proxy to be ready, then dissolves into the site
(() => {
  const intro = document.getElementById("lonlii-intro");
  const started = performance.now();

  // the full welcome once per tab, a quick one on reloads
  let seen = false;
  try {
    seen = sessionStorage.getItem("lonlii_introSeen") === "yes";
    sessionStorage.setItem("lonlii_introSeen", "yes");
  } catch {}
  const MIN_TIME = seen ? 1100 : 2600;

  // hold toasts until the site is showing, so nothing pops up over the welcome.
  // t.js defines showToast on DOMContentLoaded, so catch it whenever it's assigned
  const queued = [];
  let revealed = false;
  let realToast = window.showToast;
  const heldToast = (...args) => (revealed && realToast ? realToast(...args) : queued.push(args));
  Object.defineProperty(window, "showToast", {
    configurable: true,
    get: () => heldToast,
    set: (fn) => (realToast = fn),
  });

  function reveal() {
    document.body.classList.add("lonlii-ready");
    setTimeout(() => {
      revealed = true;
      queued.splice(0).forEach((args, i) => setTimeout(() => realToast?.(...args), i * 250));
    }, 1300);
  }

  if (!intro) {
    document.addEventListener("DOMContentLoaded", reveal);
    return;
  }

  const clock = document.getElementById("intro-clock");
  const date = document.getElementById("intro-date");
  const status = document.getElementById("intro-status");
  const ring = intro.querySelector(".ring-progress");

  function tick() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
    date.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }
  tick();
  const clockTimer = setInterval(tick, 1000);

  // the greeting (and picture) use your profile from settings → profile, when you've set one
  const profile = window.lonliiProfile?.get() ?? {};
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "up late" : hour < 12 ? "good morning" : hour < 17 ? "good afternoon" : hour < 22 ? "good evening" : "good night";
  document.getElementById("intro-greeting").textContent =
    (profile.name ? `${greeting}, ${profile.name}` : greeting) + (hour < 5 ? "?" : "");
  if (profile.pfp) {
    const icon = intro.querySelector(".intro-avatar img");
    icon.src = profile.pfp;
    icon.classList.add("is-pfp");
  }

  function step(percent, text) {
    ring.style.strokeDashoffset = String(100 - percent);
    if (text && status.textContent !== text) {
      status.style.opacity = 0;
      setTimeout(() => {
        status.textContent = text;
        status.style.opacity = 1;
      }, 200);
    }
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const withTimeout = (p, ms) => Promise.race([p, wait(ms)]);

  let finished = false;
  async function finish() {
    if (finished) return;
    finished = true;
    const returning = (localStorage.getItem("lonlii_siteVersion") ?? "") !== "";
    step(100, returning ? "welcome back" : "welcome to lonlii");
    intro.classList.add("ready");
    await wait(seen ? 250 : 650);
    intro.classList.add("leaving");
    reveal();
    setTimeout(() => {
      clearInterval(clockTimer);
      intro.remove();
    }, 2200);
  }

  async function run() {
    step(12, "getting things ready");
    await wait(300);
    if (document.fonts?.ready) await withTimeout(document.fonts.ready, 1500);
    step(45, "connecting securely");
    if ("serviceWorker" in navigator && !window.lonliiProxyReady) {
      await withTimeout(new Promise((r) => addEventListener("lonlii:proxy-ready", r, { once: true })), 3000);
    }
    step(80, "almost there");
    await wait(Math.max(0, MIN_TIME - (performance.now() - started)));
    finish();
  }

  // any key, click or tap skips straight to the site
  const skip = () => finish();
  addEventListener("keydown", skip, { once: true });
  intro.addEventListener("pointerdown", skip, { once: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();

// pages inside the content frame (movies, music) can ask for the nav to get out of the way
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.data?.type !== "lonlii-nav") return;
  document.body.classList.toggle("nav-tucked", !!e.data.hidden);
});
