export type ContactChannel = {
  id: string;
  label: string;
  value: string;
  href: string;
  icon: string;
};

/** Profile “ติดต่อเรา” rows — add LINE OA here later. */
export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  {
    id: "tiktok-ig",
    label: "TikTok / Instagram",
    value: "@thefeem",
    href: "https://www.tiktok.com/@thefeem",
    icon: "📱",
  },
  {
    id: "phone",
    label: "โทรศัพท์",
    value: "096-719-8011",
    href: "tel:0967198011",
    icon: "📞",
  },
  {
    id: "email",
    label: "อีเมล",
    value: "lutfee7890@gmail.com",
    href: "mailto:lutfee7890@gmail.com",
    icon: "✉️",
  },
] as const;
