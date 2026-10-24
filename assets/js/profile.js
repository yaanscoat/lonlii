// your profile: a name, a profile picture and a decoration around it. there are no accounts, so it's
// only saved in this browser (localStorage) and nobody else ever sees it.
//
// decorations are animated pngs in assets/img/pfp-deco (288x288, drawn 1.2x the size of the picture,
// like discord's), with a still preview of each in assets/img/pfp-deco/previews. the list and their names
// are in assets/data/decorations.json. to add one, see "where do I change" in the README.
window.lonliiProfile = (() => {
  const DEFAULT_PFP = "/assets/img/lonelii.png";
  const decoUrl = (id) => `/assets/img/pfp-deco/${id}.png`;
  const decoPreview = (id) => `/assets/img/pfp-deco/previews/${id}.webp`;

  /* ---------- saved data ---------- */

  function get() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem("lonlii_profile")) ?? {};
    } catch {}
    let pfp = null;
    try {
      pfp = localStorage.getItem("lonlii_pfp");
    } catch {}
    return { name: (saved.name ?? "").trim(), deco: saved.deco ?? null, pfp };
  }

  function save(patch) {
    const { name, deco } = { ...get(), ...patch };
    try { localStorage.setItem("lonlii_profile", JSON.stringify({ name, deco })); } catch {}
    changed();
  }

  // pictures are squared and shrunk to 256px so they fit in localStorage. small gifs are kept as they
  // are so they stay animated.
  async function setPicture(file) {
    if (!file?.type.startsWith("image/")) throw new Error("That file isn't a picture.");
    let url;
    if (file.type === "image/gif" && file.size <= 1024 * 1024) {
      url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    } else {
      const img = await createImageBitmap(file).catch(() => {
        throw new Error("That picture couldn't be opened.");
      });
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      url = canvas.toDataURL("image/webp", 0.9);
      if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", 0.9); // older safari
    }
    try {
      localStorage.setItem("lonlii_pfp", url);
    } catch {
      throw new Error("That picture is too big to save. Try a smaller one.");
    }
    changed();
  }

  function removePicture() {
    try { localStorage.removeItem("lonlii_pfp"); } catch {}
    changed();
  }

  let decoList = null;
  const decorations = () => (decoList ??= fetch("/assets/data/decorations.json").then((r) => r.json()).catch(() => []));

  /* ---------- avatars ---------- */

  // an avatar that keeps itself up to date when the profile changes.
  //   size:  width in px of the picture (the decoration hangs 10% over each side)
  //   deco:  show this decoration instead of the saved one (undefined = saved, null = none)
  //   still: show the decoration's still preview, and only animate it on hover
  function avatar({ size = 32, deco, still = false } = {}) {
    const el = document.createElement("span");
    el.className = "lonlii-avatar";
    el.style.setProperty("--size", `${size}px`);
    const pfp = new Image();
    pfp.className = "pfp";
    pfp.alt = "";
    pfp.draggable = false;
    const ring = new Image();
    ring.className = "deco";
    ring.alt = "";
    ring.draggable = false;
    el.append(pfp, ring);
    if (deco !== undefined) el.dataset.deco = deco ?? "";
    if (still) {
      el.dataset.still = "";
      el.addEventListener("mouseenter", () => el.dataset.decoId && (ring.src = decoUrl(el.dataset.decoId)));
      el.addEventListener("mouseleave", () => el.dataset.decoId && (ring.src = decoPreview(el.dataset.decoId)));
    }
    draw(el);
    return el;
  }

  function draw(el, profile = get()) {
    const [pfp, ring] = el.children;
    pfp.src = profile.pfp || DEFAULT_PFP;
    el.classList.toggle("is-default", !profile.pfp);
    const id = "deco" in el.dataset ? el.dataset.deco || null : profile.deco;
    el.dataset.decoId = id ?? "";
    ring.hidden = !id;
    if (id) {
      const src = "still" in el.dataset ? decoPreview(id) : decoUrl(id);
      if (!ring.src.endsWith(src)) ring.src = src;
    }
  }

  function changed() {
    const profile = get();
    document.querySelectorAll(".lonlii-avatar").forEach((el) => draw(el, profile));
    window.dispatchEvent(new CustomEvent("lonlii:profile", { detail: profile }));
  }

  // another page (or a lonlii page inside this one) changed it
  window.addEventListener("storage", (e) => {
    if (e.key === "lonlii_profile" || e.key === "lonlii_pfp" || e.key === null) changed();
  });

  /* ---------- the settings panel (settings → profile) ---------- */

  async function wirePanel() {
    const panel = document.getElementById("settings-profile");
    if (!panel) return;

    const status = document.getElementById("profileStatus");
    const say = (text, isError = false) => {
      status.textContent = text;
      status.classList.toggle("error", isError);
    };

    document.getElementById("profilePreview").append(avatar({ size: 88 }));
    const nameInput = document.getElementById("profileName");
    const nameShow = document.getElementById("profileNameShow");
    const decoName = document.getElementById("profileDecoName");
    const list = await decorations();

    function refresh(profile = get()) {
      nameShow.textContent = profile.name || "you";
      decoName.textContent = profile.deco ? list.find((d) => d.id === profile.deco)?.name ?? "" : "No decoration";
      if (document.activeElement !== nameInput) nameInput.value = profile.name;
      document.getElementById("pfpRemove").disabled = !profile.pfp;
      grid.querySelectorAll("[data-id]").forEach((b) => b.classList.toggle("on", (b.dataset.id || null) === profile.deco));
    }

    nameInput.addEventListener("input", () => save({ name: nameInput.value.slice(0, 24) }));

    const file = document.getElementById("pfpFile");
    document.getElementById("pfpUpload").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const chosen = file.files[0];
      file.value = "";
      if (!chosen) return;
      try {
        await setPicture(chosen);
        say("");
        window.showToast?.("success", "Profile picture updated", "ri-user-smile-line");
      } catch (e) {
        say(e.message, true);
      }
    });
    document.getElementById("pfpRemove").addEventListener("click", () => {
      removePicture();
      say("");
    });

    // the decorations grid: still previews, animated while you hover one
    const grid = document.getElementById("decoGrid");
    for (const d of [{ id: "", name: "None" }, ...list]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "deco-option";
      button.dataset.id = d.id;
      button.title = d.name;
      const label = document.createElement("span");
      label.textContent = d.name;
      button.append(avatar({ size: 56, deco: d.id || null, still: true }), label);
      button.addEventListener("click", () => save({ deco: d.id || null }));
      grid.append(button);
    }

    window.addEventListener("lonlii:profile", (e) => refresh(e.detail));
    refresh();
  }

  // the little avatar in lonlii's nav bar
  function wireNav() {
    const spot = document.getElementById("navAvatar");
    if (spot) spot.append(avatar({ size: 26 }));
  }

  function start() {
    wireNav();
    wirePanel();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  return { get, save, setPicture, removePicture, avatar, decorations, DEFAULT_PFP };
})();
