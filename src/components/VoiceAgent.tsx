import { useState, useCallback, useEffect, useRef } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, X, Paperclip, FileText } from "lucide-react";
import { toast } from "sonner";
import { ingestForVoiceAgent } from "@/lib/voice-ingest.functions";

const STORAGE_KEY = "wellator_elevenlabs_agent_id";
const DEFAULT_AGENT_ID = "agent_0701kw2dyj7fe5kanmp80fq5ncwb";

export function VoiceAgent({ screenContext }: { screenContext?: string }) {
  return (
    <ConversationProvider>
      <VoiceAgentInner screenContext={screenContext} />
    </ConversationProvider>
  );
}

function VoiceAgentInner({ screenContext }: { screenContext?: string }) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string>(
    () => (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) || DEFAULT_AGENT_ID,
  );
  const [transcript, setTranscript] = useState<
    Array<{ role: "user" | "agent"; text: string }>
  >([]);
  const [uploads, setUploads] = useState<Array<{ filename: string; chars: number }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ingest = useServerFn(ingestForVoiceAgent);

  const conversation = useConversation({
    onConnect: () => toast.success("Connected to billing voice assistant"),
    onDisconnect: () => toast.message("Voice session ended"),
    onError: (e) => toast.error(typeof e === "string" ? e : "Voice agent error"),
    onMessage: (msg: any) => {
      if (msg?.source === "user" && msg?.message) {
        setTranscript((t) => [...t, { role: "user", text: msg.message }]);
      } else if (msg?.source === "ai" && msg?.message) {
        setTranscript((t) => [...t, { role: "agent", text: msg.message }]);
      }
    },
  });

  const status = conversation.status;
  const connected = status === "connected";

  const lastSentRef = useRef<string>("");

  const sendScreen = useCallback((reason: "initial" | "update") => {
    if (!screenContext) return;
    if (screenContext === lastSentRef.current && reason === "update") return;
    try {
      const prefix = reason === "initial"
        ? "Here is what the user is currently seeing on the dashboard. Use it to answer their questions. If they ask about a patient or count, prefer this over your tools:\n\n"
        : "The dashboard view changed. Updated snapshot:\n\n";
      conversation.sendContextualUpdate(prefix + screenContext);
      lastSentRef.current = screenContext;
    } catch { /* not connected yet */ }
  }, [conversation, screenContext]);

  const start = useCallback(async () => {
    if (!agentId) {
      toast.error("Enter your ElevenLabs Agent ID first");
      return;
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      localStorage.setItem(STORAGE_KEY, agentId);
      await conversation.startSession({ agentId, connectionType: "webrtc" });
      setTimeout(() => sendScreen("initial"), 500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start session");
    }
  }, [agentId, conversation, sendScreen]);

  const stop = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  useEffect(() => {
    return () => {
      if (conversation.status === "connected") {
        try { conversation.endSession(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connected || !screenContext) return;
    const t = setTimeout(() => sendScreen("update"), 800);
    return () => clearTimeout(t);
  }, [connected, screenContext, sendScreen]);

  const fileToBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = r.result as string;
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 20 MB`);
          continue;
        }
        const base64 = await fileToBase64(file);
        toast.message(`Ingesting ${file.name}…`);
        const res = await ingest({
          data: { filename: file.name, mimeType: file.type || "application/octet-stream", base64 },
        });
        const payload =
          `The user uploaded a file named "${res.filename}" (${res.mimeType}). ` +
          `Use the following extracted content as additional context for the conversation:\n\n` +
          res.summary;
        if (connected) {
          try {
            conversation.sendContextualUpdate(payload);
          } catch (e) {
            console.error(e);
          }
        }
        setUploads((u) => [...u, { filename: res.filename, chars: res.summary.length }]);
        toast.success(
          connected
            ? `${file.name} shared with agent`
            : `${file.name} ingested — will be shared when you start the call`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [conversation, connected, ingest]);

  // Replay uploaded docs once a session starts
  useEffect(() => {
    if (!connected || uploads.length === 0) return;
    // no-op: contextual updates were sent at upload time if connected.
    // If user uploaded before connecting, push a consolidated note now.
    try {
      const note =
        `Previously uploaded files this session: ${uploads.map((u) => u.filename).join(", ")}. ` +
        `Their content has been (or will be) shared via contextual updates.`;
      conversation.sendContextualUpdate(note);
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg"
        size="icon"
        aria-label="Open voice assistant"
      >
        <Mic className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-6 right-6 z-50 w-96 shadow-xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Billing Voice Assistant</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={connected ? "default" : "secondary"}>
            {connected ? (conversation.isSpeaking ? "Speaking" : "Listening") : status}
          </Badge>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              if (connected) stop();
              setOpen(false);
            }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!connected && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              ElevenLabs Agent ID
            </label>
            <Input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="agent_xxxxxxxxxxxxxxxxxxxx"
            />
          </div>
        )}

        <div className="flex gap-2">
          {!connected ? (
            <Button onClick={start} className="flex-1">
              <Mic className="mr-2 h-4 w-4" /> Start talking
            </Button>
          ) : (
            <Button onClick={stop} variant="destructive" className="flex-1">
              <MicOff className="mr-2 h-4 w-4" /> End call
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload screenshot or document"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {uploads.length > 0 && (
          <div className="rounded border p-2 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              Shared with agent
            </div>
            {uploads.map((u, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <FileText className="h-3 w-3" />
                <span className="truncate flex-1">{u.filename}</span>
                <span className="text-muted-foreground">{u.chars} chars</span>
              </div>
            ))}
          </div>
        )}

        {transcript.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-2 rounded border p-2 text-sm">
            {transcript.slice(-20).map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "text-foreground"
                    : "text-muted-foreground italic"
                }
              >
                <span className="font-semibold mr-1">
                  {m.role === "user" ? "You:" : "Agent:"}
                </span>
                {m.text}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Tap the paperclip to upload a screenshot or PDF. The agent will read
          its contents and answer questions about it.
        </p>
      </CardContent>
    </Card>
  );
}
