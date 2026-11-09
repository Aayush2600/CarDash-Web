// Place search with Photon (OpenStreetMap data, free, no key). Biased to where you are.

const PHOTON = "https://photon.komoot.io/api/";

export async function searchPlaces(query, near, signal) {
  const q = query.trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, limit: "8", lang: "en" });
  if (near) {
    params.set("lon", near[0].toFixed(4));
    params.set("lat", near[1].toFixed(4));
    params.set("zoom", "12");                 // prefer results within roughly a city
    params.set("location_bias_scale", "0.5");
  }
  const res = await fetch(PHOTON + "?" + params, { signal });
  if (!res.ok) throw new Error("Search is unavailable right now (" + res.status + ").");
  const data = await res.json();
  return data.features.map((f) => {
    const p = f.properties;
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "Unnamed place";
    const sub = [p.street && p.name ? p.street : null, p.district, p.city, p.state, p.country]
      .filter((x, i, a) => x && x !== name && a.indexOf(x) === i).join(", ");
    return { name, sub, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  });
}
