import type { ChatMessageRow } from "@/lib/chat-queries";
import { ChatEntryCard } from "@/components/chat/ChatEntryCard";

export function ChatMessage({
  message,
  currency,
  onDelete,
  onCategoryChange,
}: {
  message: ChatMessageRow;
  currency: string;
  onDelete: (messageId: string) => void;
  onCategoryChange: (messageId: string, category: string) => Promise<void>;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-rz-green px-4 py-2.5 text-sm text-rz-bg">
          {message.imageThumb ? (
            <div>
              {message.content && message.content !== "📷 สลิป" && (
                <p className="mb-2">{message.content}</p>
              )}
              <div className="overflow-hidden rounded-lg">
                <img
                  src={`data:image/jpeg;base64,${message.imageThumb}`}
                  alt="สลิป"
                  className="h-auto max-w-[200px] object-contain"
                />
              </div>
            </div>
          ) : (
            message.content
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      {message.cardData ? (
        <ChatEntryCard
          card={message.cardData}
          messageId={message.id}
          entryId={message.entryId}
          onDelete={onDelete}
          onCategoryChange={onCategoryChange}
          currency={currency}
        />
      ) : (
        <div className="max-w-[80%] rounded-2xl rounded-bl-md border-[0.5px] border-rz-border bg-rz-card px-4 py-2.5 text-sm text-rz-text">
          {message.content}
        </div>
      )}
    </div>
  );
}
