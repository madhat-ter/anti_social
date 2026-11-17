/**
 * RFC §10.13: signing in with a handle and a 6-digit PIN. The rules live here so the join and
 * settings forms say the same thing the server enforces.
 */
export const PIN_LENGTH = 6;
export const PIN_RULES = {
  /** wrong PINs in a row before the account rests */
  triesBeforeRest: 5,
  /** the first rest; each further one doubles it */
  restMinutes: 15,
  /** wrong PINs in one day before the account waits for a recovery code or an admin */
  dayLimit: 10,
  /** how long an admin's reset code works */
  resetCodeHours: 1,
  /** an admin's reset code: this many symbols, shown as XXXX-XXXX */
  resetCodeLength: 8,
} as const;

const runs = (() => {
  const up = '01234567890';
  const down = '98765432109';
  const out = new Set<string>();
  for (let i = 0; i + PIN_LENGTH <= up.length; i++) { out.add(up.slice(i, i + PIN_LENGTH)); out.add(down.slice(i, i + PIN_LENGTH)); }
  return out;
})();

/** The 6-digit forms of a birthday (YYYY-MM-DD) that people reach for first. */
function birthdayForms(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return [];
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const yy = y.slice(2);
  return [`${d}${mo}${yy}`, `${mo}${d}${yy}`, `${yy}${mo}${d}`, `${mo}${y}`, `${y}${mo}`];
}

/**
 * Why a PIN is not allowed, or null if it is. Refused: anything but six digits, one digit six
 * times, a straight run (123456, 654321), a repeated pair or triple (121212, 123123), and the
 * member's own birthday written as six digits.
 */
export function pinProblem(pin: string, birthday?: string | null): string | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return `Your PIN is ${PIN_LENGTH} digits, numbers only.`;
  if (/^(\d)\1+$/.test(pin)) return 'That PIN is one digit over and over. Pick something harder to guess.';
  if (runs.has(pin)) return 'That PIN is a straight run of digits. Pick something harder to guess.';
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return 'That PIN repeats a short pattern. Pick something harder to guess.';
  if (birthday && birthdayForms(birthday).includes(pin)) return 'That PIN is your birthday. Pick something only you would know.';
  return null;
}
