// Meta forbids asking for or sharing full card numbers, bank accounts and ID
// documents over WhatsApp. Pure module so it can be unit-tested on its own.

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** A full card number or an Argentine CBU/CVU, with or without separators. */
export function hasCardOrBankNumber(text: string): boolean {
  for (const m of text.matchAll(/\d(?:[ .-]?\d){12,21}/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length === 22) return true;
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true;
  }
  return false;
}
