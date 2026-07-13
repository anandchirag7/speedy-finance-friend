import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatIndex,
});

function ChatIndex() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MessageSquare className="h-6 w-6" />
        </div>
        <h2 className="font-display text-xl font-semibold">Chat with your money</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask questions about your accounts, spending, budgets and goals. Start a new
          conversation from the sidebar to get going.
        </p>
        <div className="mt-6 grid gap-2 text-left text-sm">
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="font-medium">Try asking</div>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              <li>• Where did most of my money go this month?</li>
              <li>• What's my current net worth breakdown?</li>
              <li>• Which bills are due in the next 7 days?</li>
              <li>• How am I tracking against my budgets?</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
