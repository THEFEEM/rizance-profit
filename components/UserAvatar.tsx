"use client";

import { useState } from "react";
import Image from "next/image";
import { displayInitials } from "@/lib/user-display";

type Props = {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
  ringClassName?: string;
};

const sizeClasses = {
  sm: "h-10 w-10 text-sm",
  md: "h-20 w-20 text-2xl",
  lg: "h-20 w-20 text-2xl",
};

export function UserAvatar({ name, avatarUrl, size = "sm", ringClassName = "ring-rz-border" }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(avatarUrl && !imgFailed);
  const dim = size === "sm" ? 40 : 80;

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-rz-elevated font-medium text-rz-text ring-2 ${sizeClasses[size]} ${ringClassName}`}
      aria-hidden
    >
      {showImage ? (
        <Image
          src={avatarUrl!}
          alt=""
          width={dim}
          height={dim}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
          unoptimized
        />
      ) : (
        displayInitials(name)
      )}
    </div>
  );
}
