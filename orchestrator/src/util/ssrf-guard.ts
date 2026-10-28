import { lookup as dnsLookup } from "node:dns/promises";

type Lookup = (host: string) => Promise<string[]>;

function parseIpv4(ip: string): number[] | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    return Number(part);
  });

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : undefined;
}

function parseIpv6(ip: string): number[] | undefined {
  const unwrapped = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  let normalized = unwrapped.toLowerCase();

  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon === -1) return undefined;
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (!ipv4) return undefined;
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    normalized = `${normalized.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) {
    return undefined;
  }

  const groups = halves.length === 2
    ? [...left, ...Array<string>(omitted).fill("0"), ...right]
    : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return undefined;
  }

  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function isPrivateIpv4(octets: number[]): boolean {
  const [first, second, third] = octets;
  return first === 0
    || first === 127
    || first === 10
    || (first === 100 && second !== undefined && second >= 64 && second <= 127)
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
    || (first === 198 && (second === 18 || second === 19))
    || (first !== undefined && first >= 224); // 224/4 multicast and 240/4 reserved
}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.trim();
  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isPrivateIpv4(ipv4);

  const ipv6 = parseIpv6(normalized);
  if (!ipv6) return false;

  const isIpv4Mapped = ipv6.slice(0, 10).every((byte) => byte === 0)
    && ipv6[10] === 0xff
    && ipv6[11] === 0xff;
  const isIpv4Compatible = ipv6.slice(0, 12).every((byte) => byte === 0);
  const isNat64 = ipv6[0] === 0 && ipv6[1] === 0x64
    && ipv6[2] === 0xff && ipv6[3] === 0x9b
    && ipv6.slice(4, 12).every((byte) => byte === 0);
  if (isIpv4Mapped || isIpv4Compatible || isNat64) return isPrivateIpv4(ipv6.slice(12));

  const isUnspecified = ipv6.every((byte) => byte === 0);
  const isLoopback = ipv6.slice(0, 15).every((byte) => byte === 0) && ipv6[15] === 1;
  const isUniqueLocal = ((ipv6[0] ?? 0) & 0xfe) === 0xfc;
  const isLinkLocal = ipv6[0] === 0xfe && ((ipv6[1] ?? 0) & 0xc0) === 0x80;
  const isSiteLocal = ipv6[0] === 0xfe && ((ipv6[1] ?? 0) & 0xc0) === 0xc0;
  const isMulticast = ipv6[0] === 0xff;
  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isSiteLocal || isMulticast;
}

export async function assertPublicHttpUrl(
  rawUrl: string,
  deps: { lookup?: Lookup } = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("非法 URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅允许 http/https");
  }

  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const literalAddress = parseIpv4(host) || parseIpv6(host);
  const addresses = literalAddress
    ? [host]
    : deps.lookup
      ? await deps.lookup(host)
      : (await dnsLookup(host, { all: true })).map(({ address }) => address);

  if (addresses.some(isPrivateIp)) {
    throw new Error("拒绝访问内网/回环地址");
  }
}
