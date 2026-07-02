import type { LucideIcon } from "lucide-react";

export type ChatExample = {
  user: string;
  kind: string;
  cat: string;
  amount: string;
  sign: "pos" | "neg";
};

export type ModeItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  title: string;
  desc: string;
};

export type Capability = {
  icon: LucideIcon;
  title: string;
  desc: string;
};

export type TrustItem = {
  icon: LucideIcon;
  title: string;
  desc: string;
};

export type ChartPoint = { d: string; v: number };

export type Plan = {
  key: string;
  name: string;
  price: string;
  period: string;
  tag: string | null;
  highlight: boolean;
  items: string[];
};

export type FaqEntry = { q: string; a: string };
