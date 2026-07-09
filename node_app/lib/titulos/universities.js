// Mapeo universidad -> dominio de su repositorio institucional (Peru).
// Lista verificada el 2026-07-08: cada dominio respondio 2xx/3xx por HTTP o,
// en su defecto, resuelve en DNS (servidor temporalmente caido/lento). El
// dominio NO se usa como filtro duro de busqueda (allowed_domains bloquearia
// los antecedentes internacionales, que deben venir de otros paises): se
// inyecta como PISTA en el mensaje user para que la IA priorice ese dominio
// al buscar tesis de la universidad del cliente.
//
// Reglas de matching:
// - `nombres`: substrings distintivos del nombre normalizado (minusculas,
//   sin tildes). Se usa inclusion, asi que deben ser lo bastante especificos
//   para no matchear otra universidad ("nacional de piura" vs "universidad
//   de piura").
// - `siglas`: match por palabra completa. Se EXCLUYEN siglas que son
//   palabras del espanol o ambiguas ("una", "une", "up", "unam" de Mexico).
const UNIVERSITY_DOMAINS = [
  // ── Grandes privadas de alcance nacional ──────────────────────────────────
  { nombres: ["cesar vallejo"], siglas: ["ucv"], domain: "repositorio.ucv.edu.pe" },
  { nombres: ["privada del norte"], siglas: ["upn"], domain: "repositorio.upn.edu.pe" },
  { nombres: ["tecnologica del peru"], siglas: ["utp"], domain: "repositorio.utp.edu.pe" },
  { nombres: ["peruana de ciencias aplicadas"], siglas: ["upc"], domain: "repositorioacademico.upc.edu.pe" },
  { nombres: ["san ignacio de loyola"], siglas: ["usil"], domain: "repositorio.usil.edu.pe" },
  { nombres: ["senor de sipan"], siglas: ["uss"], domain: "repositorio.uss.edu.pe" },
  { nombres: ["continental"], siglas: [], domain: "repositorio.continental.edu.pe" },
  { nombres: ["peruana los andes"], siglas: ["upla"], domain: "repositorio.upla.edu.pe" },
  { nombres: ["peruana union"], siglas: ["upeu"], domain: "repositorio.upeu.edu.pe" },
  { nombres: ["los angeles de chimbote"], siglas: ["uladech"], domain: "repositorio.uladech.edu.pe" },
  { nombres: ["alas peruanas"], siglas: [], domain: "repositorio.uap.edu.pe" },

  // ── Lima: publicas y privadas historicas ──────────────────────────────────
  { nombres: ["san marcos"], siglas: ["unmsm"], domain: "cybertesis.unmsm.edu.pe" },
  { nombres: ["catolica del peru", "pucp"], siglas: ["pucp"], domain: "tesis.pucp.edu.pe" },
  { nombres: ["nacional de ingenieria"], siglas: ["uni"], domain: "cybertesis.uni.edu.pe" },
  { nombres: ["federico villarreal"], siglas: ["unfv"], domain: "repositorio.unfv.edu.pe" },
  { nombres: ["agraria la molina", "la molina"], siglas: ["unalm"], domain: "repositorio.lamolina.edu.pe" },
  { nombres: ["del callao"], siglas: ["unac"], domain: "repositorio.unac.edu.pe" },
  { nombres: ["enrique guzman", "la cantuta"], siglas: [], domain: "repositorio.une.edu.pe" },
  { nombres: ["tecnologica de lima sur"], siglas: ["untels"], domain: "repositorio.untels.edu.pe" },
  { nombres: ["san martin de porres"], siglas: ["usmp"], domain: "repositorio.usmp.edu.pe" },
  { nombres: ["ricardo palma"], siglas: ["urp"], domain: "repositorio.urp.edu.pe" },
  { nombres: ["inca garcilaso"], siglas: ["uigv"], domain: "repositorio.uigv.edu.pe" },
  { nombres: ["cayetano heredia"], siglas: ["upch"], domain: "repositorio.upch.edu.pe" },
  { nombres: ["esan"], siglas: ["esan"], domain: "repositorio.esan.edu.pe" },
  { nombres: ["universidad del pacifico"], siglas: [], domain: "repositorio.up.edu.pe" },
  { nombres: ["sedes sapientiae"], siglas: ["ucss"], domain: "repositorio.ucss.edu.pe" },
  { nombres: ["femenina del sagrado corazon"], siglas: ["unife"], domain: "repositorio.unife.edu.pe" },
  { nombres: ["norbert wiener", "wiener"], siglas: [], domain: "repositorio.uwiener.edu.pe" },
  { nombres: ["san juan bautista"], siglas: ["upsjb"], domain: "repositorio.upsjb.edu.pe" },
  { nombres: ["autonoma del peru"], siglas: [], domain: "repositorio.autonoma.edu.pe" },
  { nombres: ["ciencias y humanidades"], siglas: ["uch"], domain: "repositorio.uch.edu.pe" },
  { nombres: ["cientifica del sur"], siglas: ["ucsur"], domain: "repositorio.cientifica.edu.pe" },
  { nombres: ["universidad de lima"], siglas: ["ulima"], domain: "repositorio.ulima.edu.pe" },
  { nombres: ["marcelino champagnat"], siglas: ["umch"], domain: "repositorio.umch.edu.pe" },
  { nombres: ["de las americas"], siglas: [], domain: "repositorio.ulasamericas.edu.pe" },
  { nombres: ["bausate"], siglas: [], domain: "repositorio.bausate.edu.pe" },
  { nombres: ["faustino sanchez carrion", "sanchez carrion"], siglas: ["unjfsc"], domain: "repositorio.unjfsc.edu.pe" },
  { nombres: ["nacional de barranca"], siglas: ["unab"], domain: "repositorio.unab.edu.pe" },
  { nombres: ["nacional de canete"], siglas: ["undc"], domain: "repositorio.undc.edu.pe" },

  // ── Norte ─────────────────────────────────────────────────────────────────
  { nombres: ["nacional de trujillo"], siglas: ["unitru"], domain: "repositorio.unitru.edu.pe" },
  { nombres: ["antenor orrego"], siglas: ["upao"], domain: "repositorio.upao.edu.pe" },
  { nombres: ["catolica de trujillo"], siglas: ["uct"], domain: "repositorio.uct.edu.pe" },
  { nombres: ["santo toribio"], siglas: ["usat"], domain: "repositorio.usat.edu.pe" },
  { nombres: ["pedro ruiz gallo"], siglas: ["unprg"], domain: "repositorio.unprg.edu.pe" },
  { nombres: ["nacional de piura"], siglas: ["unp"], domain: "repositorio.unp.edu.pe" },
  { nombres: ["universidad de piura"], siglas: ["udep"], domain: "pirhua.udep.edu.pe" },
  { nombres: ["nacional de cajamarca"], siglas: [], domain: "repositorio.unc.edu.pe" },
  { nombres: ["antonio guillermo urrelo"], siglas: ["upagu"], domain: "repositorio.upagu.edu.pe" },
  { nombres: ["nacional de jaen"], siglas: ["unj"], domain: "repositorio.unj.edu.pe" },
  { nombres: ["toribio rodriguez"], siglas: ["untrm"], domain: "repositorio.untrm.edu.pe" },
  { nombres: ["nacional de tumbes"], siglas: ["untumbes"], domain: "repositorio.untumbes.edu.pe" },
  { nombres: ["nacional de frontera"], siglas: ["unf"], domain: "repositorio.unf.edu.pe" },
  { nombres: ["antunez de mayolo"], siglas: ["unasam"], domain: "repositorio.unasam.edu.pe" },
  { nombres: ["nacional del santa"], siglas: ["uns"], domain: "repositorio.uns.edu.pe" },
  { nombres: ["san pedro"], siglas: ["usp"], domain: "repositorio.usanpedro.edu.pe" },

  // ── Centro ────────────────────────────────────────────────────────────────
  { nombres: ["centro del peru"], siglas: ["uncp"], domain: "repositorio.uncp.edu.pe" },
  { nombres: ["hermilio valdizan"], siglas: ["unheval"], domain: "repositorio.unheval.edu.pe" },
  { nombres: ["universidad de huanuco"], siglas: ["udh"], domain: "repositorio.udh.edu.pe" },
  { nombres: ["daniel alcides carrion"], siglas: ["undac"], domain: "repositorio.undac.edu.pe" },
  { nombres: ["nacional de huancavelica"], siglas: ["unh"], domain: "repositorio.unh.edu.pe" },
  { nombres: ["roosevelt"], siglas: [], domain: "repositorio.uroosevelt.edu.pe" },

  // ── Sur ───────────────────────────────────────────────────────────────────
  { nombres: ["san agustin"], siglas: ["unsa"], domain: "repositorio.unsa.edu.pe" },
  { nombres: ["catolica de santa maria"], siglas: ["ucsm"], domain: "repositorio.ucsm.edu.pe" },
  { nombres: ["catolica san pablo"], siglas: ["ucsp"], domain: "repositorio.ucsp.edu.pe" },
  { nombres: ["san antonio abad"], siglas: ["unsaac"], domain: "repositorio.unsaac.edu.pe" },
  { nombres: ["andina del cusco"], siglas: ["uac"], domain: "repositorio.uandina.edu.pe" },
  { nombres: ["san cristobal de huamanga", "huamanga"], siglas: ["unsch"], domain: "repositorio.unsch.edu.pe" },
  { nombres: ["jose maria arguedas"], siglas: ["unajma"], domain: "repositorio.unajma.edu.pe" },
  { nombres: ["micaela bastidas"], siglas: ["unamba"], domain: "repositorio.unamba.edu.pe" },
  { nombres: ["tecnologica de los andes"], siglas: ["utea"], domain: "repositorio.utea.edu.pe" },
  // El Altiplano (Puno) es dueno del dominio unap.edu.pe; la sigla "unap"
  // se asigna aqui. La Amazonia Peruana (Iquitos) se matchea por nombre.
  { nombres: ["del altiplano"], siglas: ["unap"], domain: "repositorio.unap.edu.pe" },
  { nombres: ["nestor caceres"], siglas: ["uancv"], domain: "repositorio.uancv.edu.pe" },
  { nombres: ["nacional de juliaca"], siglas: ["unaj"], domain: "repositorio.unaj.edu.pe" },
  { nombres: ["jorge basadre"], siglas: ["unjbg"], domain: "repositorio.unjbg.edu.pe" },
  { nombres: ["privada de tacna"], siglas: ["upt"], domain: "repositorio.upt.edu.pe" },
  { nombres: ["nacional de moquegua"], siglas: [], domain: "repositorio.unam.edu.pe" },
  { nombres: ["san luis gonzaga"], siglas: ["unica"], domain: "repositorio.unica.edu.pe" },

  // ── Oriente ───────────────────────────────────────────────────────────────
  { nombres: ["amazonia peruana"], siglas: ["unapiquitos"], domain: "repositorio.unapiquitos.edu.pe" },
  { nombres: ["nacional de san martin"], siglas: ["unsm"], domain: "repositorio.unsm.edu.pe" },
  { nombres: ["agraria de la selva"], siglas: ["unas"], domain: "repositorio.unas.edu.pe" },
  { nombres: ["nacional de ucayali"], siglas: ["unu"], domain: "repositorio.unu.edu.pe" },
  { nombres: ["madre de dios"], siglas: ["unamad"], domain: "repositorio.unamad.edu.pe" },
];

export const ALICIA_DOMAIN = "alicia.concytec.gob.pe";
export const RENATI_DOMAIN = "renati.sunedu.gob.pe";

// Normaliza a minusculas sin tildes para comparar de forma tolerante.
const normalize = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .trim();

// Match por inclusion de substring del nombre distintivo, o por sigla exacta
// (palabra completa dentro del texto normalizado). El orden del array
// importa: entradas mas especificas primero cuando hay riesgo de solape.
export const resolveRepositoryDomain = (universidad) => {
  const norm = normalize(universidad);
  if (!norm) return null;
  for (const entry of UNIVERSITY_DOMAINS) {
    if (entry.nombres.some((nombre) => norm.includes(nombre))) return entry.domain;
    if (entry.siglas.some((sigla) => new RegExp(`\\b${sigla}\\b`).test(norm))) return entry.domain;
  }
  return null;
};
