import { createRoot } from "react-dom/client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "../index.css";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiUrl } from "../lib/api";
import type { FeedEvent, FeedEventType } from "../lib/feed";

// ─── Types ───

interface AgentNode {
  id: string;
  node: string; // machine
  x: number;
  y: number;
  vx: number;
  vy: number;
  syncPeers: string[];
  buddedFrom?: string;
  children: string[];
}

interface AgentEdge {
  source: string;
  target: string;
  type: "sync" | "lineage" | "message";
  count: number;
}

// ─── Colors ───

const MACHINE_COLORS: Record<string, string> = {
  white: "#00f5d4",          // bioluminescent cyan-green
  "oracle-world": "#00bbf9", // deep water blue
  mba: "#9b5de5",            // jellyfish purple
  "clinic-nat": "#f15bb5",   // anemone pink
};
const PALETTE = ["#00f5d4", "#00bbf9", "#9b5de5", "#fee440", "#72efdd"];
let cIdx = 0;
function machineColor(name: string): string {
  if (!MACHINE_COLORS[name]) MACHINE_COLORS[name] = PALETTE[cIdx++ % PALETTE.length];
  return MACHINE_COLORS[name];
}

function statusGlow(s: string): string {
  return s === "busy" ? "#00f5d4" : s === "ready" ? "#00bbf9" : "#0a2a4a";
}

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// ─── Force simulation (simple, no d3) ───

function simulate(agents: AgentNode[], edges: AgentEdge[], W: number, H: number) {
  const cx = W * 0.48, cy = H * 0.5;

  // Machine cluster centers (arranged in a ring)
  const machines = [...new Set(agents.map(a => a.node))];
  const clusterR = Math.min(W, H) * 0.28;
  const clusterCenters: Record<string, { x: number; y: number }> = {};
  machines.forEach((m, i) => {
    const angle = (i / machines.length) * Math.PI * 2 - Math.PI / 2;
    clusterCenters[m] = { x: cx + Math.cos(angle) * clusterR, y: cy + Math.sin(angle) * clusterR };
  });

  // Initialize positions near cluster center
  for (const a of agents) {
    const cc = clusterCenters[a.node] || { x: cx, y: cy };
    a.x = cc.x + (Math.random() - 0.5) * 80;
    a.y = cc.y + (Math.random() - 0.5) * 80;
    a.vx = 0;
    a.vy = 0;
  }

  const byId = new Map(agents.map(a => [a.id, a]));

  // Run simulation steps
  for (let iter = 0; iter < 200; iter++) {
    const alpha = 0.3 * (1 - iter / 200);

    // Repulsion between all agents
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i], b = agents[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = a.node === b.node ? 45 : 80;
        if (dist < minDist) {
          const force = (minDist - dist) / dist * alpha * 0.5;
          dx *= force; dy *= force;
          a.vx -= dx; a.vy -= dy;
          b.vx += dx; b.vy += dy;
        }
      }
    }

    // Attraction to cluster center
    for (const a of agents) {
      const cc = clusterCenters[a.node];
      if (!cc) continue;
      const dx = cc.x - a.x, dy = cc.y - a.y;
      a.vx += dx * alpha * 0.03;
      a.vy += dy * alpha * 0.03;
    }

    // Edge attraction (sync peers pull toward each other gently)
    for (const edge of edges) {
      if (edge.type !== "sync") continue;
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist > 120) {
        const force = (dist - 120) / dist * alpha * 0.02;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }

    // Apply velocity with damping
    for (const a of agents) {
      a.x += a.vx;
      a.y += a.vy;
      a.vx *= 0.7;
      a.vy *= 0.7;
      // Bounds
      a.x = Math.max(40, Math.min(W - 40, a.x));
      a.y = Math.max(40, Math.min(H - 40, a.y));
    }
  }
}

// ─── App ───

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [edges, setEdges] = useState<AgentEdge[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const [machines, setMachines] = useState<string[]>([]);

  // Particle state for animated edges
  const particlesRef = useRef<Map<string, { phase: number; speed: number }[]>>(new Map());

  // Refs for animation
  const agentsRef = useRef(agents); agentsRef.current = agents;
  const edgesRef = useRef(edges); edgesRef.current = edges;
  const statusesRef = useRef(agentStatuses); statusesRef.current = agentStatuses;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const hoveredRef = useRef(hovered); hoveredRef.current = hovered;
  const flashRef = useRef(flashes); flashRef.current = flashes;

  // WS
  const BUSY = useMemo(() => new Set<FeedEventType>(["PreToolUse", "PostToolUse", "UserPromptSubmit", "SubagentStart", "PostToolUseFailure"]), []);
  const STOP = useMemo(() => new Set<FeedEventType>(["Stop", "SessionEnd", "Notification"]), []);

  const handleMessage = useCallback((data: any) => {
    if (data.type === "feed") {
      const e = data.event as FeedEvent;
      if (BUSY.has(e.event)) {
        setAgentStatuses(p => ({ ...p, [e.oracle]: "busy" }));
        setFlashes(p => ({ ...p, [e.oracle]: Date.now() }));
      } else if (STOP.has(e.event)) {
        setAgentStatuses(p => ({ ...p, [e.oracle]: "ready" }));
      }
    } else if (data.type === "feed-history") {
      const st: Record<string, string> = {};
      for (const e of (data.events as FeedEvent[])) {
        if (BUSY.has(e.event)) st[e.oracle] = "busy";
        else if (STOP.has(e.event)) st[e.oracle] = "ready";
      }
      setAgentStatuses(st);
    }
  }, [BUSY, STOP]);

  const { connected } = useWebSocket(handleMessage);

  // Fetch data + build graph
  useEffect(() => {
    async function load() {
      const [identity, config, fleet, messages] = await Promise.all([
        fetch(apiUrl("/api/identity")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/api/config")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/api/fleet")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/api/messages?limit=500")).then(r => r.json()).catch(() => null),
      ]);

      if (identity?.version) setVersion(identity.version);

      // Agent → machine map
      const a2m: Record<string, string> = {};
      if (config?.agents) for (const [a, m] of Object.entries(config.agents)) a2m[a] = m as string;

      // Fleet data → sync_peers, lineage
      const fleetMap: Record<string, { syncPeers: string[]; buddedFrom?: string; children: string[] }> = {};
      if (fleet?.fleet) {
        for (const f of fleet.fleet) {
          const name = f.windows?.[0]?.name?.replace(/-oracle$/, "") || f.name.replace(/^\d+-/, "");
          fleetMap[name] = {
            syncPeers: (f.sync_peers || []).filter((p: string) => p !== "--help"),
            buddedFrom: f.budded_from || undefined,
            children: f.children || [],
          };
        }
      }

      // Build agent nodes — use window size minus sidebar
      const W = (window.innerWidth - 240) || 900;
      const H = (window.innerHeight - 52) || 600;

      const agentList: AgentNode[] = [];
      const seen = new Set<string>();

      // Add all agents from config
      for (const [name, machine] of Object.entries(a2m)) {
        if (seen.has(name)) continue;
        seen.add(name);
        const fm = fleetMap[name];
        agentList.push({
          id: name,
          node: machine,
          x: 0, y: 0, vx: 0, vy: 0,
          syncPeers: fm?.syncPeers || [],
          buddedFrom: fm?.buddedFrom,
          children: fm?.children || [],
        });
      }

      // Build edges
      const edgeSet = new Set<string>();
      const edgeList: AgentEdge[] = [];

      function addEdge(src: string, tgt: string, type: AgentEdge["type"], count = 1) {
        const key = `${type}:${[src, tgt].sort().join("-")}`;
        if (edgeSet.has(key)) return;
        edgeSet.add(key);
        edgeList.push({ source: src, target: tgt, type, count });
      }

      // Sync peer edges
      for (const agent of agentList) {
        for (const peer of agent.syncPeers) {
          if (seen.has(peer)) addEdge(agent.id, peer, "sync");
        }
      }

      // Lineage edges
      for (const agent of agentList) {
        if (agent.buddedFrom && seen.has(agent.buddedFrom)) {
          addEdge(agent.buddedFrom, agent.id, "lineage");
        }
        for (const child of agent.children) {
          if (seen.has(child)) addEdge(agent.id, child, "lineage");
        }
      }

      // Message edges
      if (messages?.messages) {
        const msgCounts: Record<string, number> = {};
        for (const m of messages.messages) {
          const from = m.from?.replace(/^.*:/, "").replace(/-oracle$/, "") || "";
          const to = m.to?.replace(/^.*:/, "").replace(/-oracle$/, "") || "";
          if (from && to && seen.has(from) && seen.has(to) && from !== to) {
            const key = [from, to].sort().join("-");
            msgCounts[key] = (msgCounts[key] || 0) + 1;
          }
        }
        for (const [key, count] of Object.entries(msgCounts)) {
          const [a, b] = key.split("-");
          addEdge(a, b, "message", count);
        }
      }

      // Initialize particles for message edges
      const newParticles = new Map<string, { phase: number; speed: number }[]>();
      for (const edge of edgeList) {
        if (edge.type === "message" || edge.type === "sync") {
          const key = `${edge.source}-${edge.target}`;
          const n = edge.type === "message" ? Math.min(6, edge.count + 1) : 1;
          newParticles.set(key, Array.from({ length: n }, () => ({
            phase: Math.random(),
            speed: 0.0002 + Math.random() * 0.0003,
          })));
        }
      }
      particlesRef.current = newParticles;

      // Run force simulation
      simulate(agentList, edgeList, W, H);

      setAgents(agentList);
      setEdges(edgeList);
      setMachines([...new Set(agentList.map(a => a.node))]);
    }

    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  // ─── Canvas draw loop ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let animId: number;
    let time = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    function draw() {
      time += 16;
      const W = canvas!.getBoundingClientRect().width;
      const H = canvas!.getBoundingClientRect().height;
      const agents = agentsRef.current;
      const edges = edgesRef.current;
      const statuses = statusesRef.current;
      const sel = selectedRef.current;
      const hov = hoveredRef.current;
      const fl = flashRef.current;
      const particles = particlesRef.current;

      // Clear + background (drawn in screen space before transform)
      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
      bg.addColorStop(0, "#061525");
      bg.addColorStop(1, "#020a18");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Apply camera transform
      const cam = camRef.current;
      ctx.save();
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      // Subtle grid
      const gridStep = 40;
      const gx0 = Math.floor(-cam.x / cam.zoom / gridStep) * gridStep;
      const gy0 = Math.floor(-cam.y / cam.zoom / gridStep) * gridStep;
      const gx1 = gx0 + W / cam.zoom + gridStep;
      const gy1 = gy0 + H / cam.zoom + gridStep;
      for (let x = gx0; x < gx1; x += gridStep) {
        for (let y = gy0; y < gy1; y += gridStep) {
          const p = Math.sin(time * 0.0008 + x * 0.01 + y * 0.01) * 0.3 + 0.7;
          ctx.fillStyle = `rgba(255,255,255,${0.02 * p})`;
          ctx.beginPath();
          ctx.arc(x, y, 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Machine cluster labels (background, large, faint)
      const clusterPositions: Record<string, { x: number; y: number; count: number }> = {};
      for (const a of agents) {
        const cp = clusterPositions[a.node] || { x: 0, y: 0, count: 0 };
        cp.x += a.x; cp.y += a.y; cp.count++;
        clusterPositions[a.node] = cp;
      }
      for (const [name, cp] of Object.entries(clusterPositions)) {
        const mx = cp.x / cp.count, my = cp.y / cp.count;
        const color = machineColor(name);
        const [r, g, b] = hexRgb(color);
        // Soft glow behind cluster
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, 90);
        grad.addColorStop(0, `rgba(${r},${g},${b},0.08)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mx, my, 90, 0, Math.PI * 2);
        ctx.fill();
        // Label
        ctx.font = "bold 11px monospace";
        ctx.fillStyle = `rgba(${r},${g},${b},0.45)`;
        ctx.textAlign = "center";
        ctx.fillText(name, mx, my + 70);
      }

      const byId = new Map(agents.map(a => [a.id, a]));

      // ─── Draw edges ───
      for (const edge of edges) {
        const a = byId.get(edge.source), b = byId.get(edge.target);
        if (!a || !b) continue;

        const isHighlighted = sel === a.id || sel === b.id || hov === a.id || hov === b.id;
        const dimmed = sel && !isHighlighted;

        if (edge.type === "lineage") {
          // Dashed warm animated line
          ctx.save();
          ctx.strokeStyle = `rgba(0,245,212,${dimmed ? 0.06 : 0.35})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.lineDashOffset = -time * 0.015;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        } else if (edge.type === "sync") {
          // Thin connection
          const mc = machineColor(a.node);
          const [r, g, bb] = hexRgb(mc);
          ctx.strokeStyle = `rgba(${r},${g},${bb},${dimmed ? 0.05 : isHighlighted ? 0.5 : 0.15})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.stroke();
        } else if (edge.type === "message") {
          // Bright flow line
          const opacity = dimmed ? 0.06 : isHighlighted ? 0.7 : 0.35;
          const width = Math.max(1, Math.min(3, edge.count * 0.5));
          ctx.save();
          ctx.shadowColor = "#00f5d4";
          ctx.shadowBlur = isHighlighted ? 8 : 3;
          ctx.strokeStyle = `rgba(0,245,212,${opacity})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        }

        // Particles on message/sync edges
        if (edge.type === "message" || (edge.type === "sync" && isHighlighted)) {
          const key = `${edge.source}-${edge.target}`;
          const pts = particles.get(key);
          if (pts) {
            for (const p of pts) {
              p.phase = (p.phase + p.speed * 16) % 1;
              const px = a.x + (b.x - a.x) * p.phase;
              const py = a.y + (b.y - a.y) * p.phase;
              const color = edge.type === "message" ? "#00f5d4" : machineColor(a.node);
              const [r, g, bb] = hexRgb(color);
              const pOpacity = dimmed ? 0.05 : (0.4 + Math.sin(p.phase * Math.PI) * 0.4);

              ctx.save();
              ctx.shadowColor = color;
              ctx.shadowBlur = 5;
              ctx.fillStyle = `rgba(${r},${g},${bb},${pOpacity})`;
              ctx.beginPath();
              ctx.arc(px, py, 1.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        }
      }

      // ─── Draw agents ───
      for (const agent of agents) {
        const color = machineColor(agent.node);
        const [r, g, b] = hexRgb(color);
        const status = statuses[agent.id] || "idle";
        const sc = statusGlow(status);
        const [sr, sg, sb] = hexRgb(sc);
        const isSel = sel === agent.id;
        const isHov = hov === agent.id;
        const isConnected = sel && edges.some(e => (e.source === sel && e.target === agent.id) || (e.target === sel && e.source === agent.id));
        const dimmed = sel && !isSel && !isConnected;

        const flashAge = fl[agent.id] ? Date.now() - fl[agent.id] : Infinity;
        const isFlashing = flashAge < 2000;
        const flashI = isFlashing ? Math.max(0, 1 - flashAge / 2000) : 0;

        // Pulse for busy
        const baseR = isSel ? 12 : isHov ? 11 : 9;
        const pulse = status === "busy" ? Math.sin(time * 0.005) * 2 : 0;
        const dotR = baseR + pulse + flashI * 4;

        // Outer glow
        ctx.save();
        if (status === "busy" || isFlashing) {
          ctx.shadowColor = sc;
          ctx.shadowBlur = 15 + flashI * 20;
        } else if (isSel || isHov) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
        }

        // Fill — gradient
        const grad = ctx.createRadialGradient(agent.x, agent.y, 0, agent.x, agent.y, dotR);
        if (status === "busy") {
          grad.addColorStop(0, `rgba(${sr},${sg},${sb},${dimmed ? 0.2 : 0.9})`);
          grad.addColorStop(1, `rgba(${sr},${sg},${sb},${dimmed ? 0.06 : 0.3})`);
        } else {
          grad.addColorStop(0, `rgba(${r},${g},${b},${dimmed ? 0.12 : 0.8})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},${dimmed ? 0.03 : 0.2})`);
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, dotR, 0, Math.PI * 2);
        ctx.fill();

        // Border
        ctx.strokeStyle = status === "busy"
          ? `rgba(${sr},${sg},${sb},${dimmed ? 0.2 : 0.9})`
          : `rgba(${r},${g},${b},${dimmed ? 0.1 : isSel ? 1.0 : 0.6})`;
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.stroke();
        ctx.restore();

        // Status ring for busy
        if (status === "busy" && !dimmed) {
          const ringR = dotR + 4 + Math.sin(time * 0.003) * 1.5;
          ctx.strokeStyle = `rgba(${sr},${sg},${sb},0.15)`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.arc(agent.x, agent.y, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Label
        ctx.font = `${isSel ? "bold " : ""}8px monospace`;
        ctx.fillStyle = `rgba(255,255,255,${dimmed ? 0.1 : isSel ? 0.9 : isHov ? 0.7 : 0.5})`;
        ctx.textAlign = "center";
        ctx.fillText(agent.id, agent.x, agent.y + dotR + 12);
      }

      // Restore screen space for legend
      ctx.restore();

      // ─── Legend ───
      const ly = H - 25;
      ctx.font = "8px monospace";
      ctx.textAlign = "left";

      let lx = 20;
      for (const m of [...new Set(agents.map(a => a.node))]) {
        const c = machineColor(m);
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillText(m, lx + 8, ly + 3);
        lx += ctx.measureText(m).width + 22;
      }

      // Edge types
      lx += 10;
      ctx.strokeStyle = "rgba(0,245,212,0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 15, ly); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("message", lx + 20, ly + 3);
      lx += 70;

      ctx.save();
      ctx.strokeStyle = "rgba(0,245,212,0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 15, ly); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("lineage", lx + 20, ly + 3);

      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  // ─── Camera (pan + zoom) ───
  const camRef = useRef({ x: 0, y: 0, zoom: 1 });

  // ─── Mouse interaction (click + drag agents, pan empty space, scroll zoom) ───
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

  /** Convert screen coords to world coords */
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const cam = camRef.current;
    return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
  }, []);

  const hitTest = useCallback((sx: number, sy: number): string | null => {
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    for (const a of agentsRef.current) {
      const dx = wx - a.x, dy = wy - a.y;
      if (dx * dx + dy * dy < (15 / camRef.current.zoom) ** 2) return a.id;
    }
    return null;
  }, [screenToWorld]);

  const handleDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const hit = hitTest(sx, sy);
    if (hit) {
      dragRef.current = { id: hit, startX: sx, startY: sy, moved: false };
    } else {
      const cam = camRef.current;
      panRef.current = { startX: sx, startY: sy, camX: cam.x, camY: cam.y };
    }
  }, [hitTest]);

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    // Dragging an agent
    if (dragRef.current) {
      const d = dragRef.current;
      if (Math.abs(sx - d.startX) > 3 || Math.abs(sy - d.startY) > 3) d.moved = true;
      if (d.moved) {
        const { x: wx, y: wy } = screenToWorld(sx, sy);
        const agent = agentsRef.current.find(a => a.id === d.id);
        if (agent) { agent.x = wx; agent.y = wy; }
        canvasRef.current!.style.cursor = "grabbing";
        return;
      }
    }

    // Panning empty space
    if (panRef.current) {
      const p = panRef.current;
      camRef.current.x = p.camX + (sx - p.startX);
      camRef.current.y = p.camY + (sy - p.startY);
      canvasRef.current!.style.cursor = "grabbing";
      return;
    }

    const hit = hitTest(sx, sy);
    setHovered(hit);
    canvasRef.current!.style.cursor = hit ? "grab" : "default";
  }, [hitTest, screenToWorld]);

  const handleUp = useCallback(() => {
    const d = dragRef.current;
    if (d && !d.moved) setSelected(prev => prev === d.id ? null : d.id);
    dragRef.current = null;
    if (panRef.current) panRef.current = null;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const cam = camRef.current;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.3, Math.min(5, cam.zoom * factor));
    // Zoom toward cursor
    cam.x = sx - (sx - cam.x) * (newZoom / cam.zoom);
    cam.y = sy - (sy - cam.y) * (newZoom / cam.zoom);
    cam.zoom = newZoom;
  }, []);

  // Selected agent info
  const selAgent = agents.find(a => a.id === selected);
  const selEdges = edges.filter(e => e.source === selected || e.target === selected);
  const totalAgents = agents.length;

  const lineageEdges = edges.filter(e => e.type === "lineage");

  return (
    <div className="h-screen flex flex-col" style={{ background: "#020a18" }}>
      <header className="flex items-center gap-4 px-6 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">🕸</span>
          <h1 className="text-lg font-black tracking-tight" style={{ color: "#00f5d4" }}>Federation Mesh</h1>
        </div>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${connected ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
          {connected ? "LIVE" : "OFFLINE"}
        </span>
        <div className="flex items-center gap-3 text-[10px] font-mono text-white/20">
          <span>{machines.length} machines</span>
          <span>·</span>
          <span>{totalAgents} agents</span>
          <span>·</span>
          <span>{edges.filter(e => e.type === "message").reduce((s, e) => s + e.count, 0)} msg</span>
          <span>·</span>
          <span>{edges.filter(e => e.type === "sync").length} sync</span>
          <span>·</span>
          <span className="text-cyan-400/40">{lineageEdges.length} lineage</span>
          {version && <><span>·</span><span>v{version}</span></>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {machines.map(m => (
            <span key={m} className="flex items-center gap-1 text-[9px] font-mono" style={{ color: machineColor(m) }}>
              <span className="w-2 h-2 rounded-full" style={{ background: machineColor(m) }} />{m}
            </span>
          ))}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <canvas ref={canvasRef} className="flex-1 min-w-0" onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp} onWheel={handleWheel} />

        {/* Sidebar */}
        <div className="w-[240px] flex-shrink-0 border-l overflow-y-auto p-4 space-y-4" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(3,10,24,0.98)" }}>
          {selAgent ? (
            <>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-3 h-3 rounded-full" style={{ background: machineColor(selAgent.node), boxShadow: `0 0 8px ${machineColor(selAgent.node)}50` }} />
                  <span className="text-sm font-bold text-white/80">{selAgent.id}</span>
                </div>
                <div className="text-[10px] font-mono text-white/40 space-y-0.5 ml-5">
                  <div>Machine: <span style={{ color: machineColor(selAgent.node) }}>{selAgent.node}</span></div>
                  <div>Status: <span style={{ color: statusGlow(agentStatuses[selAgent.id] || "idle") }}>{agentStatuses[selAgent.id] || "idle"}</span></div>
                  {selAgent.buddedFrom && <div>Budded from: <span className="text-cyan-400/60">{selAgent.buddedFrom}</span></div>}
                  {selAgent.children.length > 0 && <div>Children: <span className="text-cyan-400/60">{selAgent.children.join(", ")}</span></div>}
                </div>
              </div>

              {selAgent.syncPeers.length > 0 && (
                <div>
                  <div className="text-[9px] font-mono tracking-wider uppercase mb-1.5 text-white/40">Sync Peers</div>
                  {selAgent.syncPeers.map(p => (
                    <div key={p} className="flex items-center gap-2 px-2 py-1 text-[10px] font-mono cursor-pointer hover:bg-white/[0.03] rounded"
                      onClick={() => setSelected(p)}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: machineColor(agents.find(a => a.id === p)?.node || "") }} />
                      <span className="text-white/40">{p}</span>
                      <span className="text-[8px] ml-auto" style={{ color: statusGlow(agentStatuses[p] || "idle") }}>{agentStatuses[p] || "idle"}</span>
                    </div>
                  ))}
                </div>
              )}

              {selEdges.filter(e => e.type === "message").length > 0 && (
                <div>
                  <div className="text-[9px] font-mono tracking-wider uppercase mb-1.5" style={{ color: "rgba(0,245,212,0.5)" }}>Messages</div>
                  {selEdges.filter(e => e.type === "message").map(e => {
                    const peer = e.source === selAgent.id ? e.target : e.source;
                    return (
                      <div key={peer} className="flex items-center gap-2 px-2 py-1 text-[10px] font-mono cursor-pointer hover:bg-white/[0.03] rounded"
                        onClick={() => setSelected(peer)}>
                        <span className="text-white/40">{e.source === selAgent.id ? "→" : "←"} {peer}</span>
                        <span className="text-white/15 ml-auto">{e.count}x</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div>
              <p className="text-[10px] text-white/40 mb-1">Click an agent node</p>
              <p className="text-[9px] text-white/20 mb-4">Scroll to zoom · Drag to pan</p>
              {machines.map(m => {
                const mAgents = agents.filter(a => a.node === m);
                return (
                  <div key={m} className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: machineColor(m), boxShadow: `0 0 6px ${machineColor(m)}40` }} />
                      <span className="text-[11px] font-mono font-bold" style={{ color: machineColor(m) }}>{m}</span>
                      <span className="text-[9px] font-mono text-white/30 ml-auto">{mAgents.length}</span>
                    </div>
                    {mAgents.map(a => (
                      <div key={a.id} className="flex items-center gap-2 px-3 py-0.5 text-[10px] font-mono cursor-pointer hover:bg-white/[0.05] rounded"
                        onClick={() => setSelected(a.id)}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusGlow(agentStatuses[a.id] || "idle"), boxShadow: `0 0 4px ${statusGlow(agentStatuses[a.id] || "idle")}60` }} />
                        <span className="text-white/50">{a.id}</span>
                      </div>
                    ))}
                  </div>
                );
              })}

              {lineageEdges.length > 0 && (
                <div className="mt-4">
                  <div className="text-[9px] font-mono tracking-wider uppercase mb-1.5 text-cyan-400/50">Lineage</div>
                  {lineageEdges.map((l, i) => (
                    <div key={i} className="text-[9px] font-mono text-white/30 px-2 py-0.5">{l.source} → {l.target}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
