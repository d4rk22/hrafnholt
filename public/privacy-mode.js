export const PRIVACY_ALIASES = Object.freeze([
  "Alder",
  "Aspen",
  "Birch",
  "Cedar",
  "Cypress",
  "Dogwood",
  "Elm",
  "Fir",
  "Hawthorn",
  "Hazel",
  "Juniper",
  "Larch",
  "Linden",
  "Magnolia",
  "Maple",
  "Pine",
  "Redwood",
  "Rowan",
  "Sequoia",
  "Spruce",
  "Sycamore",
  "Willow",
  "Yew",
  "Zelkova",
]);

function secureRandomUnit() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] / 2 ** 32;
  }
  return Math.random();
}

function shuffle(values, random) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const unit = Math.min(0.999_999_999_999, Math.max(0, Number(random()) || 0));
    const swapIndex = Math.floor(unit * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

const normalizedUsername = (username) => String(username ?? "unknown viewer").trim().toLocaleLowerCase("en-US") || "unknown viewer";

export function createPrivacyAliasRegistry(random = secureRandomUnit) {
  const availableAliases = shuffle(PRIVACY_ALIASES, random);
  const assignments = new Map();

  return Object.freeze({
    aliasFor(username) {
      const key = normalizedUsername(username);
      if (!assignments.has(key)) {
        assignments.set(key, availableAliases[assignments.size % availableAliases.length]);
      }
      return assignments.get(key);
    },
  });
}

export function displayedPlexUsername(username, mode, registry) {
  return mode === "private" ? String(username ?? "unknown viewer") : registry.aliasFor(username);
}

export function privacyModeKeyAction(event) {
  if (event.defaultPrevented || event.repeat) return null;
  if (event.key === "Escape") return "public";

  const tagName = String(event.target?.tagName ?? "").toLowerCase();
  const editable = event.target?.isContentEditable || ["input", "textarea", "select"].includes(tagName);
  if (editable || event.metaKey || event.ctrlKey || event.altKey) return null;

  return event.shiftKey && event.key?.toLowerCase() === "p" ? "toggle" : null;
}
