"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Send, X } from "lucide-react";
import { ChatAttachSheet } from "@/components/chat/ChatAttachSheet";
import { detectMediaType, type ImageMediaType } from "@/lib/image-utils";

export type ChatScanPayload = {
  file: File;
  mediaType: ImageMediaType;
  caption?: string;
};

type PendingImage = {
  file: File;
  preview: string;
  mediaType: ImageMediaType;
};

export function ChatInputBar({
  onSend,
  onScan,
  onScanStart,
  onScanError,
  sending = false,
}: {
  onSend: (text: string) => void;
  onScan: (payload: ChatScanPayload) => void | Promise<void>;
  onScanStart: (caption?: string) => void;
  onScanError: (message: string) => void;
  sending?: boolean;
}) {
  const [text, setText] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const busy = sending || processingImage;

  useEffect(() => {
    return () => {
      if (pendingImage?.preview) URL.revokeObjectURL(pendingImage.preview);
    };
  }, [pendingImage]);

  function clearPendingImage() {
    setPendingImage((current) => {
      if (current?.preview) URL.revokeObjectURL(current.preview);
      return null;
    });
  }

  async function submit() {
    if (busy) return;

    if (pendingImage) {
      const caption = text.trim();
      onScanStart(caption || undefined);
      setProcessingImage(true);

      try {
        await onScan({
          file: pendingImage.file,
          mediaType: pendingImage.mediaType,
          caption: caption || undefined,
        });
        setText("");
        clearPendingImage();
      } catch {
        onScanError("อ่านรูปไม่สำเร็จ ลองใหม่อีกครั้ง");
      } finally {
        setProcessingImage(false);
      }
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }

  function handleImage(file: File | undefined, input: HTMLInputElement | null) {
    if (!file) return;

    const mediaType = detectMediaType(file);
    if (!mediaType) {
      onScanError("รองรับเฉพาะไฟล์ JPG หรือ PNG");
      if (input) input.value = "";
      return;
    }

    setPendingImage((current) => {
      if (current?.preview) URL.revokeObjectURL(current.preview);
      return {
        file,
        preview: URL.createObjectURL(file),
        mediaType,
      };
    });
    if (input) input.value = "";
  }

  const canSubmit = Boolean(pendingImage || text.trim());

  return (
    <div className="border-t-[0.5px] border-rz-border bg-rz-bg">
      {pendingImage && (
        <div className="flex items-center gap-2 border-b-[0.5px] border-rz-border px-3 py-2">
          <img
            src={pendingImage.preview}
            alt="สลิปพร้อมส่ง"
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
          />
          <span className="flex-1 text-xs text-rz-muted">สลิปพร้อมส่ง</span>
          <button
            type="button"
            onClick={clearPendingImage}
            disabled={busy}
            aria-label="ลบรูป"
            className="tap-target flex h-8 w-8 items-center justify-center rounded-full text-rz-muted disabled:opacity-40"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      )}

      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            disabled={busy}
            aria-label="แนบรูป"
            className="tap-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[0.5px] border-rz-border bg-rz-card text-rz-text disabled:opacity-40"
          >
            <Plus size={20} aria-hidden />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={
              pendingImage ? "พิมพ์คำอธิบาย เช่น ค่าอาหาร" : "พิมพ์ เช่น ซื้อกาแฟ 100"
            }
            disabled={busy}
            className="flex-1 rounded-full border-[0.5px] border-rz-border bg-rz-card px-4 py-2.5 text-sm text-rz-text focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !canSubmit}
            aria-label="ส่งข้อความ"
            className="tap-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rz-green text-rz-bg disabled:opacity-40"
          >
            <Send size={18} aria-hidden />
          </button>
        </div>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleImage(e.target.files?.[0], e.target)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleImage(e.target.files?.[0], e.target)}
      />

      {sheetOpen && (
        <ChatAttachSheet
          onClose={() => setSheetOpen(false)}
          onCamera={() => {
            cameraRef.current?.click();
            setSheetOpen(false);
          }}
          onGallery={() => {
            galleryRef.current?.click();
            setSheetOpen(false);
          }}
          onFile={() => {
            galleryRef.current?.click();
            setSheetOpen(false);
          }}
        />
      )}
    </div>
  );
}
