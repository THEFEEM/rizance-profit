"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import {
  ChatInputBar,
  type ChatScanPayload,
} from "@/components/chat/ChatInputBar";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { EntryFormLayout } from "@/components/entry/EntryFormLayout";
import { EntryPageHeader } from "@/components/entry/EntryPageHeader";
import { apiFetch } from "@/lib/api-client";
import type { ChatMessageRow } from "@/lib/chat-queries";
import { downscaleImage, generateThumbnail } from "@/lib/image-utils";

type ChatPostResponse = {
  messages: ChatMessageRow[];
};

type UpdateCategoryResponse = {
  ok: true;
  category: string;
  categoryLabel: string;
};

export function ChatView({
  initialMessages,
  currency,
}: {
  initialMessages: ChatMessageRow[];
  currency: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(text: string) {
    const tempUser: ChatMessageRow = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      imageThumb: null,
      entryId: null,
      entryKind: null,
      cardData: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUser]);
    setSending(true);
    setError(null);

    const res = await apiFetch<ChatPostResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ text }),
    });

    if (res.ok && res.data?.messages) {
      setMessages((prev) => [...prev, ...res.data.messages]);
      router.refresh();
    } else {
      setError(res.ok ? "ส่งข้อความไม่สำเร็จ" : res.message);
    }

    setSending(false);
  }

  function handleScanStart(caption?: string) {
    const tempUser: ChatMessageRow = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: caption || "📷 สลิป",
      imageThumb: null,
      entryId: null,
      entryKind: null,
      cardData: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUser]);
    setSending(true);
    setError(null);
  }

  async function handleScan({ file, mediaType, caption }: ChatScanPayload) {
    const imageBase64 = await downscaleImage(file, mediaType);
    const thumbnail = await generateThumbnail(file, mediaType);

    const res = await apiFetch<ChatPostResponse>("/api/chat/scan", {
      method: "POST",
      body: JSON.stringify({
        imageBase64,
        mediaType,
        thumbnail,
        caption,
        kind: "expense",
        slipType: "transfer",
      }),
    });

    if (res.ok && res.data?.messages) {
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => !m.id.startsWith("temp-"));
        return [...withoutTemp, ...res.data.messages];
      });
      router.refresh();
    } else {
      setError(res.ok ? "สแกนสลิปไม่สำเร็จ" : res.message);
      throw new Error("scan_failed");
    }

    setSending(false);
  }

  async function handleCategoryChange(messageId: string, category: string) {
    const res = await apiFetch<UpdateCategoryResponse>(
      `/api/chat/${messageId}/update-category`,
      {
        method: "POST",
        body: JSON.stringify({ category }),
      },
    );

    if (res.ok && res.data) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.cardData
            ? {
                ...m,
                cardData: {
                  ...m.cardData,
                  category: res.data.category,
                  categoryLabel: res.data.categoryLabel,
                },
              }
            : m,
        ),
      );
      router.refresh();
      return;
    }

    const message = res.ok ? "แก้หมวดไม่สำเร็จ" : res.message;
    setError(message);
    throw new Error(message);
  }

  async function handleDelete(messageId: string) {
    const res = await apiFetch<{ ok: true }>(`/api/chat/${messageId}/delete-entry`, {
      method: "POST",
    });

    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, entryId: null } : m)),
      );
      router.refresh();
    } else {
      setError(res.message);
    }
  }

  return (
    <EntryFormLayout
      dataContext="ai-chat"
      pad={
        <ChatInputBar
          onSend={handleSend}
          onScan={handleScan}
          onScanStart={handleScanStart}
          onScanError={(message) => {
            setError(message);
            setSending(false);
          }}
          sending={sending}
        />
      }
    >
      <EntryPageHeader title="Rizq" backLabel="← กลับ" />

      <div className="flex flex-col gap-3 px-4 py-4">
        {messages.length === 0 && <ChatEmptyState />}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            currency={currency}
            onDelete={handleDelete}
            onCategoryChange={handleCategoryChange}
          />
        ))}
        {error && (
          <p className="text-center text-xs text-rz-red" role="alert">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>
    </EntryFormLayout>
  );
}
