import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

const DISPATCHER_TTL_MS = 5 * 60_000;
const MAX_DISPATCHERS = 128;
const dispatcherCache = new Map();

const invalidUrl = (message = "La URL apunta a una red no permitida.") => {
  const error = new Error(message);
  error.code = "UNSAFE_URL";
  return error;
};

const isPublicIpv4 = (address) => {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c <= 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
};

const isPublicIpv6 = (rawAddress) => {
  const address = rawAddress.toLowerCase().split("%")[0];
  const mapped = address.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  // Solo se permiten direcciones global-unicast (2000::/3). Esto excluye
  // loopback, unspecified, ULA, link-local, multicast y rangos reservados.
  if (!/^[23]/.test(address)) return false;
  if (address.startsWith("2001:db8:")) return false;
  return true;
};

export const isPublicIpAddress = (address) => {
  const family = net.isIP(String(address ?? ""));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
};

export const parsePublicHttpUrl = (input) => {
  let parsed;
  try {
    parsed = new URL(String(input ?? ""));
  } catch {
    throw invalidUrl("La URL no es válida.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw invalidUrl("Solo se permiten URLs HTTP o HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw invalidUrl("La URL no puede contener credenciales.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) throw invalidUrl();
  if (hostname === "metadata.google.internal" || hostname.endsWith(".internal")) throw invalidUrl();
  if (net.isIP(hostname) && !isPublicIpAddress(hostname)) throw invalidUrl();
  return parsed;
};

export const resolvePublicAddresses = async (input, lookupImpl = dns.lookup) => {
  const parsed = parsePublicHttpUrl(input);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    return [{ address: hostname, family: net.isIP(hostname) }];
  }
  const resolved = await lookupImpl(hostname, { all: true, verbatim: true });
  const addresses = Array.isArray(resolved) ? resolved : [resolved];
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw invalidUrl();
  }
  return addresses.map(({ address, family }) => ({ address, family: Number(family) || net.isIP(address) }));
};

const closeEntry = (entry) => entry?.dispatcher?.close().catch(() => {});

const pruneDispatchers = () => {
  const now = Date.now();
  for (const [key, entry] of dispatcherCache) {
    if (entry.expiresAt <= now) {
      dispatcherCache.delete(key);
      closeEntry(entry);
    }
  }
  while (dispatcherCache.size > MAX_DISPATCHERS) {
    const [key, entry] = dispatcherCache.entries().next().value;
    dispatcherCache.delete(key);
    closeEntry(entry);
  }
};

export const publicUrlDispatcher = async (input, options = {}) => {
  const parsed = parsePublicHttpUrl(input);
  const cacheKey = `${parsed.protocol}//${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`;
  pruneDispatchers();
  const cached = dispatcherCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.dispatcher;

  const addresses = await resolvePublicAddresses(parsed, options.lookupImpl);
  let cursor = 0;
  const dispatcher = new Agent({
    connect: {
      lookup(_hostname, _lookupOptions, callback) {
        const selected = addresses[cursor % addresses.length];
        cursor += 1;
        callback(null, selected.address, selected.family);
      },
    },
  });
  const previous = dispatcherCache.get(cacheKey);
  dispatcherCache.set(cacheKey, { dispatcher, expiresAt: Date.now() + DISPATCHER_TTL_MS });
  closeEntry(previous);
  pruneDispatchers();
  return dispatcher;
};

export const clearPublicUrlDispatchers = async () => {
  const entries = [...dispatcherCache.values()];
  dispatcherCache.clear();
  await Promise.all(entries.map((entry) => entry.dispatcher.close().catch(() => {})));
};
