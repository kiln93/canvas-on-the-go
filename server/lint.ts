// Quick mechanical checks on a generated screen, passed to the reviewer as hints.
// Patterns come from the anti-slop rules in server/skills (open-design, hallmark, impeccable).

const RULES: { test: RegExp; message: string }[] = [
  { test: /\b(?:bg|text|from|to|via|border|ring)-(?:indigo|violet|purple)-\d/, message: "Uses indigo, violet or purple Tailwind defaults." },
  { test: /#(?:6366f1|4f46e5|8b5cf6|7c3aed|a855f7)\b/i, message: "Uses a stock indigo or violet hex." },
  { test: /\bbg-(?:gradient|linear)-to-|linear-gradient\(/, message: "Uses a gradient background." },
  { test: /\bbg-clip-text\b/, message: "Uses gradient or clipped text." },
  { test: /\p{Extended_Pictographic}/u, message: "Contains emoji; use Icon instead." },
  { test: /\buppercase\b[^"'`]*\btracking-(?:wide|wider|widest)/, message: "Small tracked all-caps label; allowed only as a grouped list header." },
  { test: /\btext-\[(?:[0-9]|10)px\]/, message: "Text smaller than 11px." },
  { test: /lorem ipsum|\bUser Name\b|\bItem [123]\b|\bAcme\b|John Doe/i, message: "Placeholder content." },
  { test: /https?:\/\/[^"'`\s]+\.(?:jpe?g|png|webp|gif)|unsplash|picsum|placehold/i, message: "External image URL; use a tinted placeholder." },
  { test: /\bshadow-(?:lg|xl|2xl)\b[^"'`]*\bborder\b|\bborder\b[^"'`]*\bshadow-(?:lg|xl|2xl)\b/, message: "Border and heavy shadow on the same element." },
  { test: /\bmenu\b["'][^>]*>|name=["']menu["']/, message: "Hamburger menu icon; iOS uses a tab bar or navigation stack." },
];

export function lintScreen(code: string, device: string): string[] {
  const out = RULES.filter((r) => r.test.test(code)).map((r) => r.message);
  if (/iphone|ipad/i.test(device) && !/<Screen\b/.test(code)) out.push("Phone or tablet screen without the Screen root (status bar and home indicator).");
  const primaries = code.match(/<Button(?![^>]*variant=)[^>]*>/g)?.length ?? 0;
  if (primaries > 1) out.push(`${primaries} filled primary buttons; keep one.`);
  return out;
}
