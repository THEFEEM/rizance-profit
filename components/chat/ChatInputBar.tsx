"use client";

import { useRef, useState } from "react";
import { Plus, Send } from "lucide-react";
import { ChatAttachSheet } from "@/components/chat/ChatAttachSheet";
import {
  detectMediaType,
  downscaleImage,
  type ImageMediaType,
} from "@/lib/image-utils";

export type ChatScanPayload = {
  imageBase64: string;
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
  onScanStart: () => void;
  onScanError: (message: string) => void;
  sending?: boolean;
}) {
  const [text, setText] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const busy = sending || processingImage;

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText("");
  }

  async function handleImage(file: File | undefined, input: HTMLInputElement | null) {
    if (!file) return;

    const mediaType = detectMediaType(file);
    if (!mediaType) {
      onScanError("รองรับเฉพาะไฟล์ JPG หรือ PNG");
      if (input) input.value = "";
      return;
    }

    setProcessingImage(true);
    onScanStart();

    try {
      const imageBase64 = await downscaleImage(file, mediaType);
      await onScan({ imageBase64, mediaType });
    } catch {
      onScanError("อ่านรูปไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setProcessingImage(false);
      if (input) input.value = "";
    }
  }

  return (
    <div className="border-t-[0.5px] border-rz-border bg-rz-bg px-3 py-2.5">
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
              submit();
            }
          }}
          placeholder="พิมพ์ เช่น ซื้อกาแฟ 100"
          disabled={busy}
          className="flex-1 rounded-full border-[0.5px] border-rz-border bg-rz-card px-4 py-2.5 text-sm text-rz-text focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !text.trim()}
          aria-label="ส่งข้อความ"
          className="tap-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rz-green text-rz-bg disabled:opacity-40"
        >
          <Send size={18} aria-hidden />
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleImage(e.target.files?.[0], e.target)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleImage(e.target.files?.[0], e.target)}
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
