import { redirect } from "next/navigation";
import { ChatView } from "@/components/chat/ChatView";
import { listChatMessages } from "@/lib/chat-queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const messages = await listChatMessages(user.id);

  return <ChatView initialMessages={messages} currency={user.currency} />;
}
