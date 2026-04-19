/**
 * BridgeView — Agent-to-Agent Chat Bridge
 *
 * Shows a live conversation between two agents.
 * Left = agent A, Right = agent B. Messages stream in real-time via WebSocket.
 *
 * Flow:
 *  1. User selects two agents from the sidebar
 *  2. Click "Start Bridge" → POST /api/bridge/start
 *  3. Opens /ws/bridge/:id → receives conversation events
 *  4. Messages render as chat bubbles
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { apiUrl, wsUrl } from "../lib/api";
import type { AgentState } from "../lib/types";

interface BridgeMessage {
  ts: number;
  from: string;
  fromName: string;
  to: string;
  text: string;
}

interface BridgeViewProps {
  agents: AgentState[];
  connected: boolean;
}

export function BridgeView({ agents, connected }: BridgeViewProps) {
  const [agentA, setAgentA] = useState<string | null>(null);
  const [agentB, setAgentB] = useState<string | null>(null);
  const [bridgeId, setBridgeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [manualText, setManualText] = useState("");
  const [manualTarget, setManualTarget] = useState<"A" | "B">("A");
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Start bridge
  const startBridge = useCallback(async () => {
    if (!agentA || !agentB) return;
    setStatus("starting");
    try {
      const res = await fetch(apiUrl("/api/bridge/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentA, agentB }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      setBridgeId(data.id);
      setStatus("running");

      // Open WebSocket
      const ws = new WebSocket(wsUrl(`/ws/bridge/${data.id}`));
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === "history") {
            setMessages(event.messages || []);
          } else if (event.type === "message") {
            setMessages(prev => [...prev, {
              ts: event.ts,
              from: event.from,
              fromName: event.fromName,
              to: event.to,
              text: event.text,
            }]);
          } else if (event.type === "status" && event.state === "stopped") {
            setStatus("idle");
          }
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch (err: any) {
      setStatus("error");
      console.error("Bridge start failed:", err);
    }
  }, [agentA, agentB]);

  // Stop bridge
  const stopBridge = useCallback(async () => {
    if (!bridgeId) return;
    try {
      await fetch(apiUrl("/api/bridge/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: bridgeId }),
      });
    } catch {}
    wsRef.current?.close();
    wsRef.current = null;
    setBridgeId(null);
    setStatus("idle");
  }, [bridgeId]);

  // Send manual message
  const sendManual = useCallback(async () => {
    if (!bridgeId || !manualText.trim()) return;
    try {
      await fetch(apiUrl("/api/bridge/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: bridgeId, to: manualTarget, text: manualText }),
      });
      setManualText("");
    } catch {}
  }, [bridgeId, manualTarget, manualText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Format timestamp
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  };

  // Clean agent name
  const cleanName = (target: string) =>
    target.split(":").pop()?.replace(/-oracle$/, "").replace(/-/g, " ") || target;

  const agentAName = agentA ? cleanName(agentA) : "Agent A";
  const agentBName = agentB ? cleanName(agentB) : "Agent B";

  return (
    <div className="flex h-screen" style={{ background: "#020208" }}>
      {/* Sidebar — Agent selection */}
      <div className="w-[240px] flex-shrink-0 flex flex-col border-r border-white/[0.06]" style={{ background: "#08080e" }}>
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-xs font-mono text-white/50 uppercase tracking-wider">Chat Bridge</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          <div className="text-[10px] text-white/30 uppercase tracking-wider px-1 mb-2">Select 2 agents</div>
          {agents.map(agent => {
            const isA = agent.target === agentA;
            const isB = agent.target === agentB;
            const selected = isA || isB;
            return (
              <button
                key={agent.target}
                onClick={() => {
                  if (status !== "idle") return;
                  if (isA) { setAgentA(null); return; }
                  if (isB) { setAgentB(null); return; }
                  if (!agentA) setAgentA(agent.target);
                  else if (!agentB) setAgentB(agent.target);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg mb-1 cursor-pointer transition-all text-xs font-mono ${
                  isA ? "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30" :
                  isB ? "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30" :
                  selected ? "opacity-30 cursor-not-allowed" :
                  "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
                }`}
                disabled={selected && !isA && !isB}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    isA ? "bg-cyan-400" : isB ? "bg-orange-400" :
                    agent.status === "busy" ? "bg-yellow-400" :
                    agent.status === "ready" ? "bg-green-400" : "bg-gray-600"
                  }`} />
                  <span>{isA ? "A: " : isB ? "B: " : ""}{cleanName(agent.target)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <div className="p-3 border-t border-white/[0.06]">
          {status === "idle" ? (
            <button
              onClick={startBridge}
              disabled={!agentA || !agentB}
              className="w-full py-2 rounded-lg text-xs font-mono cursor-pointer transition-all
                disabled:opacity-30 disabled:cursor-not-allowed
                bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30"
            >
              🔗 Start Bridge
            </button>
          ) : (
            <button
              onClick={stopBridge}
              className="w-full py-2 rounded-lg text-xs font-mono cursor-pointer transition-all
                bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30"
            >
              ⏹ Stop Bridge
            </button>
          )}
          <div className="text-center mt-2 text-[10px] text-white/20 font-mono">
            {status === "starting" && "Connecting..."}
            {status === "running" && `🟢 Live — ${messages.length} messages`}
            {status === "error" && "❌ Error starting bridge"}
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]" style={{ background: "#0a0a12" }}>
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-500/10 text-cyan-400">
              {agentAName}
            </span>
            <span className="text-white/20 text-sm">⟷</span>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-orange-500/10 text-orange-400">
              {agentBName}
            </span>
          </div>
          <span className="text-[10px] font-mono" style={{ color: connected ? "#4caf50" : "#ef5350" }}>
            {connected ? "connected" : "reconnecting"}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 && status === "idle" && (
            <div className="flex items-center justify-center h-full text-white/15 text-sm font-mono">
              Select two agents and click "Start Bridge"
            </div>
          )}
          {messages.length === 0 && status === "running" && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-2xl mb-3 animate-pulse">🔗</div>
                <p className="text-white/30 text-sm font-mono">Bridge active — waiting for agents to talk...</p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const isA = msg.from === agentA;
            return (
              <div key={i} className={`flex mb-3 ${isA ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[70%] ${isA ? "" : ""}`}>
                  <div className={`flex items-center gap-2 mb-1 ${isA ? "" : "flex-row-reverse"}`}>
                    <span className={`text-[10px] font-mono ${isA ? "text-cyan-400/70" : "text-orange-400/70"}`}>
                      {msg.fromName}
                    </span>
                    <span className="text-[9px] text-white/20 font-mono">{formatTime(msg.ts)}</span>
                  </div>
                  <div
                    className={`px-3 py-2 rounded-xl text-[13px] font-mono leading-relaxed whitespace-pre-wrap ${
                      isA
                        ? "bg-cyan-500/10 text-cyan-100/80 rounded-tl-sm border border-cyan-500/10"
                        : "bg-orange-500/10 text-orange-100/80 rounded-tr-sm border border-orange-500/10"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Manual send */}
        {status === "running" && (
          <div className="flex items-center gap-2 px-4 py-2 border-t border-white/[0.06]" style={{ background: "#0d0d14" }}>
            <select
              value={manualTarget}
              onChange={e => setManualTarget(e.target.value as "A" | "B")}
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white/50 cursor-pointer"
            >
              <option value="A">→ {agentAName}</option>
              <option value="B">→ {agentBName}</option>
            </select>
            <input
              value={manualText}
              onChange={e => setManualText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") sendManual(); }}
              placeholder="Type a message to inject..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-white/80 placeholder-white/20 outline-none focus:border-cyan-500/30"
            />
            <button
              onClick={sendManual}
              className="px-3 py-1.5 rounded-lg text-xs font-mono bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 cursor-pointer transition-all"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
