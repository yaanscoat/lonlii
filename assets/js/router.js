// keeps the address bar on a school-subject url (see routes.js) while you move around lonlii,
// and opens the right section when someone lands on /chemistry, /advanced-music, etc.
(() => {
  const PANELS = {
    games: { toggle: "toggleGames", el: ".games-wrapper" },
    apps: { toggle: "toggleApps", el: ".apps-wrapper" },
    settings: { toggle: "toggleSettings", el: ".settings-container" },
  };

  let page = "home"; // the full-screen section underneath any open panel
  let depth = 0; // only the outermost call writes history (toggles call each other)
  let restoring = false; // true while we're the ones opening things, e.g. on back/forward

  const isOpen = (s) => document.querySelector(PANELS[s].el)?.classList.contains("settings-shown");
  const browserVisible = () => getComputedStyle(document.querySelector(".browser-container")).opacity !== "0";

  function setUrl(section) {
    if (restoring || depth > 1) return;
    const path = lonliiRoutes.pathFor(section);
    if (location.pathname === path && !location.search) return;
    history.pushState({ section }, "", path + location.hash);
  }

  function wrap(name, after) {
    const original = window[name];
    if (typeof original !== "function") return;
    window[name] = function (...args) {
      depth++;
      try {
        return original.apply(this, args);
      } finally {
        if (depth === 1) after(...args);
        depth--;
      }
    };
  }

  wrap("navTo", (l) => {
    page = l.startsWith("play.html") ? "play" : l.includes("home") ? "home" : l;
    if (!LONLII_ROUTES[page]) page = "home";
    setUrl(page);
  });

  for (const [section, { toggle }] of Object.entries(PANELS)) {
    wrap(toggle, () => setUrl(isOpen(section) ? section : page));
  }

  wrap("rSearch", () => {
    page = "browser";
    setUrl("browser");
  });

  wrap("hideBrowser", () => {
    page = "home";
    setUrl("home");
  });

  function showEmptyBrowser() {
    const b = document.querySelector(".browser-container");
    b.style.opacity = 1;
    b.style.pointerEvents = "all";
    newTab();
    switchTab(aTab);
  }

  function open(section) {
    restoring = true;
    try {
      for (const s of Object.keys(PANELS)) {
        if (s !== section && isOpen(s)) window[PANELS[s].toggle]();
      }

      if (section !== "browser" && browserVisible()) hideBrowser();

      if (PANELS[section] || section === "play") {
        // a game can't be resumed from the url alone, so /physics-lab shows the game list
        const panel = PANELS[section] ? section : "games";
        if (!isOpen(panel)) window[PANELS[panel].toggle]();
      } else if (section === "browser") {
        if (!browserVisible()) showEmptyBrowser();
        page = "browser";
      } else if (section === "home") {
        if (page !== "home") navTo("home?launch=1");
        page = "home";
      } else if (section !== page) {
        navTo(section);
        page = section;
      }
    } finally {
      restoring = false;
    }
  }

  window.addEventListener("popstate", () => {
    open(lonliiRoutes.sectionFor(location.pathname) ?? "home");
  });

  // first load: from a subject url, from 404.html's ?route=, or plain /?launch=1
  window.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(location.search);
    const section =
      lonliiRoutes.sectionFor(location.pathname) ??
      lonliiRoutes.sectionFor(params.get("route") ?? "") ??
      "home";

    history.replaceState({ section }, "", lonliiRoutes.pathFor(section) + location.hash);
    if (section !== "home") setTimeout(() => open(section), 0);
  });
})();
