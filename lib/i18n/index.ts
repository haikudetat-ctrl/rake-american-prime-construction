export type Locale = "en" | "es";

const en = {
  "driver.title": "Today's run",
  "driver.empty": "No stops today.",
  "driver.signOut": "Sign out",
  "driver.language": "Español",
  "driver.kind.drop": "Drop",
  "driver.kind.pickup": "Pick up",
  "driver.kind.dump": "Dump",
  "driver.done": "Done",
  "driver.call": "Call",
  "driver.map": "Map",
  "driver.can": "Can",
  "driver.chooseCan": "Which can did you drop?",
  "driver.dropped": "Dropped",
  "driver.pickedUp": "Picked up",
  "driver.ticket": "Scale ticket",
  "driver.ticketPhoto": "Photo of the ticket",
  "driver.ticketNumber": "Ticket number",
  "driver.landfill": "Landfill",
  "driver.tons": "Tons",
  "driver.fee": "Fee ($)",
  "driver.saveTicket": "Save ticket",
  "driver.notes": "Notes",
  "driver.error": "That didn't save. Try again, or call the office.",
  "login.phoneTitle": "Driver sign-in",
  "login.phone": "Phone number",
  "login.sendCode": "Text me a code",
  "login.code": "Code from the text",
  "login.verify": "Sign in",
  "login.badPhone": "Enter a 10-digit phone number.",
  "login.badCode": "That code didn't work. Request a new one.",
  "login.rateLimited": "Too many attempts. Wait a few minutes and try again.",
  "login.systemError": "Couldn't send the code right now. Call the office.",
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  "driver.title": "Ruta de hoy",
  "driver.empty": "No hay paradas hoy.",
  "driver.signOut": "Cerrar sesión",
  "driver.language": "English",
  "driver.kind.drop": "Entregar",
  "driver.kind.pickup": "Recoger",
  "driver.kind.dump": "Botar",
  "driver.done": "Hecho",
  "driver.call": "Llamar",
  "driver.map": "Mapa",
  "driver.can": "Contenedor",
  "driver.chooseCan": "¿Qué contenedor entregaste?",
  "driver.dropped": "Entregado",
  "driver.pickedUp": "Recogido",
  "driver.ticket": "Ticket de la báscula",
  "driver.ticketPhoto": "Foto del ticket",
  "driver.ticketNumber": "Número de ticket",
  "driver.landfill": "Vertedero",
  "driver.tons": "Toneladas",
  "driver.fee": "Costo ($)",
  "driver.saveTicket": "Guardar ticket",
  "driver.notes": "Notas",
  "driver.error": "No se guardó. Intenta de nuevo o llama a la oficina.",
  "login.phoneTitle": "Entrada de chofer",
  "login.phone": "Número de teléfono",
  "login.sendCode": "Envíame un código",
  "login.code": "Código del mensaje",
  "login.verify": "Entrar",
  "login.badPhone": "Escribe un número de 10 dígitos.",
  "login.badCode": "Ese código no funcionó. Pide uno nuevo.",
  "login.rateLimited": "Demasiados intentos. Espera unos minutos e intenta de nuevo.",
  "login.systemError": "No se pudo enviar el código ahora. Llama a la oficina.",
};

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, es };

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "es";
}

export function t(locale: Locale, key: MessageKey): string {
  return dictionaries[locale][key] ?? en[key];
}

export function translator(locale: Locale) {
  return (key: MessageKey) => t(locale, key);
}

/** The whole dictionary for a locale, as a plain object client components can receive. */
export function messages(locale: Locale): Record<MessageKey, string> {
  return { ...dictionaries[locale] };
}
