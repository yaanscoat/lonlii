// the little message under "lonlii" on the homepage, picked at random on every load
const splashes = [
  "i hate typescript javascript better",
  "yoo wsg!?",
  "fatality..",
  "u larp donntcha",
  "GOO TO THE GITHUBBBB",
  "this has to work right?",
  "ur the best bro!",
  "ocean the real mvp dawg",
  "made by yaanscoat",
  "say when.",
  "sorry for no extra stuff this is a backup proxy ¬_¬",
  "built different™",
  "probably harmless",
  "github ahh",
  "w speed",
  "7 billion downloads (trust)",
  "0 days since incident",
  "the mitochondria wins",
  "my source is vibes",
  "W electricity",
  "bro has an IP address",
  "running Doom on a fridge",
  "1 gazillion FPS",
  "NASA funded this",
  "made by three raccoons",
  "50% code 50% prayer",
  "written in pure hatred",
  "certified sillyware",
  "w developer",
  "bro invented blinking",
  "CEO of nothing",
  "professional tab opener",
  "internet explorer speedrun",
];

// this one lives up to its word
const RARE_SPLASH = "you have a 0.1% chance of getting this message";

const splashText =
  Math.random() < 0.001
    ? RARE_SPLASH
    : splashes[Math.floor(Math.random() * splashes.length)];

document.getElementById("splash").textContent = splashText;
