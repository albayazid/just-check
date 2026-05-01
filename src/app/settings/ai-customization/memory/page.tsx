"use client";

import Link from "next/link";
import { useState } from "react";
import { Brain, Check, ChevronLeft, Copy, Loader2, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAICustomizationSettings } from "@/hooks/use-ai-customization-settings";
import { useMemory, useRemoveMemory, useUpdateMemory } from "@/hooks/use-memory";
import { cn } from "@/lib/utils";

function normalizeMemoryLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("- ") ? trimmed.slice(2).trim() : trimmed;
}

const memoryMigrationPrompt = `I am switching to Lumy, a new chatbot. Please provide all the things you remember about me in a clear, comprehensive list. Include preferences, personal details, work context, communication style, recurring goals, ongoing projects, and any other useful long-term information you have learned about me.

Return your answer exactly in the following given format.

"I am switching to Lumy from [chatbot name]. Here are all the things [chatbot name] remembered about me:
- User prefers concise but clear explanations. [Example]
- User is working on a SaaS product called ExampleApp. [Example]
- User often asks for code changes in React and Next.js projects. [Example]
- User ...

I want you to remember them for my swift continuity."

### Rules:
- Make sure every remembered item is written as a bullet point beginning with "- User ...". 
- Do not add any extra commentary rather than the provided format.
- Do not include user name.
- If you don't remember anything, just politely deny that you don't have anything remembered.`;

export default function MemorySettingsPage() {
  const settingsQuery = useAICustomizationSettings();
  const memoryQuery = useMemory();
  const updateMemory = useUpdateMemory();
  const removeMemory = useRemoveMemory();

  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [deletingMemory, setDeletingMemory] = useState<string | null>(null);
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);

  const memoryEnabled = settingsQuery.data?.memoryEnabled !== false;
  const memories = memoryQuery.data?.memories ?? [];
  const pendingNetworkAction = updateMemory.isPending || removeMemory.isPending;

  const handleStartEditing = (memory: string) => {
    setEditingMemory(memory);
    setEditingValue(memory);
  };

  const handleSaveEdit = () => {
    if (!editingMemory) return;

    const nextValue = normalizeMemoryLine(editingValue);
    if (!nextValue) {
      toast.error("Memory cannot be empty");
      return;
    }

    updateMemory.mutate(
      [{ oldMemory: editingMemory, updatedMemory: nextValue }],
      {
        onSuccess: (result) => {
          setEditingMemory(null);
          setEditingValue("");
          toast.success(result.message);
        },
        onError: (error) => {
          toast.error(error.message || "Failed to update memory");
        },
      }
    );
  };

  const handleDeleteMemory = (memory: string) => {
    setDeletingMemory(memory);
    removeMemory.mutate([memory], {
      onSuccess: (result) => {
        if (editingMemory === memory) {
          setEditingMemory(null);
          setEditingValue("");
        }
        toast.success(result.message);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to remove memory");
      },
      onSettled: () => {
        setDeletingMemory(null);
      },
    });
  };

  const handleDeleteAllMemories = () => {
    if (memories.length === 0 || removeMemory.isPending) return;

    setDeletingMemory("__all__");
    removeMemory.mutate(memories, {
      onSuccess: (result) => {
        setEditingMemory(null);
        setEditingValue("");
        setIsDeleteAllDialogOpen(false);
        toast.success(result.message);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to remove all memories");
      },
      onSettled: () => {
        setDeletingMemory(null);
      },
    });
  };

  const handleCopyMigrationPrompt = async () => {
    try {
      await navigator.clipboard.writeText(memoryMigrationPrompt);
      toast.success("Prompt copied");
    } catch {
      toast.error("Failed to copy prompt");
    }
  };

  return (
    <div className="space-y-6">
      {memoryEnabled && (
        <div className="rounded-3xl border border-border/70 bg-linear-to-br from-primary/10 via-background to-emerald-500/10 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Brain className="h-3.5 w-3.5" />
                Persistent memory outside chat
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">Memory Manager</h1>
                <p className="text-sm text-muted-foreground">
                  Review what Lumy carries across conversations and refine it when your preferences change.
                </p>
              </div>
            </div>

            <div className="grid min-w-[220px] grid-cols-2 gap-3">
              <Card className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardDescription>Total memories</CardDescription>
                  <CardTitle className="text-2xl">{memoryQuery.data?.count ?? 0}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardDescription>Status</CardDescription>
                  <CardTitle className="text-base">
                    {pendingNetworkAction ? "Syncing" : "Ready"}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>
          </div>
        </div>
      )}

      {memoryEnabled && (
        <Card className="border-border/70 bg-linear-to-r from-background via-background to-primary/5">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <CardTitle>Switching from another chatbot? <span className="text-primary">Import memory in a moment.</span></CardTitle>
              <CardDescription className="max-w-2xl">
                If your previous chatbot had persistent personalized memory, Lumy can keep that context too so you do not lose the useful things it already learned about you.
              </CardDescription>
            </div>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Instructions</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Bring your remembered context into Lumy</DialogTitle>
                  <DialogDescription>
                    Moving over from another chatbot? Bring the helpful things it already knows about you into Lumy, so your chats can feel personal from the very start.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <p className="font-medium">How it works</p>
                    <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                      <li>Copy the prompt below and send it to your previous chatbot.</li>
                      <li>Copy the chatbot&apos;s response exactly as it gives it back.</li>
                      <li>Paste that response into Lumy in chat and send it.</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <p className="font-medium">Prompt to use in your previous chatbot</p>
                    <div className="relative rounded-2xl border border-border/70 bg-muted/40 p-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-3 right-3 h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={handleCopyMigrationPrompt}
                        aria-label="Copy migration prompt"
                        title="Copy migration prompt"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-6">
{memoryMigrationPrompt}
                      </pre>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-muted-foreground">
                    Lumy will use the pasted response as a clear list of facts and preferences to remember, making the switch much smoother.
                  </div>
                </div>

                <DialogFooter showCloseButton />
              </DialogContent>
            </Dialog>
          </CardHeader>
        </Card>
      )}

      {!memoryEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Memory Is Turned Off</CardTitle>
            <CardDescription>
              Turn memory back on from AI Customization before opening the memory manager.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              When memory is disabled, Lumy will not use or update long-term memory in chat.
            </p>
            <Link href="/settings/ai-customization">
              <Button variant="outline">
                <ChevronLeft className="h-4 w-4" />
                Back to AI Customization
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                Current Memory
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => memoryQuery.refetch()}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", memoryQuery.isFetching && "animate-spin hover:text-muted-foreground")} />
                </Button>
              </CardTitle>
              <CardDescription>
                Review, correct, or remove memory items that Lumy keeps across conversations.
              </CardDescription>
            </div>

            {memories.length > 0 ? (
              <Dialog open={isDeleteAllDialogOpen} onOpenChange={setIsDeleteAllDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={removeMemory.isPending}
                  >
                    {deletingMemory === "__all__" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete all
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete all memories?</DialogTitle>
                    <DialogDescription>
                      This will remove every persistent memory item Lumy has saved for you. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsDeleteAllDialogOpen(false)}
                      disabled={removeMemory.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAllMemories}
                      disabled={removeMemory.isPending}
                    >
                      {deletingMemory === "__all__" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Delete all
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {memoryQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading memory...
            </div>
          ) : memoryQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Failed to load memory. Refresh the page and try again.
            </div>
          ) : memories.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-6 text-center">
              <p className="font-medium">No persistent memories yet</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Lumy will start showing remembered context here as it saves useful long-term details from conversations.
              </p>
            </div>
          ) : (
            memories.map((memory, index) => {
              const isEditing = editingMemory === memory;
              const isDeleting = deletingMemory === memory;
              const isFirst = index === 0;
              const isLast = index === memories.length - 1;
              const itemRadius = memories.length === 1
                ? 'rounded-2xl'
                : isFirst
                  ? 'rounded-t-2xl rounded-b-md'
                  : isLast
                    ? 'rounded-t-md rounded-b-2xl'
                    : 'rounded-md';

              return (
                <div
                  key={memory}
                  className={`${itemRadius} border border-border/70 bg-background/80 px-4 py-3`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex-1 space-y-2.5">
                      {isEditing ? (
                        <Input
                          value={editingValue}
                          onChange={(event) => setEditingValue(event.target.value)}
                          autoFocus
                        />
                      ) : (
                        <p className="text-sm leading-6">{memory}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {isEditing ? (
                        <>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              setEditingMemory(null);
                              setEditingValue("");
                            }}
                            disabled={updateMemory.isPending}
                            aria-label="Cancel editing"
                            title="Cancel editing"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            onClick={handleSaveEdit}
                            disabled={updateMemory.isPending}
                            aria-label="Save memory"
                            title="Save memory"
                          >
                            {updateMemory.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="h-4 w-4" />
                            )}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleStartEditing(memory)}
                          aria-label="Edit memory"
                          title="Edit memory"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}

                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => handleDeleteMemory(memory)}
                        disabled={removeMemory.isPending}
                        aria-label="Delete memory"
                        title="Delete memory"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
