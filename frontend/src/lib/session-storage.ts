const SENSITIVE_LOCAL_KEYS = [
  "authToken",
  "authExpiresAt",
  "loginEmail",
  "proyectoActivoId",
] as const;

const SENSITIVE_PREFIXES = [
  "proyectoActivoId:",
  "tesishub:job:",
] as const;

export const activeProjectStorageKey = (userId: string) => `proyectoActivoId:${userId}`;

// Conserva preferencias no sensibles (tema y URL local de desarrollo), pero
// elimina cualquier dato capaz de identificar o reconstruir el trabajo de la
// cuenta anterior en un navegador compartido.
export const clearSensitiveSessionStorage = (storage: Storage = localStorage) => {
  for (const key of SENSITIVE_LOCAL_KEYS) storage.removeItem(key);
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key && SENSITIVE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      storage.removeItem(key);
    }
  }
};
