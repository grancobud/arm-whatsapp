/** Sin tildes y en minúsculas, para comparar texto escrito por personas. */
export function plainText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
