import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ChatView } from "@/components/chat/ChatView";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { getPersonalChatMessages } from "@/lib/personal-chat-queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PersonalChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const ctx = await resolveTodayContext(
    user.id,
    undefined,
    cookieStore.get(CONTEXT_COOKIE)?.value,
  );

  if (ctx.mode !== "personal") {
    redirect("/home");
  }

  const messages = await getPersonalChatMessages(user.id);

  return (
    <ChatView
      initialMessages={messages}
      currency={user.currency}
      apiBase="/api/personal/chat"
      variant="personal"
    />
  );
}
