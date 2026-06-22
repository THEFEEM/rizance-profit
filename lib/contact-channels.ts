import { Mail, Phone, Share2, type LucideIcon } from "lucide-react";

export type ContactChannel = {
  id: string;
  label: string;
  value: string;
  href: string;
  icon: LucideIcon;
};

/** Profile “ติดต่อเรา” rows — add LINE OA here later. */
export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  {
    id: "tiktok-ig",
    label: "TikTok / Instagram",
    value: "@thefeem",
    href: "https://www.tiktok.com/@thefeem",
    icon: Share2,
  },
  {
    id: "phone",
    label: "โทรศัพท์",
    value: "096-719-8011",
    href: "tel:0967198011",
    icon: Phone,
  },
  {
    id: "email",
    label: "อีเมล",
    value: "lutfee7890@gmail.com",
    href: "mailto:lutfee7890@gmail.com",
    icon: Mail,
  },
] as const;
