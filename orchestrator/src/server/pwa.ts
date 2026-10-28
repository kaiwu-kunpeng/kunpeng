import { deflateSync } from "node:zlib";

export const MANIFEST = {
  name: "鲲鹏 · AI 研发与运营操作系统",
  short_name: "鲲鹏",
  start_url: "/#/overview",
  scope: "/",
  display: "standalone",
  background_color: "#FFF8F2",
  theme_color: "#8D4B00",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
} as const;

export const SERVICE_WORKER = `
var VENDOR_CACHE = "kp-vendor-v1";
var VENDOR_URLS = [
  "/vendor/cytoscape.min.js",
  "/vendor/elk.bundled.js",
  "/vendor/cytoscape-elk.js",
  "/vendor/xterm.min.js",
  "/vendor/xterm-addon-fit.min.js",
  "/vendor/xterm.min.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([
    self.skipWaiting(),
    caches.open(VENDOR_CACHE).then((cache) => cache.addAll(VENDOR_URLS)).catch(() => {})
  ]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.indexOf("kp-vendor-") === 0 && k !== VENDOR_CACHE).map((k) => caches.delete(k))))
  ]));
});

self.addEventListener("push", (event) => {
  event.waitUntil(fetch("/api/push/pending", { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) throw new Error("pending notifications unavailable");
      return response.json();
    })
    .then((payload) => {
      var notifications = payload && Array.isArray(payload.notifications) ? payload.notifications : [];
      return Promise.all(notifications.map((notification) => self.registration.showNotification(
        notification.title || "鲲鹏",
        {
          body: notification.body || "",
          data: { url: notification.url || "/" },
          tag: "kunpeng-" + (notification.kind || "event") + "-" + (notification.at || Date.now())
        }
      )));
    }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  var data = event.notification.data || {};
  var target = new URL(data.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    var client = windows.find((item) => item.url === target)
      || windows.find((item) => new URL(item.url).origin === self.location.origin);
    if (!client) return self.clients.openWindow(target);
    if (typeof client.navigate === "function" && client.url !== target) {
      return client.navigate(target).then((navigated) => (navigated || client).focus());
    }
    return client.focus();
  }));
});

self.addEventListener("fetch", (event) => {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf("/vendor/") !== 0) return;
  event.respondWith(caches.open(VENDOR_CACHE).then((cache) => cache.match(req).then((cached) => {
    var network = fetch(req).then((resp) => {
      if (resp && resp.status === 200) cache.put(req, resp.clone());
      return resp;
    }).catch(() => cached);
    return cached || network;
  })));
});
`.trim();

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export function iconPng(size: number): Buffer {
  const safeSize = Math.max(16, Math.min(1024, Math.floor(size)));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(safeSize, 0);
  ihdr.writeUInt32BE(safeSize, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = safeSize * 4 + 1;
  const raw = Buffer.alloc(stride * safeSize);
  const radius = safeSize * 0.22;
  const center = safeSize / 2;
  for (let y = 0; y < safeSize; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < safeSize; x += 1) {
      const i = row + 1 + x * 4;
      const dx = x - center;
      const dy = y - center;
      const inMark = Math.abs(dx) + Math.abs(dy) < safeSize * 0.34 || Math.hypot(dx, dy) < radius;
      raw[i] = inMark ? 255 : 234;
      raw[i + 1] = inMark ? 255 : 88;
      raw[i + 2] = inMark ? 255 : 12;
      raw[i + 3] = 255;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function splashPng(w: number, h: number): Buffer {
  const W = Math.max(64, Math.min(2000, Math.floor(w)));
  const H = Math.max(64, Math.min(3200, Math.floor(h)));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H);
  const centerX = W / 2;
  const centerY = H / 2;
  const markSize = Math.min(W, H) * 0.28;
  const markRadius = markSize * 0.18;
  for (let y = 0; y < H; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < W; x += 1) {
      const i = row + 1 + x * 4;
      const dx = x - centerX;
      const dy = y - centerY;
      const inMark = Math.abs(dx) + Math.abs(dy) < markSize * 0.38 || Math.hypot(dx, dy) < markRadius;
      raw[i] = inMark ? 12 : 251;
      raw[i + 1] = inMark ? 74 : 249;
      raw[i + 2] = inMark ? 94 : 244;
      raw[i + 3] = 255;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
