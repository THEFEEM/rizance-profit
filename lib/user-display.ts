/** Display initials for avatar circles (1–2 chars from name). */
export function displayInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return (name.trim().slice(0, 2) || "?").toUpperCase();
}
