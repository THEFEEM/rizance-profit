"use client";

import type { ReactNode } from "react";
import { Camera, Image as ImageIcon, Paperclip } from "lucide-react";

function SheetOption({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap-target flex w-full items-center gap-3 rounded-[12px] px-4 py-3.5 text-left text-sm font-medium text-rz-text active:bg-rz-elevated"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rz-elevated text-rz-muted">
        {icon}
      </span>
      {label}
    </button>
  );
}

export function ChatAttachSheet({
  onClose,
  onCamera,
  onGallery,
  onFile,
}: {
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onFile: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full rounded-t-[20px] border-[0.5px] border-rz-border bg-rz-card p-2"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="แนบรูป"
      >
        <SheetOption
          icon={<Camera size={18} aria-hidden />}
          label="กล้อง"
          onClick={onCamera}
        />
        <SheetOption
          icon={<ImageIcon size={18} aria-hidden />}
          label="รูปภาพ"
          onClick={onGallery}
        />
        <SheetOption
          icon={<Paperclip size={18} aria-hidden />}
          label="ไฟล์"
          onClick={onFile}
        />
      </div>
    </div>
  );
}
