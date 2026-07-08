// Mapeo universidad -> dominio de su repositorio institucional. Es un mapa
// pequeño y extensible: si no hay match, buildAllowedDomains omite
// allowed_domains por completo (mejor dejar que el modelo busque libremente
// a restringir a un dominio adivinado que puede no existir).
const UNIVERSITY_DOMAINS = [
  { nombres: ["universidad de huanuco"], siglas: ["udh"], domain: "repositorio.udh.edu.pe" },
  { nombres: ["universidad cesar vallejo"], siglas: ["ucv"], domain: "repositorio.ucv.edu.pe" },
  { nombres: ["universidad nacional mayor de san marcos"], siglas: ["unmsm"], domain: "cybertesis.unmsm.edu.pe" },
  { nombres: ["universidad peruana los andes"], siglas: ["upla"], domain: "repositorio.upla.edu.pe" },
  { nombres: ["universidad continental"], siglas: [], domain: "repositorio.continental.edu.pe" },
  { nombres: ["universidad nacional hermilio valdizan"], siglas: ["unheval"], domain: "repositorio.unheval.edu.pe" },
  { nombres: ["universidad privada del norte"], siglas: ["upn"], domain: "repositorio.upn.edu.pe" },
  { nombres: ["universidad tecnologica del peru"], siglas: ["utp"], domain: "repositorio.utp.edu.pe" },
];

export const ALICIA_DOMAIN = "alicia.concytec.gob.pe";
export const RENATI_DOMAIN = "renati.sunedu.gob.pe";

// Normaliza a minusculas sin tildes para comparar de forma tolerante.
const normalize = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .trim();

// Match por inclusion de substring del nombre completo, o por sigla exacta
// (palabra completa dentro del texto normalizado).
export const resolveRepositoryDomain = (universidad) => {
  const norm = normalize(universidad);
  if (!norm) return null;
  for (const entry of UNIVERSITY_DOMAINS) {
    if (entry.nombres.some((nombre) => norm.includes(nombre))) return entry.domain;
    if (entry.siglas.some((sigla) => new RegExp(`\\b${sigla}\\b`).test(norm))) return entry.domain;
  }
  return null;
};

// Con match: [alicia, renati, dominio institucional].
// Sin match: null — el llamador debe OMITIR allowed_domains por completo, no
// restringir la busqueda a un dominio adivinado.
export const buildAllowedDomains = (universidad) => {
  const domain = resolveRepositoryDomain(universidad);
  return domain ? [ALICIA_DOMAIN, RENATI_DOMAIN, domain] : null;
};
