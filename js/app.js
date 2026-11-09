import * as spotify from "./spotify.js";
import { Nav } from "./nav.js";
import { searchPlaces } from "./search.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("cd." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("cd." + k, JSON.stringify(v)); } catch {} },
};

// ---------- toast ----------
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- clock ----------
function tick() { $("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
tick();
setInterval(tick, 10000);

// ---------- sheets ----------
function openSheet(id) { $(id).hidden = false; }
function closeSheet(el) { el.closest(".sheet").hidden = true; }
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeSheet(b)));
document.querySelectorAll(".sheet").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s) s.hidden = true; }));

// ---------- navigation ----------
const nav = new Nav({ onToast: toast });
nav.voice = store.get("voice", true);
nav.simulate = store.get("sim", false);
nav.avoidTolls = store.get("tolls", false);
nav.startGPS();

$("btn-where").onclick = $("dock-search").onclick = () => {
  openSheet("sheet-search");
  setTimeout(() => $("search-input").focus(), 50);
};
$("btn-end").onclick = () => nav.stop();
$("btn-recenter").onclick = () => nav.recenter();

// ---------- search ----------
let searchTimer, searchAbort;
$("search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(e.target.value), 350);
});
async function runSearch(q) {
  searchAbort?.abort();
  searchAbort = new AbortController();
  const list = $("search-results");
  try {
    const results = await searchPlaces(q, nav.pos || nav.map.getCenter().toArray(), searchAbort.signal);
    list.replaceChildren(...results.map((r) => {
      const li = document.createElement("li");
      const b = document.createElement("b"); b.textContent = r.name;
      const s = document.createElement("small"); s.textContent = r.sub;
      li.append(b, s);
      li.onclick = () => {
        $("sheet-search").hidden = true;
        $("search-input").value = "";
        list.replaceChildren();
        nav.navigateTo(r);
      };
      return li;
    }));
    $("search-hint").textContent = results.length || q.trim().length < 3 ? "Search powered by OpenStreetMap (Photon)." : "No places found.";
  } catch (e) {
    if (e.name !== "AbortError") $("search-hint").textContent = e.message;
  }
}

// ---------- settings ----------
const bindToggle = (id, key, apply) => {
  const el = $(id);
  el.checked = store.get(key, el.checked);
  el.onchange = () => { store.set(key, el.checked); apply(el.checked); };
};
bindToggle("set-voice", "voice", (v) => (nav.voice = v));
bindToggle("set-sim", "sim", (v) => (nav.simulate = v));
bindToggle("set-tolls", "tolls", (v) => (nav.avoidTolls = v));
$("dock-settings").onclick = () => openSheet("sheet-settings");
$("set-spotify-setup").onclick = () => { $("sheet-settings").hidden = true; openSpotifySetup(); };
$("set-logout").onclick = () => { spotify.logout(); refreshMusic(); toast("Logged out of Spotify"); };

// ---------- Spotify setup ----------
function openSpotifySetup() {
  $("redirect-uri").textContent = spotify.redirectUri();
  $("client-id").value = spotify.getClientId();
  $("setup-msg").textContent = "";
  openSheet("sheet-spotify");
}
document.querySelectorAll(".copy").forEach((b) => {
  b.addEventListener("click", async () => {
    const text = b.dataset.copy ?? spotify.redirectUri();
    try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; }
    catch { b.textContent = "Select & copy"; }
    setTimeout(() => (b.textContent = "Copy"), 1500);
  });
});
$("btn-save-client").onclick = async () => {
  spotify.setClientId($("client-id").value);
  try { await spotify.login(); }
  catch (e) { $("setup-msg").textContent = e.message; }
};
$("btn-connect").onclick = () => (spotify.getClientId() ? spotify.login().catch((e) => toast(e.message)) : openSpotifySetup());
$("dock-music").onclick = () => { location.href = "spotify:"; };

// ---------- now playing ----------
let lastArt = "";
function renderMusic(np, msg) {
  const connected = spotify.isLoggedIn();
  $("btn-connect").hidden = connected;
  $("transport").hidden = !connected;
  $("title").textContent = !connected ? "Not connected" : np ? np.title : "Nothing playing";
  $("artist").textContent = np?.artist || "";
  $("music-msg").textContent = msg ?? (!connected ? "Connect your Spotify Premium" : !np ? "Open Spotify on this phone and press play" : "");
  $("ic-play").hidden = !!np?.isPlaying;
  $("ic-pause").hidden = !np?.isPlaying;
  const art = np?.art || "";
  if (art !== lastArt) {
    lastArt = art;
    $("art-img").hidden = !art;
    $("art-ph").style.display = art ? "none" : "";
    if (art) $("art-img").src = art;
  }
}

let current = null, polling = false;
async function refreshMusic() {
  if (!spotify.isLoggedIn()) return renderMusic(null);
  if (polling) return;
  polling = true;
  try {
    current = await spotify.nowPlaying();
    renderMusic(current);
  } catch (e) {
    renderMusic(current, e instanceof spotify.NotLoggedIn ? undefined : e.message);
  } finally {
    polling = false;
  }
}
setInterval(() => { if (!document.hidden) refreshMusic(); }, 3000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshMusic(); keepAwake(); } });

async function control(fn, optimistic) {
  if (current && optimistic) { current.isPlaying = optimistic === "play"; renderMusic(current); }
  try { await fn(); } catch (e) { toast(e.message); }
  setTimeout(refreshMusic, 400);
}
$("btn-play").onclick = () => current?.isPlaying ? control(spotify.pause, "pause") : control(spotify.play, "play");
$("btn-next").onclick = () => control(spotify.next);
$("btn-prev").onclick = () => control(spotify.previous);

// ---------- keep the screen on ----------
let wakeLock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.onrelease = () => (wakeLock = null); } } catch {}
}
document.addEventListener("click", keepAwake, { once: true });

// ---------- start ----------
(async () => {
  const err = await spotify.handleRedirect().catch((e) => e.message);
  if (err) toast(err, 6000);
  else if (spotify.isLoggedIn() && location.search === "") refreshMusic();
  renderMusic(null);
  refreshMusic();
})();

window.cardash = { nav, spotify }; // handy for debugging in the browser console

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
