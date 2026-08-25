import { hostLanguage } from "./nimiq";

/**
 * Translation for the languages the Nimiq community actually uses.
 *
 * English strings are the keys. A missing translation therefore falls back to
 * readable English rather than a raw identifier, which matters because a
 * half-translated screen is worse than an untranslated one.
 *
 * The German and Spanish copy is deliberately plain and functional. The English
 * has a voice that does not survive translation well, and stilted German in
 * front of a German-speaking panel would read worse than clean English.
 */

type Dict = Record<string, string>;

const de: Dict = {
  // Welcome
  "Rules for the money you get paid.": "Regeln für dein eingehendes Geld.",
  "Give a client one address. The moment they pay, it splits between your team and puts a slice into savings you cannot raid on a bad day.":
    "Gib deinem Kunden eine Adresse. Sobald er zahlt, wird das Geld unter deinem Team aufgeteilt und ein Teil davon gespart, an den du nicht herankommst.",
  "Weir runs inside Nimiq Pay. Open this page there to connect your wallet.":
    "Weir läuft in Nimiq Pay. Öffne diese Seite dort, um deine Wallet zu verbinden.",
  "Open in Nimiq Pay": "In Nimiq Pay öffnen",
  "Connect wallet": "Wallet verbinden",
  Connecting: "Verbinden",
  "How it works": "So funktioniert es",
  "You get an address": "Du bekommst eine Adresse",
  "Share it like any wallet address": "Teile sie wie jede andere Wallet-Adresse",
  "A client pays it": "Ein Kunde zahlt darauf",
  "From any wallet or exchange, no app needed":
    "Von jeder Wallet oder Börse, ganz ohne App",
  "It splits on arrival": "Es wird beim Eingang aufgeteilt",
  "Everyone paid, your slice already saved":
    "Alle bezahlt, dein Anteil schon gespart",

  // Setup
  "How should money arrive?": "Wie soll das Geld ankommen?",
  "You can change this any time.": "Du kannst das jederzeit ändern.",
  "Pay myself first": "Zuerst mich selbst bezahlen",
  "Every payment lands with a slice already put away":
    "Bei jeder Zahlung wird ein Teil sofort zurückgelegt",
  "Split with my team": "Mit meinem Team teilen",
  "One client payment, everyone paid at once":
    "Eine Kundenzahlung, alle werden gleichzeitig bezahlt",
  "Save this much of every payment": "So viel von jeder Zahlung sparen",
  "Lock it for": "Sperren für",
  "months. You can extend later, never shorten.":
    "Monate. Du kannst später verlängern, aber nie verkürzen.",
  "What is it for (optional)": "Wofür ist das (optional)",
  "Rainy day": "Notgroschen",
  "to spend": "zum Ausgeben",
  saved: "gespart",
  "Create my pay address": "Meine Zahlungsadresse erstellen",
  "Create our pay address": "Unsere Zahlungsadresse erstellen",
  Creating: "Wird erstellt",
  "Add everyone who should get a cut, including yourself.":
    "Füge alle hinzu, die einen Anteil bekommen, dich eingeschlossen.",
  "Add someone": "Jemanden hinzufügen",
  Total: "Gesamt",

  // Get paid
  "Your pay address": "Deine Zahlungsadresse",
  "Give this to a client like any other wallet address.":
    "Gib sie einem Kunden wie jede andere Wallet-Adresse.",
  "Copy address": "Adresse kopieren",
  Share: "Teilen",
  "Waiting to be split": "Wartet auf die Aufteilung",
  "Release now": "Jetzt freigeben",
  Releasing: "Wird freigegeben",
  "This normally happens by itself within a minute. The button is here so you never have to wait on us.":
    "Normalerweise geschieht das innerhalb einer Minute von selbst. Der Knopf ist da, damit du nie auf uns warten musst.",
  "Nothing waiting": "Nichts offen",
  Ready: "Bereit",
  "Set aside for you after a failed transfer":
    "Nach einer fehlgeschlagenen Überweisung für dich zurückgelegt",
  "Claim it": "Abholen",
  Claiming: "Wird abgeholt",
  "Bring your team in": "Hol dein Team dazu",
  "Anyone you split with can open Weir and watch their share land.":
    "Alle, mit denen du teilst, können Weir öffnen und ihren Anteil eingehen sehen.",
  "Invite teammates": "Teammitglieder einladen",
  "Get paid your way": "Werde bezahlt, wie du willst",
  "You are being paid through someone else's split. Set up your own address and you can be paid directly too, with a slice saved automatically.":
    "Du wirst über die Aufteilung einer anderen Person bezahlt. Richte deine eigene Adresse ein, dann kannst du auch direkt bezahlt werden, mit einem automatisch gesparten Anteil.",

  // Activity
  Activity: "Aktivität",
  "Everything that has moved through your addresses.":
    "Alles, was über deine Adressen gelaufen ist.",
  "Reading the chain": "Blockchain wird gelesen",
  "Nothing yet. As soon as someone pays your address, every split shows up here.":
    "Noch nichts. Sobald jemand deine Adresse bezahlt, erscheint hier jede Aufteilung.",
  "Payment arrived and was split": "Zahlung eingegangen und aufgeteilt",
  "Paid to you": "An dich ausgezahlt",
  "Into your savings": "In deine Ersparnisse",
  "Withdrawn from savings": "Von den Ersparnissen abgehoben",
  "Savings locked for longer": "Ersparnisse länger gesperrt",
  "A single payment shows as one arrival plus one line per person paid, so the same money appears more than once on purpose.":
    "Eine einzelne Zahlung erscheint als ein Eingang plus eine Zeile pro bezahlter Person, dasselbe Geld taucht also absichtlich mehrfach auf.",
  "just now": "gerade eben",

  // Splits
  Splits: "Aufteilungen",
  "Where money goes the moment it arrives.":
    "Wohin das Geld geht, sobald es ankommt.",
  "Your split": "Deine Aufteilung",
  "Change the split": "Aufteilung ändern",
  "Splits that pay you": "Aufteilungen, die dich bezahlen",
  "Release it": "Freigeben",
  You: "Du",
  "Savings vault": "Spartresor",

  // Savings
  Savings: "Ersparnisse",
  "You have not set a slice aside yet.": "Du hast noch nichts zurückgelegt.",
  "Start saving a slice": "Fang an, einen Teil zu sparen",
  "Put away so far": "Bisher zurückgelegt",
  Unlocked: "Entsperrt",
  "The lock is the point. You can push the date further out, but there is deliberately no way to bring it closer.":
    "Die Sperre ist der Sinn der Sache. Du kannst das Datum weiter nach hinten schieben, aber es gibt bewusst keinen Weg, es vorzuziehen.",
  "Lock it for longer": "Länger sperren",
  "Keep it locked until": "Gesperrt halten bis",
  Confirm: "Bestätigen",
  Cancel: "Abbrechen",
  Extending: "Wird verlängert",
  "Withdraw everything": "Alles abheben",
  Withdrawing: "Wird abgehoben",
  "Vault address": "Tresoradresse",
  "Pick a date first.": "Wähle zuerst ein Datum.",

  // NIM
  "Split this much NIM": "So viel NIM aufteilen",
  "Your NIM": "Deine NIM",
  "Send the NIM split": "NIM-Aufteilung senden",
  "Change Nimiq addresses": "Nimiq-Adressen ändern",
  "Save addresses": "Adressen speichern",
  "Savings share": "Sparanteil",
  "Nimiq Pay does not expose a balance to mini apps, so enter the amount yourself.":
    "Nimiq Pay zeigt Mini-Apps kein Guthaben an, gib den Betrag also selbst ein.",
  "Send this share to any Nimiq address you like. It will not be locked: Nimiq has vesting contracts, but a Mini App has no way to create one.":
    "Sende diesen Anteil an eine beliebige Nimiq-Adresse. Er wird nicht gesperrt: Nimiq hat Vesting-Verträge, aber eine Mini-App kann keinen anlegen.",

  "Or pay me in NIM": "Oder zahl mich in NIM",
  "On Nimiq, paid straight to your wallet": "Auf Nimiq, direkt in deine Wallet",
  "Copy Nimiq address": "Nimiq-Adresse kopieren",

  // Tabs
  "Get paid": "Bezahlt werden",

  // Parameterised
  "On {chain}, for {token}": "Auf {chain}, für {token}",
  "A Mini App cannot create a splitting contract on Nimiq, so this split is not enforced the way your {token} split is. Weir does the arithmetic and you approve one transfer per person. Nothing is held on your behalf.":
    "Eine Mini-App kann auf Nimiq keinen Aufteilungs-Vertrag anlegen, diese Aufteilung ist also nicht so verbindlich wie deine {token}-Aufteilung. Weir rechnet, und du bestätigst eine Überweisung pro Person. Nichts wird für dich verwahrt.",
  "Open Weir inside Nimiq Pay to split NIM as well as {token}.":
    "Öffne Weir in Nimiq Pay, um neben {token} auch NIM aufzuteilen.",
  "A Nimiq address is not the same as an {token} address, so each person needs theirs entered once. Stored on this device only.":
    "Eine Nimiq-Adresse ist nicht dasselbe wie eine {token}-Adresse, jede Person braucht ihre also einmal eingetragen. Nur auf diesem Gerät gespeichert.",

  // Errors
  "You cancelled that in your wallet.": "Du hast das in deiner Wallet abgebrochen.",
  "Not enough gas in this wallet to send that.":
    "Nicht genug Gas in dieser Wallet, um das zu senden.",
  "No wallet found. Open this inside Nimiq Pay.":
    "Keine Wallet gefunden. Öffne dies in Nimiq Pay.",
  "Something went wrong": "Etwas ist schiefgelaufen",
  "Try again": "Erneut versuchen",
  "Starting Weir": "Weir startet",
};

const es: Dict = {
  // Welcome
  "Rules for the money you get paid.": "Reglas para el dinero que te pagan.",
  "Give a client one address. The moment they pay, it splits between your team and puts a slice into savings you cannot raid on a bad day.":
    "Dale a tu cliente una sola dirección. En cuanto pague, se reparte entre tu equipo y aparta una parte en un ahorro que no puedes tocar en un mal día.",
  "Weir runs inside Nimiq Pay. Open this page there to connect your wallet.":
    "Weir funciona dentro de Nimiq Pay. Abre esta página allí para conectar tu monedero.",
  "Open in Nimiq Pay": "Abrir en Nimiq Pay",
  "Connect wallet": "Conectar monedero",
  Connecting: "Conectando",
  "How it works": "Cómo funciona",
  "You get an address": "Recibes una dirección",
  "Share it like any wallet address":
    "Compártela como cualquier dirección de monedero",
  "A client pays it": "Un cliente le paga",
  "From any wallet or exchange, no app needed":
    "Desde cualquier monedero o casa de cambio, sin necesidad de una app",
  "It splits on arrival": "Se reparte al llegar",
  "Everyone paid, your slice already saved":
    "Todos cobran y tu parte ya está ahorrada",

  // Setup
  "How should money arrive?": "¿Cómo debe llegar el dinero?",
  "You can change this any time.": "Puedes cambiar esto cuando quieras.",
  "Pay myself first": "Pagarme primero a mí",
  "Every payment lands with a slice already put away":
    "Cada pago llega con una parte ya apartada",
  "Split with my team": "Repartir con mi equipo",
  "One client payment, everyone paid at once":
    "Un pago del cliente, todos cobran a la vez",
  "Save this much of every payment": "Ahorrar esta parte de cada pago",
  "Lock it for": "Bloquear durante",
  "months. You can extend later, never shorten.":
    "meses. Puedes ampliarlo más adelante, nunca acortarlo.",
  "What is it for (optional)": "¿Para qué es (opcional)",
  "Rainy day": "Para imprevistos",
  "to spend": "para gastar",
  saved: "ahorrado",
  "Create my pay address": "Crear mi dirección de cobro",
  "Create our pay address": "Crear nuestra dirección de cobro",
  Creating: "Creando",
  "Add everyone who should get a cut, including yourself.":
    "Añade a todos los que deben recibir una parte, incluido tú.",
  "Add someone": "Añadir a alguien",
  Total: "Total",

  // Get paid
  "Your pay address": "Tu dirección de cobro",
  "Give this to a client like any other wallet address.":
    "Dásela a un cliente como cualquier otra dirección de monedero.",
  "Copy address": "Copiar dirección",
  Share: "Compartir",
  "Waiting to be split": "Pendiente de repartir",
  "Release now": "Repartir ahora",
  Releasing: "Repartiendo",
  "This normally happens by itself within a minute. The button is here so you never have to wait on us.":
    "Normalmente esto ocurre solo en menos de un minuto. El botón está aquí para que nunca tengas que esperarnos.",
  "Nothing waiting": "Nada pendiente",
  Ready: "Listo",
  "Set aside for you after a failed transfer":
    "Apartado para ti tras una transferencia fallida",
  "Claim it": "Reclamarlo",
  Claiming: "Reclamando",
  "Bring your team in": "Trae a tu equipo",
  "Anyone you split with can open Weir and watch their share land.":
    "Cualquiera con quien repartas puede abrir Weir y ver llegar su parte.",
  "Invite teammates": "Invitar al equipo",
  "Get paid your way": "Cobra a tu manera",
  "You are being paid through someone else's split. Set up your own address and you can be paid directly too, with a slice saved automatically.":
    "Te están pagando a través del reparto de otra persona. Crea tu propia dirección y podrás cobrar directamente, con una parte ahorrada automáticamente.",

  // Activity
  Activity: "Actividad",
  "Everything that has moved through your addresses.":
    "Todo lo que ha pasado por tus direcciones.",
  "Reading the chain": "Leyendo la cadena",
  "Nothing yet. As soon as someone pays your address, every split shows up here.":
    "Nada todavía. En cuanto alguien pague tu dirección, cada reparto aparecerá aquí.",
  "Payment arrived and was split": "Llegó un pago y se repartió",
  "Paid to you": "Pagado a ti",
  "Into your savings": "A tus ahorros",
  "Withdrawn from savings": "Retirado de los ahorros",
  "Savings locked for longer": "Ahorros bloqueados por más tiempo",
  "A single payment shows as one arrival plus one line per person paid, so the same money appears more than once on purpose.":
    "Un solo pago aparece como una entrada más una línea por cada persona pagada, así que el mismo dinero sale más de una vez a propósito.",
  "just now": "ahora mismo",

  // Splits
  Splits: "Repartos",
  "Where money goes the moment it arrives.":
    "A dónde va el dinero en cuanto llega.",
  "Your split": "Tu reparto",
  "Change the split": "Cambiar el reparto",
  "Splits that pay you": "Repartos que te pagan",
  "Release it": "Repartirlo",
  You: "Tú",
  "Savings vault": "Caja de ahorro",

  // Savings
  Savings: "Ahorros",
  "You have not set a slice aside yet.": "Todavía no has apartado nada.",
  "Start saving a slice": "Empezar a ahorrar una parte",
  "Put away so far": "Apartado hasta ahora",
  Unlocked: "Desbloqueado",
  "The lock is the point. You can push the date further out, but there is deliberately no way to bring it closer.":
    "El bloqueo es justo el objetivo. Puedes alejar la fecha, pero a propósito no hay forma de acercarla.",
  "Lock it for longer": "Bloquear por más tiempo",
  "Keep it locked until": "Mantener bloqueado hasta",
  Confirm: "Confirmar",
  Cancel: "Cancelar",
  Extending: "Ampliando",
  "Withdraw everything": "Retirar todo",
  Withdrawing: "Retirando",
  "Vault address": "Dirección de la caja",
  "Pick a date first.": "Elige una fecha primero.",

  // NIM
  "Split this much NIM": "Repartir esta cantidad de NIM",
  "Your NIM": "Tus NIM",
  "Send the NIM split": "Enviar el reparto de NIM",
  "Change Nimiq addresses": "Cambiar direcciones Nimiq",
  "Save addresses": "Guardar direcciones",
  "Savings share": "Parte de ahorro",
  "Nimiq Pay does not expose a balance to mini apps, so enter the amount yourself.":
    "Nimiq Pay no muestra el saldo a las mini apps, así que introduce tú la cantidad.",
  "Send this share to any Nimiq address you like. It will not be locked: Nimiq has vesting contracts, but a Mini App has no way to create one.":
    "Envía esta parte a la dirección Nimiq que quieras. No quedará bloqueada: Nimiq tiene contratos de vesting, pero una Mini App no puede crear uno.",

  "Or pay me in NIM": "O págame en NIM",
  "On Nimiq, paid straight to your wallet": "En Nimiq, directo a tu monedero",
  "Copy Nimiq address": "Copiar dirección Nimiq",

  // Tabs
  "Get paid": "Cobrar",

  // Parameterised
  "On {chain}, for {token}": "En {chain}, para {token}",
  "A Mini App cannot create a splitting contract on Nimiq, so this split is not enforced the way your {token} split is. Weir does the arithmetic and you approve one transfer per person. Nothing is held on your behalf.":
    "Una Mini App no puede crear un contrato de reparto en Nimiq, así que este reparto no se impone como el de {token}. Weir hace el cálculo y tú apruebas una transferencia por persona. No se custodia nada en tu nombre.",
  "Open Weir inside Nimiq Pay to split NIM as well as {token}.":
    "Abre Weir dentro de Nimiq Pay para repartir NIM además de {token}.",
  "A Nimiq address is not the same as an {token} address, so each person needs theirs entered once. Stored on this device only.":
    "Una dirección Nimiq no es lo mismo que una dirección {token}, así que cada persona necesita introducir la suya una vez. Se guarda solo en este dispositivo.",

  // Errors
  "You cancelled that in your wallet.": "Cancelaste eso en tu monedero.",
  "Not enough gas in this wallet to send that.":
    "No hay suficiente gas en este monedero para enviarlo.",
  "No wallet found. Open this inside Nimiq Pay.":
    "No se encontró ningún monedero. Abre esto dentro de Nimiq Pay.",
  "Something went wrong": "Algo salió mal",
  "Try again": "Intentar de nuevo",
  "Starting Weir": "Iniciando Weir",
};

const DICTS: Record<string, Dict> = { de, es };

let active: Dict | null = null;
let activeCode = "en";

/**
 * Picks the language Nimiq Pay says the user chose, which is not necessarily
 * the device locale. Falls back to the browser only when running outside
 * Nimiq Pay, and to English when we have no translation.
 */
export function initLanguage(): string {
  const fromHost = hostLanguage();
  const raw = fromHost ?? (typeof navigator !== "undefined" ? navigator.language : "en");
  const code = (raw || "en").slice(0, 2).toLowerCase();
  active = DICTS[code] ?? null;
  activeCode = active ? code : "en";
  return activeCode;
}

export function currentLanguage(): string {
  return activeCode;
}

/**
 * Translates, falling back to the English key when there is no entry.
 *
 * Placeholders are written as {name} so a translator can move them around the
 * sentence, which German and Spanish word order regularly requires.
 */
export function t(english: string, params?: Record<string, string | number>): string {
  const template = (active ? active[english] : undefined) ?? english;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in params ? String(params[key]) : whole,
  );
}
