import { correccionDeCuenta } from "../src/ai/respaldo";
const cuentas = ["Nu", "BBVA", "Efectivo"];
for (const f of [
  "El súper de hoy fue con la tarjeta de crédito Nu",
  "El súper de hoy fue con Nu, no con BBVA",
  "El súper fue con la Nu y el Uber con BBVA",
  "Lo del súper fue con tarjeta de crédito, no de débito",
  "El Uber de ayer lo pagué con efectivo",
  "Fue con la Nu",
  "El súper de hoy fue con la Nu.",
  "La cena fue con mis amigos",
  "Mi mamá fue con la tarjeta de mi papá",
  "El súper del viernes fue con la BBVA",
  "El súper del 3 de octubre fue con la Nu",
  "El café de la mañana fue con la Nu",
  "Y el Uber fue con la BBVA",
  "El súper de hoy fue con la Nu, ¿cuánto llevo en la Nu?",
]) console.log(JSON.stringify(f), "→", JSON.stringify(correccionDeCuenta(f, cuentas)));
