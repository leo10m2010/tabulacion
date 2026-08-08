// PRNG determinista para poder reproducir una base cuando el usuario envía
// `seed`. Sin seed se delega en Math.random para conservar el comportamiento
// histórico y no compartir estado mutable entre generaciones concurrentes.
const hashSeed = (value) => {
  const text = String(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const normalizeSeed = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const seed = String(value).trim();
  if (!seed) return null;
  if (seed.length > 128) {
    throw new Error("La semilla admite como máximo 128 caracteres.");
  }
  return seed;
};

export const createRandom = (seed) => {
  const normalized = normalizeSeed(seed);
  if (normalized === null) return Math.random;

  let state = hashSeed(normalized);
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const createNormalRandom = (random = Math.random) => {
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }

    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
};
