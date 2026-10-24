// device + browser detection. tags <html> with classes that assets/css/compat.css uses, and exposes
// window.lonliiDevice for scripts. load it first in <head> so the classes are there before paint.
(() => {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;

  // iPadOS 13+ says it's a Mac, so a "Mac" with a touchscreen is an iPad
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch);
  const ios = /iPhone|iPod/.test(ua) || ipad;
  const android = /Android/.test(ua);
  const edge = /Edg(e|A|iOS)?\//.test(ua);
  const firefox = /Firefox|FxiOS/.test(ua);
  const samsung = /SamsungBrowser/.test(ua);
  const chromium = !!window.chrome || /Chrome|CriOS|Chromium/.test(ua);
  const safari = /Safari/.test(ua) && !chromium && !firefox && !edge;

  const shortSide = Math.min(screen.width, screen.height);
  const tablet = ipad || (android && !/Mobile/.test(ua)) || (touch && shortSide >= 600);
  const phone = touch && !tablet && (ios || android || shortSide < 600);

  const supports = {
    serviceWorker: "serviceWorker" in navigator,
    sharedWorker: typeof SharedWorker !== "undefined",
    backdrop: CSS.supports?.("backdrop-filter", "blur(1px)") || CSS.supports?.("-webkit-backdrop-filter", "blur(1px)"),
    colorMix: CSS.supports?.("color", "color-mix(in srgb, red, blue)"),
    dvh: CSS.supports?.("height", "100dvh"),
  };

  const device = {
    ios, ipad, android, phone, tablet, touch, firefox, edge, samsung, safari,
    chromium: chromium && !edge && !samsung,
    desktop: !phone && !tablet,
    supports,
  };
  window.lonliiDevice = device;

  const root = document.documentElement;
  const flags = {
    "is-ios": ios, "is-ipad": ipad, "is-android": android, "is-phone": phone, "is-tablet": tablet,
    "is-touch": touch, "is-desktop": device.desktop, "is-firefox": firefox, "is-edge": edge,
    "is-chromium": device.chromium, "is-safari": safari, "is-samsung": samsung,
    "no-backdrop": !supports.backdrop, "no-color-mix": !supports.colorMix,
  };
  for (const [name, on] of Object.entries(flags)) if (on) root.classList.add(name);

  // the real visible height: 100vh on mobile includes the hidden address bar
  const setHeight = () => root.style.setProperty("--app-height", `${window.innerHeight}px`);
  setHeight();
  addEventListener("resize", setHeight);
  addEventListener("orientationchange", () => setTimeout(setHeight, 250));

  // things the proxy can't run without; say so once instead of failing silently
  const problems = [];
  if (!supports.serviceWorker) {
    problems.push(firefox
      ? "Firefox turns service workers off in private windows, so the proxy can't run here. Use a normal window."
      : "This browser has service workers turned off, so the proxy can't run here.");
  } else if (!supports.sharedWorker) {
    problems.push("This browser is missing SharedWorker, so the proxy may not load. Try Chrome, Edge, Firefox or Safari 16+.");
  }
  device.problems = problems;

  if (problems.length && window.top === window) {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => problems.forEach((p) => window.showToast?.("error", p, "ri-error-warning-line")), 500);
    });
  }
})();
