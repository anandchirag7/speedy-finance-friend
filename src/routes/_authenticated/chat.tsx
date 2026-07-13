import { createFileRoute, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import {
  createChatThread,
  deleteChatThread,
  listChatThreads,
} from "@/lib/chat.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatLayout,
});

function ChatLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listChatThreads);
  const createFn = useServerFn(createChatThread);
  const deleteFn = useServerFn(deleteChatThread);
  const params = useParams({ strict: false }) as { threadId?: string };
  const activeId = params.threadId;

  const { data: threads = [] } = useQuery({
    queryKey: ["chat-threads"],
    queryFn: () => listFn(),
  });

  const [creating, setCreating] = useState(false);

  async function newThread() {
    setCreating(true);
    try {
      const t = await createFn({ data: {} });
      await qc.invalidateQueries({ queryKey: ["chat-threads"] });
      navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
    } finally {
      setCreating(false);
    }
  }

  async function removeThread(id: string) {
    if (!confirm("Delete this conversation?")) return;
    await deleteFn({ data: { id } });
    await qc.invalidateQueries({ queryKey: ["chat-threads"] });
    if (activeId === id) navigate({ to: "/chat" });
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full">
      <aside className="flex w-64 flex-col border-r bg-muted/30">
        <div className="flex items-center justify-between border-b p-3">
          <div className="text-sm font-semibold">Conversations</div>
          <Button size="sm" onClick={newThread} disabled={creating} className="h-7 gap-1">
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {threads.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">
              No conversations yet. Click New to start.
            </div>
          ) : (
            <ul className="space-y-1">
              {threads.map((t: any) => (
                <li key={t.id} className="group relative">
                  <Link
                    to="/chat/$threadId"
                    params={{ threadId: t.id }}
                    className={cn(
                      "flex flex-col rounded-md px-2 py-2 pr-8 text-sm hover:bg-accent",
                      activeId === t.id && "bg-accent",
                    )}
                  >
                    <span className="line-clamp-1 font-medium">{t.title}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(t.last_message_at), { addSuffix: true })}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeThread(t.id)}
                    className="absolute right-1 top-1.5 hidden rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export { MessageSquare };
