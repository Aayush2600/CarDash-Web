// Map (MapLibre + OpenFreeMap), routing (Valhalla on FOSSGIS servers) and turn-by-turn guidance.

const STYLE = "https://tiles.openfreemap.org/styles/dark";
const VALHALLA = "https://valhalla1.openstreetmap.de/route";
const DEFAULT_CENTER = [72.8777, 19.076]; // Mumbai, until GPS locks

const $ = (id) => document.getElementById(id);
const toRad = (d) => (d * Math.PI) / 180;

// ---------- geometry helpers (metres, good enough at city scale) ----------
function dist(a, b) {
  const x = toRad(b[0] - a[0]) * Math.cos(toRad((a[1] + b[1]) / 2));
  const y = toRad(b[1] - a[1]);
  return Math.hypot(x, y) * 6371000;
}
function bearing(a, b) {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
/** Projects p onto segment a-b. Returns {d: distance m, t: 0..1} */
function project(p, a, b) {
  const k = Math.cos(toRad(p[1]));
  const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = p[0] * k, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { t, d: dist(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) };
}
/** Valhalla encodes shapes as polyline with 6 decimal places. Returns [[lon,lat],...] */
function decodePolyline6(str) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, byte;
      do { byte = str.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lon += delta;
    }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

export function formatDistance(m) {
  if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 1) + " km";
  if (m >= 100) return Math.round(m / 50) * 50 + " m";
  return Math.max(0, Math.round(m / 10) * 10) + " m";
}

// ---------- maneuver arrows ----------
const ARROW = '<svg viewBox="0 0 24 24"><path d="M12 2 5 10h5v12h4V10h5z"/></svg>';
const ICONS = {
  roundabout: '<svg viewBox="0 0 24 24"><path d="M12 6a6 6 0 1 0 6 6h-3a3 3 0 1 1-3-3V6Zm-1-4v9h2V2h-2Z"/></svg>',
  arrive: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"/></svg>',
};
const ROTATION = { 9: 45, 10: 90, 11: 135, 12: 180, 13: 180, 14: -135, 15: -90, 16: -45,
  18: 45, 19: -45, 20: 45, 21: -45, 23: 30, 24: -30, 37: 30, 38: -30, 2: 90, 3: -90 };
function maneuverIcon(type) {
  if ([4, 5, 6].includes(type)) return ICONS.arrive;
  if ([26, 27].includes(type)) return ICONS.roundabout;
  const r = ROTATION[type] || 0;
  return `<div style="transform:rotate(${r}deg);width:100%;height:100%">${ARROW}</div>`;
}

// ---------- the navigator ----------
export class Nav {
  constructor({ onToast }) {
    this.toast = onToast;
    this.voice = true;
    this.simulate = false;
    this.avoidTolls = false;
    this.following = true;
    this.pos = null;          // [lon, lat]
    this.heading = 0;
    this.route = null;
    this.state = "idle";      // idle | routing | navigating
    this.offRouteCount = 0;
    this.lastReroute = 0;

    this.map = new maplibregl.Map({
      container: "map", style: STYLE, center: DEFAULT_CENTER, zoom: 12,
      attributionControl: { compact: true }, pitchWithRotate: false,
    });
    const el = document.createElement("div");
    el.className = "me";
    this.marker = new maplibregl.Marker({ element: el, rotationAlignment: "map" });
    this.map.on("dragstart", () => (this.following = false));
    this.map.on("load", () => this.addRouteLayer());
  }

  addRouteLayer() {
    this.map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({ id: "route-casing", type: "line", source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#0a4a8f", "line-width": 12 } });
    this.map.addLayer({ id: "route-line", type: "line", source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#3d9bff", "line-width": 7 } });
  }

  // ---------- position ----------
  startGPS() {
    if (!("geolocation" in navigator)) return this.toast("This browser has no GPS access.");
    this.watchId = navigator.geolocation.watchPosition(
      (p) => { if (!this.simulate || this.state !== "navigating") this.onPosition([p.coords.longitude, p.coords.latitude], p.coords.heading, p.coords.speed); },
      (e) => this.toast(e.code === 1 ? "Location is blocked. Allow it in your browser settings to navigate." : "Waiting for GPS…"),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }

  onPosition(p, heading, speed) {
    const prev = this.pos;
    this.pos = p;
    if (speed != null && !Number.isNaN(speed)) this.speed = speed;
    if (heading != null && !Number.isNaN(heading) && (speed == null || speed > 1)) this.heading = heading;
    else if (prev && dist(prev, p) > 3) this.heading = bearing(prev, p);

    const el = this.marker.getElement();
    el.classList.toggle("heading", this.state === "navigating");
    this.marker.setLngLat(p).setRotation(this.state === "navigating" ? this.heading : 0);
    if (!this.marker._map) {
      this.marker.addTo(this.map);
      this.map.jumpTo({ center: p, zoom: 15 });
    }
    if (this.state === "navigating") this.guide();
  }

  recenter() {
    this.following = true;
    if (!this.pos) return this.toast("Waiting for your location…");
    if (this.state === "navigating") this.follow(true);
    else this.map.easeTo({ center: this.pos, zoom: 15, bearing: 0, pitch: 0 });
  }

  follow(force) {
    if (!this.following && !force) return;
    const portrait = innerHeight > innerWidth;
    this.map.easeTo({
      center: this.pos, bearing: this.heading, zoom: 16.5, pitch: 50, duration: 900,
      padding: { top: portrait ? 260 : 180, bottom: 40, left: 0, right: 0 },
    });
  }

  // ---------- routing ----------
  async navigateTo(dest) {
    const origin = this.pos || this.map.getCenter().toArray();
    if (!this.pos) this.onPosition(origin, null, null);
    this.destination = dest;
    this.setState("routing", "Finding route to " + dest.name + "…");
    try {
      await this.fetchRoute(origin);
      this.setState("navigating");
      this.following = true;
      this.say(this.route.maneuvers[0]?.verbal_pre_transition_instruction);
      this.guide();
      if (this.simulate) this.startSimulation();
    } catch (e) {
      this.setState("idle");
      this.toast(e.message);
    }
  }

  async fetchRoute(origin) {
    const req = {
      locations: [
        { lon: origin[0], lat: origin[1], ...(this.state === "navigating" ? { heading: Math.round(this.heading), heading_tolerance: 45 } : {}) },
        { lon: this.destination.lon, lat: this.destination.lat },
      ],
      costing: "auto",
      costing_options: { auto: { use_ferry: 0, use_tolls: this.avoidTolls ? 0 : 0.5 } },
      directions_options: { units: "kilometers", language: "en-US" },
    };
    let res;
    try {
      res = await fetch(VALHALLA + "?json=" + encodeURIComponent(JSON.stringify(req)));
    } catch {
      throw new Error("Can't reach the routing server. Check your internet connection.");
    }
    if (res.status === 429) throw new Error("Routing server is busy. Try again in a minute.");
    const data = await res.json();
    if (!res.ok || !data.trip) throw new Error("No route found" + (data.error ? ": " + data.error : "."));

    const leg = data.trip.legs[0];
    const shape = decodePolyline6(leg.shape);
    const cum = [0];
    for (let i = 1; i < shape.length; i++) cum.push(cum[i - 1] + dist(shape[i - 1], shape[i]));
    this.route = {
      shape, cum, maneuvers: leg.maneuvers, total: cum[cum.length - 1],
      time: data.trip.summary.time, seg: 0, announced: new Set(),
    };
    this.map.getSource("route")?.setData({ type: "Feature", geometry: { type: "LineString", coordinates: shape } });
  }

  stop() {
    clearInterval(this.simTimer);
    this.route = null;
    this.map.getSource("route")?.setData({ type: "FeatureCollection", features: [] });
    this.setState("idle");
    if (this.pos) this.map.easeTo({ center: this.pos, zoom: 15, bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.marker.getElement().classList.remove("heading");
    speechSynthesis?.cancel();
  }

  // ---------- guidance ----------
  guide() {
    const r = this.route;
    if (!r) return;
    // Find closest segment, searching a little behind and ahead of the last one.
    let best = { d: Infinity, i: r.seg, t: 0 };
    const from = Math.max(0, r.seg - 5), to = Math.min(r.shape.length - 1, r.seg + 300);
    for (let i = from; i < to; i++) {
      const pr = project(this.pos, r.shape[i], r.shape[i + 1]);
      if (pr.d < best.d) best = { d: pr.d, i, t: pr.t };
    }
    if (best.d > 50) {
      if (++this.offRouteCount >= 3 && Date.now() - this.lastReroute > 15000) return this.reroute();
    } else {
      this.offRouteCount = 0;
      r.seg = best.i;
    }
    const progress = r.cum[best.i] + best.t * (r.cum[best.i + 1] - r.cum[best.i]);
    const remaining = r.total - progress;

    if (remaining < 25) {
      this.say("You have arrived at " + this.destination.name);
      this.toast("Arrived: " + this.destination.name);
      return this.stop();
    }

    const idx = r.maneuvers.findIndex((m) => r.cum[m.begin_shape_index] > progress + 5);
    const m = r.maneuvers[idx];
    if (m) {
      const toTurn = r.cum[m.begin_shape_index] - progress;
      $("nav-arrow").innerHTML = maneuverIcon(m.type);
      $("nav-distance").textContent = formatDistance(toTurn);
      $("nav-instruction").textContent = m.instruction;
      // Voice: an early alert, then the "now" prompt. Earlier on fast roads.
      const far = this.speed > 20 ? 800 : 400;
      if (toTurn < far && toTurn > 200 && !r.announced.has(idx + "a") && m.verbal_transition_alert_instruction) {
        r.announced.add(idx + "a");
        this.say("In " + formatDistance(toTurn).replace(" m", " meters").replace(" km", " kilometers") + ", " + m.verbal_transition_alert_instruction);
      }
      if (toTurn < (this.speed > 20 ? 150 : 70) && !r.announced.has(idx + "n")) {
        r.announced.add(idx + "n");
        this.say(m.verbal_pre_transition_instruction);
      }
    }

    const minutes = Math.max(1, Math.round((r.time * remaining) / r.total / 60));
    $("eta-time").textContent = minutes;
    $("eta-dist").textContent = (remaining / 1000).toFixed(remaining < 10000 ? 1 : 0);
    $("eta-arrival").textContent = new Date(Date.now() + minutes * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    this.follow();
  }

  async reroute() {
    this.lastReroute = Date.now();
    this.offRouteCount = 0;
    this.say("Rerouting");
    try {
      await this.fetchRoute(this.pos);
      if (this.simulate) this.startSimulation();
    } catch (e) {
      this.toast(e.message);
    }
  }

  say(text) {
    if (!this.voice || !text || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // ---------- simulation (testing without driving) ----------
  startSimulation() {
    clearInterval(this.simTimer);
    const r = this.route;
    let travelled = 0;
    this.speed = 14; // m/s ≈ 50 km/h
    this.simTimer = setInterval(() => {
      if (this.route !== r) return clearInterval(this.simTimer);
      travelled += this.speed;
      let i = r.cum.findIndex((c) => c > travelled);
      if (i <= 0) i = r.cum.length - 1;
      const a = r.shape[i - 1], b = r.shape[i];
      const segLen = r.cum[i] - r.cum[i - 1] || 1;
      const t = Math.min(1, (travelled - r.cum[i - 1]) / segLen);
      this.onPosition([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing(a, b), this.speed);
    }, 1000);
  }

  // ---------- UI state ----------
  setState(state, status) {
    this.state = state;
    const nav = state === "navigating";
    $("map-area").classList.toggle("navigating", nav);
    $("nav-banner").hidden = !nav;
    $("nav-footer").hidden = !nav;
    $("btn-end").hidden = !nav;
    $("btn-where").hidden = state !== "idle";
    $("nav-status").hidden = !status;
    $("nav-status").textContent = status || "";
  }
}
