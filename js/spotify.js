// Spotify Web API remote control, using each user's OWN Spotify app (Client ID) + PKCE.
// No server, no secrets: tokens live only in this browser's localStorage.

const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing";
const API = "https://api.spotify.com/v1";
const K = { client: "cd.spotify.clientId", tok: "cd.spotify.token", verifier: "cd.spotify.verifier" };

export const redirectUri = () => location.origin + location.pathname;

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

export const getClientId = () => ls.get(K.client) || "";
export const setClientId = (id) => ls.set(K.client, id.trim());
export const isLoggedIn = () => !!ls.get(K.tok);
export function logout() { ls.set(K.tok, null); }

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function login() {
  const clientId = getClientId();
  if (!/^[0-9a-f]{32}$/i.test(clientId)) throw new Error("That doesn't look like a Spotify Client ID (32 letters/numbers).");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  ls.set(K.verifier, verifier);
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, scope: SCOPES, redirect_uri: redirectUri(),
    code_challenge_method: "S256", code_challenge: challenge,
  });
  location.assign("https://accounts.spotify.com/authorize?" + q);
}

/** Call on page load. Returns an error message string if the redirect carried one. */
export async function handleRedirect() {
  const p = new URLSearchParams(location.search);
  if (!p.has("code") && !p.has("error")) return null;
  history.replaceState(null, "", redirectUri());
  if (p.has("error")) return "Spotify login was cancelled (" + p.get("error") + ").";
  const verifier = ls.get(K.verifier);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: p.get("code"), redirect_uri: redirectUri(),
      client_id: getClientId(), code_verifier: verifier || "",
    }),
  });
  if (!res.ok) return "Spotify login failed: " + (await res.text());
  saveToken(await res.json());
  ls.set(K.verifier, null);
  return null;
}

function saveToken(t, old = {}) {
  ls.set(K.tok, JSON.stringify({
    access: t.access_token,
    refresh: t.refresh_token || old.refresh,
    expires: Date.now() + (t.expires_in - 60) * 1000,
  }));
}

let refreshing = null;
async function accessToken() {
  const raw = ls.get(K.tok);
  if (!raw) throw new NotLoggedIn();
  const tok = JSON.parse(raw);
  if (Date.now() < tok.expires) return tok.access;
  refreshing ??= (async () => {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh, client_id: getClientId() }),
    });
    if (!res.ok) { logout(); throw new NotLoggedIn(); }
    saveToken(await res.json(), tok);
  })().finally(() => (refreshing = null));
  await refreshing;
  return JSON.parse(ls.get(K.tok)).access;
}

export class NotLoggedIn extends Error { constructor() { super("Not logged in to Spotify"); } }

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: "Bearer " + (await accessToken()), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { logout(); throw new NotLoggedIn(); }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error?.message || "Spotify error " + res.status);
    err.status = res.status; err.reason = data?.error?.reason;
    throw err;
  }
  return data;
}

/** Current playback, normalised. Returns null when nothing is active. */
export async function nowPlaying() {
  const s = await api("GET", "/me/player?additional_types=episode");
  if (!s || !s.item) return s ? { isPlaying: false, title: "Nothing playing", artist: "", art: "", device: s.device?.name } : null;
  const it = s.item;
  return {
    isPlaying: s.is_playing,
    title: it.name,
    artist: it.artists ? it.artists.map((a) => a.name).join(", ") : it.show?.name || "",
    art: (it.album?.images || it.images || [])[0]?.url || "",
    device: s.device?.name,
  };
}

/** Runs a playback command; if no device is active, wakes the most recent one. */
async function command(method, path) {
  try {
    await api(method, path);
  } catch (e) {
    if (e.status !== 404 && e.reason !== "NO_ACTIVE_DEVICE") throw e;
    const { devices } = await api("GET", "/me/player/devices");
    const target = devices.find((d) => d.type === "Smartphone") || devices[0];
    if (!target) throw new Error("Open the Spotify app on this phone first, then try again.");
    await api("PUT", "/me/player", { device_ids: [target.id], play: true });
  }
}

export const play = () => command("PUT", "/me/player/play");
export const pause = () => api("PUT", "/me/player/pause");
export const next = () => command("POST", "/me/player/next");
export const previous = () => command("POST", "/me/player/previous");
