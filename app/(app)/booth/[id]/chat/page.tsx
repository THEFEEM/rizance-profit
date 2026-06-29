import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ChatView } from "@/components/chat/ChatView";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { getBoothChatMessages } from "@/lib/booth-chat-queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BoothChatPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const cookieStore = await cookies();
  const ctx = await resolveTodayContext(
    user.id,
    undefined,
    cookieStore.get(CONTEXT_COOKIE)?.value,
  );

  if (ctx.mode !== "booth" || ctx.boothId !== id) {
    redirect("/");
  }

  const messages = await getBoothChatMessages(user.id, id);

  return (
    <ChatView
      initialMessages={messages}
      currency={user.currency}
      apiBase={`/api/booth/${id}/chat`}
      variant="booth"
    />
  );
}
