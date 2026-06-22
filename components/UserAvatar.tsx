"use client";

import { useState } from "react";
import Image from "next/image";
import { displayInitials } from "@/lib/user-display";

const BRAND_LOGO_SRC = "/icons/icon-192.png";

type Props = {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
  ringClassName?: string;
  /** When no avatar URL, show Rizance logo instead of name initials. */
  brandFallback?: boolean;
};

const sizeClasses = {
  sm: "h-10 w-10 text-sm",
  md: "h-20 w-20 text-2xl",
  lg: "h-20 w-20 text-2xl",
};

export function UserAvatar({
  name,
  avatarUrl,
  size = "sm",
  ringClassName = "ring-rz-border",
  brandFallback = false,
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const showAvatar = Boolean(avatarUrl && !imgFailed);
  const dim = size === "sm" ? 40 : 80;

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-rz-elevated font-medium text-rz-text ring-2 ${sizeClasses[size]} ${ringClassName}`}
      aria-hidden
    >
      {showAvatar ? (
        <Image
          src={avatarUrl!}
          alt=""
          width={dim}
          height={dim}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
          unoptimized
        />
      ) : brandFallback ? (
        <Image
          src={BRAND_LOGO_SRC}
          alt=""
          width={dim}
          height={dim}
          className="h-full w-full object-cover"
          unoptimized
        />
      ) : (
        displayInitials(name)
      )}
    </div>
  );
}
