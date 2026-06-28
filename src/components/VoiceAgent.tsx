import { useState, useCallback, useEffect } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, X } from "lucide-react";
import { toast } from "sonner";

const STORAGE_KEY = "wellator_elevenlabs_agent_id";
const DEFAULT_AGENT_ID = "agent_0701kw2dyj7fe5kanmp80fq5ncwb";

export function VoiceAgent() {
  return (
    <ConversationProvider>
      <VoiceAgentInner />
    </ConversationProvider>
  );
}

function VoiceAgentInner() {

  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string>(
    () => (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) || "",
  );
  const [transcript, setTranscript] = useState<
    Array<{ role: "user" | "agent"; text: string }>
  >([]);

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

  const start = useCallback(async () => {
    if (!agentId) {
      toast.error("Enter your ElevenLabs Agent ID first");
      return;
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      localStorage.setItem(STORAGE_KEY, agentId);
      await conversation.startSession({
        agentId,
        connectionType: "webrtc",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start session");
    }
  }, [agentId, conversation]);

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
              ElevenLabs Agent ID (public agent with the voice-agent webhook tool configured)
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
        </div>

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
          Try: "Summarize facility 101", "List flagged patients", or "Explain the
          decision for patient FA-001".
        </p>
      </CardContent>
    </Card>
  );
}
