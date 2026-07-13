import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getThreadMessages } from "@/lib/chat.functions";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  component: ChatThread,
});

function ChatThread() {
  const { threadId } = Route.useParams();
  const qc = useQueryClient();
  const getMessagesFn = useServerFn(getThreadMessages);

  const { data: initialMessages, isLoading } = useQuery({
    queryKey: ["chat-messages", threadId],
    queryFn: () => getMessagesFn({ data: { threadId } }),
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading conversation…
      </div>
    );
  }

  return (
    <ChatInner
      key={threadId}
      threadId={threadId}
      initialMessages={(initialMessages ?? []) as UIMessage[]}
      onDone={() => {
        qc.invalidateQueries({ queryKey: ["chat-threads"] });
        qc.invalidateQueries({ queryKey: ["chat-messages", threadId] });
      }}
    />
  );
}

function ChatInner({
  threadId,
  initialMessages,
  onDone,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  onDone: () => void;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { threadId },
        fetch: async (input, init) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers = new Headers(init?.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          return fetch(input, { ...init, headers });
        },
      }),
    [threadId],
  );

  const { messages, sendMessage, status } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onFinish: () => onDone(),
  });

  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, status]);

  const busy = status === "submitted" || status === "streaming";

  async function handleSubmit(msg: PromptInputMessage) {
    const value = (msg.text ?? text).trim();
    if (!value || busy) return;
    setText("");
    await sendMessage({ text: value });
  }

  return (
    <div className="flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Ask anything about your finances.
            </div>
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  {m.parts.map((p, i) => {
                    if (p.type === "text") {
                      return m.role === "assistant" ? (
                        <MessageResponse key={i}>{p.text}</MessageResponse>
                      ) : (
                        <span key={i} className="whitespace-pre-wrap">{p.text}</span>
                      );
                    }
                    if (p.type?.startsWith?.("tool-")) {
                      const state = (p as any).state;
                      const name = (p.type as string).replace(/^tool-/, "");
                      return (
                        <div
                          key={i}
                          className="my-1 rounded-md border border-dashed bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground"
                        >
                          {state === "output-available"
                            ? `Looked up: ${name}`
                            : `Fetching: ${name}…`}
                        </div>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Thinking…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            placeholder="Ask about your accounts, spending, budgets…"
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={busy ? "streaming" : undefined} disabled={!text.trim()} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
