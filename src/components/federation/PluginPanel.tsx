import { useState } from "react";
import { useFederationStore } from "./store";

const clean = (s: string) => s.replace(/-view$/, "").replace(/-oracle$/, "");

export function PluginPanel() {
  const { liveMessages, messageLog } = useFederationStore();
  const [collapsed, setCollapsed] = useState(false);

  // Merge live + history, deduplicate, sort newest first
  const allMessages = [...liveMessages.map(m => ({
    from: clean(m.from),
    to: clean(m.to),
    msg: "",
    ts: m.ts,
    live: true,
  })), ...messageLog.filter(m => {
    // Skip history entries that overlap with live
    return !liveMessages.some(l =>
      clean(l.from) === m.from && clean(l.to) === m.to && Math.abs(l.ts - m.ts) < 5000);
  })].sort((a, b) => b.ts - a.ts);

  if (collapsed) {
    return (
      <button onClick={() => setCollapsed(false)}
        className="absolute bottom-4 left-4 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border cursor-pointer hover:bg-white/[0.05]"
        style={{ background: "rgba(3,10,24,0.9)", borderColor: "rgba(255,255,255,0.08)" }}>
        {liveMessages.length > 0
          ? <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          : <span className="w-1.5 h-1.5 rounded-full bg-white/10" />}
        <span className="text-[9px] font-mono text-white/40">Messages {allMessages.length}</span>
      </button>
    );
  }

  return (
    <div className="absolute top-[60px] left-4 h-[200px] w-[240px] rounded-lg border overflow-hidden flex flex-col"
      style={{
        background: "rgba(3,10,24,0.95)",
        borderColor: "rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
      }}>

      <div className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.03]"
        onClick={() => setCollapsed(true)}>
        {liveMessages.length > 0
          ? <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          : <span className="w-1.5 h-1.5 rounded-full bg-white/10" />}
        <span className="text-[9px] font-mono text-cyan-400/60">Messages</span>
        <span className="text-[8px] font-mono text-white/20 ml-auto">{allMessages.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {allMessages.length > 0 ? (
          allMessages.map((m, i) => {
            const age = Math.floor((Date.now() - m.ts) / 1000);
            const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
            return (
              <div key={i} className={`flex items-center gap-1.5 px-3 py-0.5 text-[9px] font-mono ${m.live ? "" : "opacity-50"}`}
                title={m.msg || undefined}>
                <span className="text-cyan-400/60">{m.from}</span>
                <span className="text-white/20">{"\u2192"}</span>
                <span className="text-cyan-400/60">{m.to}</span>
                <span className="text-white/15 ml-auto">{ageStr}</span>
              </div>
            );
          })
        ) : (
          <div className="px-3 py-2 text-[9px] font-mono text-white/15">waiting for maw hey...</div>
        )}
      </div>
    </div>
  );
}
