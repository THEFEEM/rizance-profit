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
import { UpgradePrompt } from "@/components/chat/UpgradePrompt";
import { apiFetch } from "@/lib/api-client";
import {
  CATEGORY_LABELS,
  isReceiptSplitCard,
  type ChatMessageRow,
  type ReceiptItemChanges,
} from "@/lib/chat-types";
import { personalExpenseLabel } from "@/lib/personal-categories";
import { downscaleImage, generateThumbnail } from "@/lib/image-utils";

type ChatPostResponse = {
  messages: ChatMessageRow[];
};

type UpdateCategoryResponse = {
  ok: true;
  category: string;
  categoryLabel: string;
};

type ConfirmReceiptResponse = {
  ok: true;
  entryIds: string[];
};

type CancelReceiptResponse = {
  ok: true;
};

type UpdatePaymentResponse = {
  ok: true;
  paymentMethod: "cash" | "transfer";
};

type UpdateKindResponse = {
  ok: true;
  entryId: string;
  kind: "income" | "expense";
  category: string;
  categoryLabel: string;
};

const TEMP_LOADING_ID = "temp-loading";

function withoutTempMessages(messages: ChatMessageRow[]): ChatMessageRow[] {
  return messages.filter((m) => !m.id.startsWith("temp-") && m.id !== TEMP_LOADING_ID);
}

function makeLoadingMessage(content: string): ChatMessageRow {
  return {
    id: TEMP_LOADING_ID,
    role: "assistant",
    content,
    imageThumb: null,
    entryId: null,
    entryKind: null,
    cardData: null,
    createdAt: new Date().toISOString(),
    isLoading: true,
  };
}

export function ChatView({
  initialMessages,
  currency,
  apiBase = "/api/chat",
  variant = "shop",
}: {
  initialMessages: ChatMessageRow[];
  currency: string;
  apiBase?: string;
  variant?: "shop" | "personal" | "booth";
}) {
  const isPersonal = variant === "personal";
  const isBooth = variant === "booth";
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaPrompt, setQuotaPrompt] = useState<{
    feature: string;
    limit: number;
    used: number;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, quotaPrompt]);

  function handleQuotaExceeded(
    res: { status: number; code?: string; limit?: number; used?: number },
    feature: string,
  ): boolean {
    if (res.status === 429 && res.code === "quota_exceeded") {
      setMessages((prev) => withoutTempMessages(prev));
      setQuotaPrompt({
        feature,
        limit: res.limit ?? 0,
        used: res.used ?? 0,
      });
      setError(null);
      setSending(false);
      return true;
    }
    return false;
  }

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

    setMessages((prev) => [...prev, tempUser, makeLoadingMessage("กำลังวิเคราะห์...")]);
    setSending(true);
    setError(null);
    setQuotaPrompt(null);

    const res = await apiFetch<ChatPostResponse>(apiBase, {
      method: "POST",
      body: JSON.stringify({ text }),
    });

    if (res.ok && res.data?.messages) {
      setMessages((prev) => [...withoutTempMessages(prev), ...res.data.messages]);
      router.refresh();
    } else if (!res.ok && handleQuotaExceeded(res, "Rizq AI")) {
      // quota prompt shown
    } else {
      setMessages((prev) => withoutTempMessages(prev));
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

    setMessages((prev) => [
      ...prev,
      tempUser,
      makeLoadingMessage("กำลังอ่านใบเสร็จ..."),
    ]);
    setSending(true);
    setError(null);
    setQuotaPrompt(null);
  }

  async function handleScan({ file, mediaType, caption }: ChatScanPayload) {
    const imageBase64 = await downscaleImage(file, mediaType);
    const thumbnail = await generateThumbnail(file, mediaType);

    const scanUrl = isPersonal || isBooth ? apiBase : `${apiBase}/scan`;
    const res = await apiFetch<ChatPostResponse>(scanUrl, {
      method: "POST",
      body: JSON.stringify({
        imageBase64,
        mediaType,
        thumbnail,
        caption,
        kind: "expense",
        slipType: "receipt",
      }),
    });

    if (res.ok && res.data?.messages) {
      setMessages((prev) => [...withoutTempMessages(prev), ...res.data.messages]);
      router.refresh();
    } else if (!res.ok && handleQuotaExceeded(res, "สแกนสลิป")) {
      // quota prompt shown
    } else {
      setMessages((prev) => withoutTempMessages(prev));
      setError(res.ok ? "สแกนสลิปไม่สำเร็จ" : res.message);
      throw new Error("scan_failed");
    }

    setSending(false);
  }

  async function handleCategoryChange(messageId: string, category: string) {
    const res = await apiFetch<UpdateCategoryResponse>(
      `${apiBase}/${messageId}/update-category`,
      {
        method: "POST",
        body: JSON.stringify({ category }),
      },
    );

    if (res.ok && res.data) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.cardData && !isReceiptSplitCard(m.cardData)
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

  async function handleConfirmReceipt(messageId: string) {
    const res = await apiFetch<ConfirmReceiptResponse>(
      `${apiBase}/${messageId}/confirm-receipt`,
      { method: "POST" },
    );

    if (res.ok && res.data) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !isReceiptSplitCard(m.cardData)) return m;
          return {
            ...m,
            cardData: {
              ...m.cardData,
              status: "confirmed" as const,
              entryIds: res.data.entryIds,
            },
          };
        }),
      );
      router.refresh();
      return;
    }

    throw new Error(res.ok ? "บันทึกไม่สำเร็จ" : res.message);
  }

  async function handleCancelReceipt(messageId: string) {
    const res = await apiFetch<CancelReceiptResponse>(
      `${apiBase}/${messageId}/cancel-receipt`,
      { method: "POST" },
    );

    if (res.ok && res.data) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !isReceiptSplitCard(m.cardData)) return m;
          return {
            ...m,
            cardData: {
              ...m.cardData,
              status: "cancelled" as const,
            },
          };
        }),
      );
      router.refresh();
      return;
    }

    throw new Error(res.ok ? "ยกเลิกไม่สำเร็จ" : res.message);
  }

  async function handleUpdateReceiptItem(
    messageId: string,
    itemId: string,
    changes: ReceiptItemChanges,
  ) {
    const res = await apiFetch<{ ok: true; itemsSum: string }>(
      `${apiBase}/${messageId}/update-receipt-item`,
      {
        method: "PATCH",
        body: JSON.stringify({ itemId, ...changes }),
      },
    );

    if (res.ok && res.data) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !isReceiptSplitCard(m.cardData)) return m;
          return {
            ...m,
            cardData: {
              ...m.cardData,
              itemsSum: res.data.itemsSum,
              items: m.cardData.items.map((item) => {
                if (item.id !== itemId) return item;
                const updated = { ...item };
                if (changes.note !== undefined) updated.note = changes.note;
                if (changes.amount !== undefined) updated.amount = changes.amount;
                if (changes.category !== undefined) {
                  updated.category = changes.category;
                  updated.categoryLabel = isPersonal
                    ? personalExpenseLabel(changes.category)
                    : CATEGORY_LABELS[changes.category] ?? "อื่นๆ";
                }
                return updated;
              }),
            },
          };
        }),
      );
      return;
    }

    throw new Error(res.ok ? "บันทึกไม่สำเร็จ" : res.message);
  }

  async function handleKindChange(messageId: string, kind: "income" | "expense") {
    const res = await apiFetch<UpdateKindResponse>(
      `${apiBase}/${messageId}/update-kind`,
      {
        method: "PATCH",
        body: JSON.stringify({ kind }),
      },
    );

    if (res.ok && res.data) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.cardData && !isReceiptSplitCard(m.cardData)
            ? {
                ...m,
                entryId: res.data.entryId,
                entryKind: res.data.kind,
                cardData: {
                  ...m.cardData,
                  kind: res.data.kind,
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

    throw new Error(res.ok ? "บันทึกไม่สำเร็จ" : res.message);
  }

  async function handlePaymentMethodChange(
    messageId: string,
    paymentMethod: "cash" | "transfer",
  ) {
    const res = await apiFetch<UpdatePaymentResponse>(
      `${apiBase}/${messageId}/update-payment`,
      {
        method: "PATCH",
        body: JSON.stringify({ paymentMethod }),
      },
    );

    if (res.ok && res.data) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.cardData && !isReceiptSplitCard(m.cardData)
            ? {
                ...m,
                cardData: {
                  ...m.cardData,
                  paymentMethod: res.data.paymentMethod,
                },
              }
            : m,
        ),
      );
      router.refresh();
      return;
    }

    throw new Error(res.ok ? "บันทึกไม่สำเร็จ" : res.message);
  }

  async function handleReceiptMetaChange(
    messageId: string,
    meta: { paymentMethod: "cash" | "transfer" },
  ) {
    const res = await apiFetch<UpdatePaymentResponse>(
      `${apiBase}/${messageId}/update-receipt-meta`,
      {
        method: "PATCH",
        body: JSON.stringify(meta),
      },
    );

    if (res.ok && res.data) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !isReceiptSplitCard(m.cardData)) return m;
          return {
            ...m,
            cardData: {
              ...m.cardData,
              paymentMethod: res.data.paymentMethod,
            },
          };
        }),
      );
      router.refresh();
      return;
    }

    throw new Error(res.ok ? "บันทึกไม่สำเร็จ" : res.message);
  }

  async function handleDelete(messageId: string) {
    const target = messages.find((m) => m.id === messageId);
    const isReceipt =
      target?.cardData != null && isReceiptSplitCard(target.cardData);

    const res = await apiFetch<{ ok: true }>(`${apiBase}/${messageId}/delete-entry`, {
      method: "POST",
    });

    if (res.ok) {
      if (isPersonal || isReceipt) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, entryId: null } : m)),
        );
      }
      router.refresh();
    } else {
      setError(res.message);
    }
  }

  return (
    <EntryFormLayout
      dataContext={isPersonal ? "personal-ai-chat" : isBooth ? "booth-ai-chat" : "ai-chat"}
      pad={
        <ChatInputBar
          onSend={handleSend}
          onScan={handleScan}
          onScanStart={handleScanStart}
          onScanError={(message) => {
            setMessages((prev) => withoutTempMessages(prev));
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
            onConfirmReceipt={handleConfirmReceipt}
            onCancelReceipt={handleCancelReceipt}
            onUpdateReceiptItem={handleUpdateReceiptItem}
            onPaymentMethodChange={handlePaymentMethodChange}
            onKindChange={handleKindChange}
            onReceiptMetaChange={handleReceiptMetaChange}
            variant={variant}
          />
        ))}
        {quotaPrompt && (
          <UpgradePrompt
            feature={quotaPrompt.feature}
            limit={quotaPrompt.limit}
            used={quotaPrompt.used}
            onUpgrade={() => router.push("/pricing")}
          />
        )}
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
