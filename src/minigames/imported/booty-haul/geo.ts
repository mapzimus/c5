/**
 * The chart: a Mercator world on the 1280x720 canvas, plus the real-world
 * doors, lanes and ports the ships ride. Coordinates are [lat, lng] pairs,
 * the same convention as the Whydah-Unit original.
 */

export type LatLng = readonly [number, number];

export interface Point {
  x: number;
  y: number;
}

export const EARTH_KM = 6371;
const TO_RAD = Math.PI / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * TO_RAD;
  const dLng = (b[1] - a[1]) * TO_RAD;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a[0] * TO_RAD) * Math.cos(b[0] * TO_RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Straight-line blend between two points, good enough for a sloop crossing the chart. */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// ---- globe (orthographic) projection ------------------------------------

export interface Globe {
  cx: number;
  cy: number;
  radius: number;
  lat: number;
  lng: number;
  sinLat: number;
  cosLat: number;
  lngRad: number;
}

export interface Projected {
  x: number;
  y: number;
  z: number;
}

export function makeGlobe(cx: number, cy: number, radius: number, lat: number, lng: number): Globe {
  return {
    cx, cy, radius, lat, lng,
    sinLat: Math.sin(lat * TO_RAD),
    cosLat: Math.cos(lat * TO_RAD),
    lngRad: lng * TO_RAD,
  };
}

export function globeProject(ll: LatLng, g: Globe): Projected {
  const lat = ll[0] * TO_RAD;
  const dLng = ll[1] * TO_RAD - g.lngRad;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosDLng = Math.cos(dLng);
  return {
    x: g.cx + g.radius * cosLat * Math.sin(dLng),
    y: g.cy - g.radius * (g.cosLat * sinLat - g.sinLat * cosLat * cosDLng),
    z: g.sinLat * sinLat + g.cosLat * cosLat * cosDLng,
  };
}

export function globeUnproject(px: number, py: number, g: Globe): LatLng | null {
  const nx = (px - g.cx) / g.radius;
  const ny = -(py - g.cy) / g.radius;
  const r2 = nx * nx + ny * ny;
  if (r2 > 1) return null;
  const nz = Math.sqrt(1 - r2);
  const lat = Math.asin(ny * g.cosLat + nz * g.sinLat);
  const lng = g.lngRad + Math.atan2(nx, nz * g.cosLat - ny * g.sinLat);
  return [lat / TO_RAD, lng / TO_RAD];
}

export function globeRangeCircle(center: LatLng, radiusKm: number, g: Globe, segments = 48): Projected[] {
  const angularRadius = radiusKm / EARTH_KM;
  const cLat = center[0] * TO_RAD;
  const cLng = center[1] * TO_RAD;
  const pts: Projected[] = [];
  for (let i = 0; i < segments; i++) {
    const bearing = (i / segments) * Math.PI * 2;
    const lat = Math.asin(
      Math.sin(cLat) * Math.cos(angularRadius) +
      Math.cos(cLat) * Math.sin(angularRadius) * Math.cos(bearing),
    );
    const lng = cLng + Math.atan2(
      Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(cLat),
      Math.cos(angularRadius) - Math.sin(cLat) * Math.sin(lat),
    );
    pts.push(globeProject([lat / TO_RAD, lng / TO_RAD], g));
  }
  return pts;
}

// ---- the doors -----------------------------------------------------------

export interface Door {
  key: string;
  ll: LatLng;
  name: string;
  blurb: string;
  /** Label placement on the chart. */
  align: CanvasTextAlign;
  dx: number;
  dy: number;
}

export const DOORS: readonly Door[] = [
  { key: "dover", ll: [51.0, 1.4], name: "Dover", blurb: "Busiest lane on Earth: hundreds of ships a day through a 21-mile gap.", align: "right", dx: -9, dy: -8 },
  { key: "gibraltar", ll: [35.95, -5.6], name: "Gibraltar", blurb: "The Atlantic's door into the Med, 8 miles wide at the pinch.", align: "right", dx: -9, dy: 14 },
  { key: "suez", ll: [30.5, 32.4], name: "Suez", blurb: "One canal through a desert. About 12% of world trade squeezes through.", align: "left", dx: 9, dy: -6 },
  { key: "bab", ll: [12.6, 43.3], name: "Bab-el-Mandeb", blurb: "The Red Sea's narrow south door.", align: "right", dx: -9, dy: 4 },
  { key: "hormuz", ll: [26.6, 56.5], name: "Hormuz", blurb: "The Persian Gulf's only exit. A fifth of the world's oil sails this bend.", align: "left", dx: 9, dy: -6 },
  { key: "malacca", ll: [2.5, 101.5], name: "Malacca", blurb: "A third of global shipping rides this one strait past Singapore.", align: "right", dx: -9, dy: -6 },
  { key: "panama", ll: [9.1, -79.7], name: "Panama", blurb: "A shortcut cut through a continent.", align: "right", dx: -9, dy: 12 },
  { key: "windward", ll: [19.9, -73.9], name: "Windward Passage", blurb: "1717's door: the gap between Cuba and Hispaniola where Bellamy took the Whydah.", align: "left", dx: 9, dy: 12 },
  { key: "florida", ll: [23.9, -81.0], name: "Florida Straits", blurb: "1717's treasure highway. Spanish silver fleets rode the Gulf Stream home here.", align: "right", dx: -9, dy: -8 },
  { key: "boston", ll: [42.3, -70.6], name: "Boston", blurb: "Every ship into Boston or Salem threads these lanes past Cape Cod.", align: "left", dx: 9, dy: -8 },
  { key: "goodhope", ll: [-34.8, 19.0], name: "Good Hope", blurb: "Not a strait, a corner. When Suez closes the world sails all the way down here.", align: "center", dx: 0, dy: 18 },
];

export function nearestDoor(ll: LatLng): { door: Door; km: number } {
  let best = DOORS[0]!;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const door of DOORS) {
    const km = haversineKm(door.ll, ll);
    if (km < bestKm) {
      bestKm = km;
      best = door;
    }
  }
  return { door: best, km: bestKm };
}

/** "near Dover" or "open ocean", for the results line. */
export function whereLabel(ll: LatLng): string {
  const { door, km } = nearestDoor(ll);
  return km < 900 ? `near ${door.name}` : "open ocean";
}

// ---- the lanes -----------------------------------------------------------

export interface LaneSpec {
  /** Ships on this lane at the start. */
  n: number;
  pts: readonly LatLng[];
}

/**
 * Simplified real-world lanes from the original game. Not live data, but the
 * shape is true: this is where ships go. Split at the date line so nothing wraps.
 */
export const LANES: readonly LaneSpec[] = [
  /* Europe → Suez → Malacca → East Asia trunk */
  { n: 20, pts: [[51.2,2.2],[51.0,1.4],[50.2,-0.5],[49.8,-3],[49.3,-6.5],[48.3,-9],[44,-10.5],[39,-10.5],[36.5,-8],[35.95,-5.6],[36.5,-2],[37.2,3],[37.6,9.5],[36.5,14.5],[34.5,20],[33,26],[31.9,31.9],[30.5,32.4],[29.6,32.6],[27.8,33.8],[24,36.5],[20,38.5],[15.5,41.5],[12.6,43.3],[12.3,45],[12,48.5],[13,52.5],[11.5,58],[9,66],[7,74],[6,81],[5.8,88],[6,95],[4.5,98.5],[2.8,100.5],[1.4,103.0],[1.15,103.9],[1.4,105],[3,107.5],[6.5,109.5],[11,110.8],[15,111.8],[19,113.5],[22,116],[24.5,119.5],[27,122.5]] },
  /* New York → North Atlantic → Dover */
  { n: 8, pts: [[40.4,-73.6],[40.9,-70.5],[41.1,-68.5],[42.5,-63],[44.5,-56],[47,-45],[49,-30],[49.3,-15],[49.3,-6.5],[49.8,-3],[50.2,-0.5],[51.0,1.4],[51.2,2.2]] },
  /* Tokyo → date line (east) */
  { n: 4, pts: [[34.8,139.9],[34.5,150],[35,165],[35.5,179.9]] },
  /* date line → Panama → US East Coast */
  { n: 8, pts: [[35.5,-179.9],[33,-150],[28,-138],[20,-128],[13,-113],[8.5,-103],[7.3,-98],[7.9,-89.5],[9.35,-79.95],[9.1,-79.5],[9.6,-78.5],[11,-77],[13,-74.5],[16,-74],[19.9,-73.9],[22.2,-72.8],[24.5,-74.2],[26.8,-77.5],[28.5,-79.8],[31,-79.2],[33.5,-77.5],[35.2,-75.4],[38,-74.5],[40.4,-73.6]] },
  /* Houston → Straits of Florida → East Coast */
  { n: 7, pts: [[28.8,-94],[27.8,-90],[26,-86.5],[24.6,-83.5],[23.8,-81.5],[23.9,-80.5],[25,-79.6],[26.4,-79],[28.5,-80],[31,-80.3],[33.5,-77.5],[35.2,-75.4],[38,-74.5],[40.4,-73.6]] },
  /* Boston approach */
  { n: 5, pts: [[40.8,-68.5],[41.6,-69.3],[42.1,-70.2],[42.34,-70.78]] },
  /* Cape of Good Hope → East Africa → Gulf of Aden */
  { n: 7, pts: [[-35.5,16],[-34.8,19],[-35.2,23],[-34,28],[-30,33.5],[-24,36.5],[-16,41.5],[-9,42],[-2,43.5],[5,48.5],[10.5,52.5],[13,52.5]] },
  /* Persian Gulf → Hormuz → Arabian Sea */
  { n: 7, pts: [[27.5,50.3],[26.5,52.5],[26.2,55],[26.6,56.5],[25.5,57.5],[24,59.5],[21.5,61.5],[16,59],[13,55],[13,52.5]] },
  /* Caribbean → Windward → Straits of Florida → Gulf */
  { n: 5, pts: [[18.0,-64.5],[17.8,-68],[18.1,-71.5],[19.9,-73.9],[20.7,-74.6],[21.5,-76.5],[22.5,-78.5],[23.2,-80.2],[23.9,-80.9],[24.6,-82.5],[26,-86.5],[27.8,-90],[28.8,-94]] },
  /* Santos (Brazil) → Gibraltar */
  { n: 6, pts: [[-24.1,-46.1],[-25.5,-44],[-23,-40],[-18,-36],[-11,-33],[-4,-31],[3,-28],[11,-24],[19,-20],[26,-16],[31,-12],[34.5,-8.5],[35.95,-5.9]] },
  /* Lagos → West Africa → Channel approaches */
  { n: 6, pts: [[6.2,3.3],[5.2,0],[4.3,-4],[4.4,-8],[6,-12],[9.5,-15.5],[14,-17.8],[19,-18.5],[24,-17],[28.5,-14.5],[32.5,-11],[35,-9.8],[38,-10],[43,-10.2],[48.3,-9],[49.3,-6.5]] },
  /* Gibraltar → Marseille → Genoa */
  { n: 4, pts: [[35.95,-5.3],[36.7,-2],[38.5,1],[40.2,4],[42.5,5.8],[43.2,7.5],[44,8.8]] },
  /* Eastern Med → Aegean → Istanbul */
  { n: 4, pts: [[33.5,28.5],[34.5,27],[36.3,25.8],[38.5,25.5],[39.9,25.9],[40.2,26.3],[40.4,27.2],[40.8,28.6],[41.05,29.0]] },
  /* Colombo → Mumbai coastal */
  { n: 4, pts: [[5.8,80.5],[6.2,78],[7.5,76.3],[10,75.3],[13.5,73.8],[16.5,72.9],[18.9,72.7]] },
  /* Singapore → Jakarta */
  { n: 3, pts: [[1.1,103.9],[-0.5,105.5],[-3,106.8],[-5.8,106.8]] },
  /* Shanghai → offshore Japan → Tokyo */
  { n: 5, pts: [[31.2,122.7],[31.5,125.5],[31.2,128.5],[30.8,131],[31.5,133.5],[33,136.5],[34.3,138.5],[34.8,139.8]] },
  /* Los Angeles → date line (west) */
  { n: 5, pts: [[33.6,-118.3],[31.5,-127],[30.5,-138],[31.5,-150],[33,-163],[34.5,-172],[35.4,-179.9]] },
  /* date line → Seattle (North Pacific great circle) */
  { n: 3, pts: [[52,-179.9],[52.5,-170],[52,-158],[51,-145],[49.5,-133],[48.4,-125.8]] },
  /* Tokyo → North Pacific → date line */
  { n: 3, pts: [[35.6,140.5],[38,146],[42,153],[46,162],[50,172],[52,179.9]] },
];

export interface Port {
  ll: LatLng;
  name: string;
}

/** Where voyages begin and end. Treasure fleets sail from one of these. */
export const PORTS: readonly Port[] = [
  { ll: [51.2, 2.2], name: "Rotterdam" },
  { ll: [27, 122.5], name: "Shanghai" },
  { ll: [40.4, -73.6], name: "New York" },
  { ll: [34.8, 139.9], name: "Tokyo" },
  { ll: [28.8, -94], name: "Houston" },
  { ll: [42.34, -70.78], name: "Boston" },
  { ll: [-35.5, 16], name: "Cape Town" },
  { ll: [27.5, 50.3], name: "Ras Tanura" },
  { ll: [18.0, -64.5], name: "San Juan" },
  { ll: [-24.1, -46.1], name: "Santos" },
  { ll: [6.2, 3.3], name: "Lagos" },
  { ll: [44, 8.8], name: "Genoa" },
  { ll: [41.05, 29.0], name: "Istanbul" },
  { ll: [18.9, 72.7], name: "Mumbai" },
  { ll: [5.8, 80.5], name: "Colombo" },
  { ll: [-5.8, 106.8], name: "Jakarta" },
  { ll: [33.6, -118.3], name: "Los Angeles" },
  { ll: [48.4, -125.8], name: "Seattle" },
];

// ---- lane geometry -------------------------------------------------------

export interface Lane {
  pts: readonly LatLng[];
  /** Cumulative km at each point. */
  cum: number[];
  lengthKm: number;
}

export function buildLanes(specs: readonly LaneSpec[] = LANES): Lane[] {
  return specs.map((spec) => {
    const cum = [0];
    for (let i = 1; i < spec.pts.length; i += 1) {
      cum.push(cum[i - 1]! + haversineKm(spec.pts[i - 1]!, spec.pts[i]!));
    }
    return { pts: spec.pts, cum, lengthKm: cum[cum.length - 1]! };
  });
}

/** Position `km` along a lane from its first point. */
export function lanePos(lane: Lane, km: number): LatLng {
  const pts = lane.pts;
  if (km <= 0) return pts[0]!;
  if (km >= lane.lengthKm) return pts[pts.length - 1]!;
  for (let i = 1; i < lane.cum.length; i += 1) {
    if (km <= lane.cum[i]!) {
      const seg = lane.cum[i]! - lane.cum[i - 1]!;
      const f = seg > 0 ? (km - lane.cum[i - 1]!) / seg : 0;
      return lerpLatLng(pts[i - 1]!, pts[i]!, f);
    }
  }
  return pts[pts.length - 1]!;
}

/** Lanes that start or end at this port, with the direction that sails away from it. */
export function lanesFromPort(lanes: readonly Lane[], port: LatLng): { lane: number; dir: 1 | -1 }[] {
  const out: { lane: number; dir: 1 | -1 }[] = [];
  lanes.forEach((lane, index) => {
    if (haversineKm(lane.pts[0]!, port) < 60) out.push({ lane: index, dir: 1 });
    else if (haversineKm(lane.pts[lane.pts.length - 1]!, port) < 60) out.push({ lane: index, dir: -1 });
  });
  return out;
}
