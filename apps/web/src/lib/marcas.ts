// Logos de comercios, servicios y bancos: Netflix, Uber, Oxxo, BBVA… Los que están en Simple Icons llevan su
// trazo (marcas-trazos.ts); los demás, una ficha con su nombre en sus colores. Lo que no se reconoce se queda
// con el icono de su categoría.

export type Marca = {
  nombre: string;
  /** Fondo (color o degradado) y color del logo o del texto. */
  fondo: string;
  tinta: string;
  /** Trazo de Simple Icons (clave de TRAZOS). */
  trazo?: string;
  /** Sin trazo: el texto de la ficha y qué tan grande va respecto al lado (0–1). */
  texto?: string;
  escala?: number;
  serif?: boolean;
  /** Franjas arriba y abajo (Oxxo). */
  franjas?: string;
  /** La chispa de seis rayos de Walmart. */
  chispa?: boolean;
  /** Fondo blanco: lleva un borde fino para no perderse en la tarjeta. */
  borde?: boolean;
};

export const MARCAS: Record<string, Marca> = {
  // Streaming y servicios digitales
  netflix: { nombre: "Netflix", fondo: "#000000", tinta: "#E50914", trazo: "netflix" },
  spotify: { nombre: "Spotify", fondo: "#191414", tinta: "#1ED760", trazo: "spotify" },
  disney: { nombre: "Disney+", fondo: "linear-gradient(140deg,#0e1a4f,#1b3fa0 60%,#1b8ed1)", tinta: "#ffffff", texto: "D+", escala: 0.4, serif: true },
  prime: { nombre: "Prime Video", fondo: "#0F171E", tinta: "#1FA8E0", texto: "prime", escala: 0.28 },
  max: { nombre: "Max", fondo: "#002BE7", tinta: "#ffffff", texto: "max", escala: 0.36 },
  appletv: { nombre: "Apple TV", fondo: "#000000", tinta: "#ffffff", trazo: "appletv" },
  applemusic: { nombre: "Apple Music", fondo: "linear-gradient(160deg,#fb5c74,#fa233b)", tinta: "#ffffff", trazo: "applemusic" },
  apple: { nombre: "Apple", fondo: "#000000", tinta: "#ffffff", trazo: "apple" },
  icloud: { nombre: "iCloud", fondo: "linear-gradient(160deg,#5ac8fa,#3693f3)", tinta: "#ffffff", trazo: "icloud" },
  youtubemusic: { nombre: "YouTube Music", fondo: "#000000", tinta: "#FF0000", trazo: "youtubemusic" },
  youtube: { nombre: "YouTube", fondo: "#ffffff", tinta: "#FF0000", trazo: "youtube", borde: true },
  crunchyroll: { nombre: "Crunchyroll", fondo: "#FF5E00", tinta: "#ffffff", trazo: "crunchyroll" },
  paramount: { nombre: "Paramount+", fondo: "#0064FF", tinta: "#ffffff", texto: "P+", escala: 0.4 },
  vix: { nombre: "ViX", fondo: "#000000", tinta: "#FF6B00", texto: "ViX", escala: 0.34 },
  deezer: { nombre: "Deezer", fondo: "#A238FF", tinta: "#ffffff", trazo: "deezer" },
  audible: { nombre: "Audible", fondo: "#F8991C", tinta: "#ffffff", trazo: "audible" },
  twitch: { nombre: "Twitch", fondo: "#9146FF", tinta: "#ffffff", trazo: "twitch" },
  playstation: { nombre: "PlayStation", fondo: "#0070D1", tinta: "#ffffff", trazo: "playstation" },
  xbox: { nombre: "Xbox", fondo: "#107C10", tinta: "#ffffff", texto: "X", escala: 0.5 },
  steam: { nombre: "Steam", fondo: "#171a21", tinta: "#ffffff", trazo: "steam" },
  google: { nombre: "Google", fondo: "#ffffff", tinta: "#4285F4", trazo: "google", borde: true },
  notion: { nombre: "Notion", fondo: "#ffffff", tinta: "#000000", trazo: "notion", borde: true },
  claude: { nombre: "Claude", fondo: "#F5F0E8", tinta: "#D97757", trazo: "claude" },
  chatgpt: { nombre: "ChatGPT", fondo: "#000000", tinta: "#ffffff", texto: "GPT", escala: 0.3 },
  // Transporte y entregas
  ubereats: { nombre: "Uber Eats", fondo: "#06C167", tinta: "#ffffff", trazo: "ubereats" },
  uber: { nombre: "Uber", fondo: "#000000", tinta: "#ffffff", trazo: "uber" },
  indrive: { nombre: "inDrive", fondo: "#C1F11D", tinta: "#141414", texto: "iD", escala: 0.42 },
  didi: { nombre: "DiDi", fondo: "#FC4C02", tinta: "#ffffff", texto: "DiDi", escala: 0.3 },
  cabify: { nombre: "Cabify", fondo: "#7145D6", tinta: "#ffffff", texto: "C", escala: 0.5 },
  rappi: { nombre: "Rappi", fondo: "#FF441F", tinta: "#ffffff", texto: "rappi", escala: 0.27 },
  airbnb: { nombre: "Airbnb", fondo: "#FF5A5F", tinta: "#ffffff", trazo: "airbnb" },
  aeromexico: { nombre: "Aeroméxico", fondo: "#0B2343", tinta: "#ffffff", texto: "AM", escala: 0.38 },
  volaris: { nombre: "Volaris", fondo: "#A12886", tinta: "#ffffff", texto: "V", escala: 0.5 },
  vivaaerobus: { nombre: "Viva Aerobus", fondo: "#00A850", tinta: "#ffffff", texto: "viva", escala: 0.3 },
  pemex: { nombre: "Pemex", fondo: "#006847", tinta: "#ffffff", texto: "PEMEX", escala: 0.22 },
  shell: { nombre: "Shell", fondo: "#FFD500", tinta: "#DD1D21", trazo: "shell" },
  // Tiendas y comida
  oxxo: { nombre: "Oxxo", fondo: "#E30613", tinta: "#FFD100", texto: "OXXO", escala: 0.27, franjas: "#FFD100" },
  seveneleven: { nombre: "7-Eleven", fondo: "#008061", tinta: "#ffffff", texto: "7", escala: 0.55 },
  walmart: { nombre: "Walmart", fondo: "#0071CE", tinta: "#FFC220", chispa: true },
  aurrera: { nombre: "Bodega Aurrera", fondo: "#FFD200", tinta: "#00843D", texto: "BA", escala: 0.38 },
  soriana: { nombre: "Soriana", fondo: "#E2001A", tinta: "#ffffff", texto: "S", escala: 0.5 },
  chedraui: { nombre: "Chedraui", fondo: "#F7941D", tinta: "#003DA5", texto: "Ch", escala: 0.42 },
  costco: { nombre: "Costco", fondo: "#005DAA", tinta: "#ffffff", texto: "COSTCO", escala: 0.2 },
  sams: { nombre: "Sam's Club", fondo: "#0067A0", tinta: "#ffffff", texto: "Sam's", escala: 0.26 },
  liverpool: { nombre: "Liverpool", fondo: "#E10098", tinta: "#ffffff", texto: "L", escala: 0.5 },
  coppel: { nombre: "Coppel", fondo: "#FFDA00", tinta: "#003DA5", texto: "C", escala: 0.5 },
  homedepot: { nombre: "The Home Depot", fondo: "#F96302", tinta: "#ffffff", texto: "THD", escala: 0.3 },
  mercadolibre: { nombre: "Mercado Libre", fondo: "#FFE600", tinta: "#2D3277", texto: "ML", escala: 0.38 },
  amazon: { nombre: "Amazon", fondo: "#232F3E", tinta: "#FF9900", texto: "a", escala: 0.55 },
  starbucks: { nombre: "Starbucks", fondo: "#006241", tinta: "#ffffff", trazo: "starbucks" },
  mcdonalds: { nombre: "McDonald's", fondo: "#DA291C", tinta: "#FFC72C", trazo: "mcdonalds" },
  burgerking: { nombre: "Burger King", fondo: "#D62300", tinta: "#F5EBDC", texto: "BK", escala: 0.4 },
  kfc: { nombre: "KFC", fondo: "#F40027", tinta: "#ffffff", texto: "KFC", escala: 0.3 },
  dominos: { nombre: "Domino's", fondo: "#006491", tinta: "#ffffff", texto: "D", escala: 0.5 },
  littlecaesars: { nombre: "Little Caesars", fondo: "#FF6600", tinta: "#ffffff", texto: "LC", escala: 0.38 },
  cinepolis: { nombre: "Cinépolis", fondo: "linear-gradient(150deg,#123a8c,#0a1f4f)", tinta: "#ffffff", texto: "C", escala: 0.5 },
  cinemex: { nombre: "Cinemex", fondo: "#D6001C", tinta: "#ffffff", texto: "CMX", escala: 0.3 },
  sanpablo: { nombre: "Farmacia San Pablo", fondo: "#0067B1", tinta: "#ffffff", texto: "SP", escala: 0.36 },
  guadalajara: { nombre: "Farmacias Guadalajara", fondo: "#00539B", tinta: "#ffffff", texto: "FG", escala: 0.36 },
  benavides: { nombre: "Farmacias Benavides", fondo: "#0072CE", tinta: "#ffffff", texto: "B", escala: 0.5 },
  ahorro: { nombre: "Farmacias del Ahorro", fondo: "#E30613", tinta: "#ffffff", texto: "FA", escala: 0.36 },
  smartfit: { nombre: "Smart Fit", fondo: "#FFC400", tinta: "#111111", texto: "SF", escala: 0.38 },
  // Servicios de la casa
  cfe: { nombre: "CFE", fondo: "#008E5A", tinta: "#ffffff", texto: "CFE", escala: 0.3 },
  telcel: { nombre: "Telcel", fondo: "#00377B", tinta: "#ffffff", texto: "telcel", escala: 0.25 },
  telmex: { nombre: "Telmex", fondo: "#0033A0", tinta: "#ffffff", texto: "telmex", escala: 0.24 },
  att: { nombre: "AT&T", fondo: "#00A8E0", tinta: "#ffffff", texto: "AT&T", escala: 0.26 },
  izzi: { nombre: "izzi", fondo: "#000000", tinta: "#00E0BC", texto: "izzi", escala: 0.3 },
  totalplay: { nombre: "Totalplay", fondo: "#4F2D7F", tinta: "#ffffff", texto: "tp", escala: 0.42 },
  megacable: { nombre: "Megacable", fondo: "#0055B8", tinta: "#ffffff", texto: "M", escala: 0.5 },
  // Bancos y pagos
  nu: { nombre: "Nu", fondo: "#820AD1", tinta: "#ffffff", trazo: "nubank" },
  bbva: { nombre: "BBVA", fondo: "#004481", tinta: "#ffffff", texto: "BBVA", escala: 0.26 },
  revolut: { nombre: "Revolut", fondo: "#191C1F", tinta: "#ffffff", trazo: "revolut" },
  banamex: { nombre: "Banamex", fondo: "#C8102E", tinta: "#ffffff", texto: "B", escala: 0.5 },
  santander: { nombre: "Santander", fondo: "#EC0000", tinta: "#ffffff", texto: "S", escala: 0.5 },
  banorte: { nombre: "Banorte", fondo: "#EB0029", tinta: "#ffffff", texto: "B", escala: 0.5 },
  hsbc: { nombre: "HSBC", fondo: "#DB0011", tinta: "#ffffff", texto: "HSBC", escala: 0.26 },
  invex: { nombre: "Invex", fondo: "#0B2242", tinta: "#ffffff", texto: "INVEX", escala: 0.22 },
  amex: { nombre: "American Express", fondo: "#006FCF", tinta: "#ffffff", texto: "AMEX", escala: 0.26 },
  stori: { nombre: "Stori", fondo: "#00C2A8", tinta: "#ffffff", texto: "S", escala: 0.5 },
  hey: { nombre: "Hey Banco", fondo: "#000000", tinta: "#ffffff", texto: "hey", escala: 0.34 },
  mercadopago: { nombre: "Mercado Pago", fondo: "#00B1EA", tinta: "#ffffff", trazo: "mercadopago" },
  paypal: { nombre: "PayPal", fondo: "#ffffff", tinta: "#002991", trazo: "paypal", borde: true },
};

// Cómo se reconoce cada marca en el comercio, la descripción o el nombre de la cuenta (sin acentos, en minúsculas).
// El orden importa: lo más específico primero (Uber Eats antes que Uber, YouTube Music antes que YouTube).
const REGLAS: [string, RegExp][] = [
  ["netflix", /netflix/],
  ["spotify", /spotify/],
  ["disney", /disney/],
  ["prime", /prime ?video|amazon prime/],
  ["max", /\bhbo\b|^max$|\bhbo ?max\b/],
  ["appletv", /apple ?tv/],
  ["applemusic", /apple ?music/],
  ["icloud", /icloud/],
  ["youtubemusic", /youtube ?music/],
  ["youtube", /youtube/],
  ["crunchyroll", /crunchyroll/],
  ["paramount", /paramount/],
  ["vix", /\bvix\b/],
  ["deezer", /deezer/],
  ["audible", /audible/],
  ["twitch", /twitch/],
  ["playstation", /playstation|\bpsn\b|ps plus/],
  ["xbox", /xbox|game ?pass/],
  ["steam", /\bsteam\b/],
  ["google", /google (one|play|storage)|^google$/],
  ["notion", /notion/],
  ["claude", /claude|anthropic/],
  ["chatgpt", /chat ?gpt|openai/],
  ["apple", /^apple( store)?$|apple\.com|app ?store/],
  ["ubereats", /uber ?eats/],
  ["uber", /\buber\b/],
  ["indrive", /in ?drive/],
  ["didi", /\bdidi\b/],
  ["cabify", /cabify/],
  ["rappi", /rappi/],
  ["airbnb", /airbnb/],
  ["aeromexico", /aeromexico/],
  ["volaris", /volaris/],
  ["vivaaerobus", /viva ?aerobus/],
  ["pemex", /pemex/],
  ["shell", /\bshell\b/],
  ["oxxo", /oxxo/],
  ["seveneleven", /7 ?-? ?eleven|seven ?eleven/],
  ["aurrera", /aurrera/],
  ["walmart", /walmart|wal-mart/],
  ["soriana", /soriana/],
  ["chedraui", /chedraui/],
  ["costco", /costco/],
  ["sams", /\bsam'?s\b/],
  ["liverpool", /liverpool/],
  ["coppel", /coppel/],
  ["homedepot", /home ?depot/],
  ["mercadolibre", /mercado ?libre|\bmeli\b/],
  ["mercadopago", /mercado ?pago/],
  ["amazon", /amazon/],
  ["starbucks", /starbucks/],
  ["mcdonalds", /mc ?donald/],
  ["burgerking", /burger ?king/],
  ["kfc", /\bkfc\b/],
  ["dominos", /domino'?s/],
  ["littlecaesars", /little ?caesar/],
  ["cinepolis", /cinepolis/],
  ["cinemex", /cinemex/],
  ["sanpablo", /san ?pablo/],
  ["guadalajara", /farmacias? guadalajara/],
  ["benavides", /benavides/],
  ["ahorro", /farmacias? del ahorro/],
  ["smartfit", /smart ?fit/],
  ["cfe", /\bcfe\b/],
  ["telcel", /telcel/],
  ["telmex", /telmex/],
  ["att", /\bat ?& ?t\b|\batt\b/],
  ["izzi", /\bizzi\b/],
  ["totalplay", /total ?play/],
  ["megacable", /megacable/],
  ["nu", /^nu\b|\bnubank\b|\bnu (credito|debito|cuenta|tarjeta)\b/],
  ["bbva", /bbva|bancomer/],
  ["revolut", /revolut/],
  ["banamex", /banamex/],
  ["santander", /santander/],
  ["banorte", /banorte/],
  ["hsbc", /hsbc/],
  ["invex", /invex/],
  ["amex", /\bamex\b|american express/],
  ["stori", /\bstori\b/],
  ["hey", /hey ?banco/],
  ["paypal", /paypal/],
];

export function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const cache = new Map<string, string | null>();

/** La clave de la marca que se reconoce en alguno de los textos (comercio primero), o null. */
export function marcaDe(...textos: (string | null | undefined)[]): string | null {
  for (const texto of textos) {
    if (!texto) continue;
    const t = normalizar(texto);
    let clave = cache.get(t);
    if (clave === undefined) {
      clave = REGLAS.find(([, re]) => re.test(t))?.[0] ?? null;
      cache.set(t, clave);
    }
    if (clave) return clave;
  }
  return null;
}
