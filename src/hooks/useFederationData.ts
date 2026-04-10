import { useEffect, useCallback } from "react";
import { useWebSocket } from "./useWebSocket";
import { useMqtt } from "./useMqtt";
import { apiUrl } from "../lib/api";
import { useFederationStore } from "../components/federation/store";
import { simulate } from "../components/federation/simulation";
import type { AgentNode, AgentEdge, Particle } from "../components/federation/types";
import type { FeedEvent } from "../lib/feed";

export function useFederationData() {
  const { setGraph, setVersion, setPlugins, setMessageLog, handleFeedEvent, handleFeedHistory, handleLiveMessage } = useFederationStore();

  const handleMessage = useCallback((data: any) => {
    if (data.type === "feed") {
      const e = data.event as FeedEvent;
      handleFeedEvent(e);

      // MessageSend: oracle = sender node, message = "{target}: {body}"
      if (e.event === "MessageSend" && e.message) {
        const colonIdx = e.message.indexOf(": ");
        if (colonIdx > 0) {
          const to = e.message.slice(0, colonIdx).replace(/^.*:/, "").replace(/-oracle$/, "");
          const from = e.oracle.replace(/-oracle$/, "");
          if (from && to) handleLiveMessage(from, to);
        }
      }

      // Also catch relay messages: [node:oracle] → body
      if (e.event === "UserPromptSubmit" && e.message) {
        const relay = e.message.match(/^\[([^\]]+)\]\s*[→>]\s*/);
        if (relay) {
          const from = relay[1].replace(/^.*:/, "").replace(/-oracle$/, "");
          const to = e.oracle.replace(/-oracle$/, "");
          if (from && to && from !== to) handleLiveMessage(from, to);
        }
      }
    } else if (data.type === "feed-history") {
      handleFeedHistory(data.events as FeedEvent[]);
    } else if (data.type === "message") {
      // Direct maw hey message event from WebSocket
      const from = data.from?.replace(/^.*:/, "").replace(/-oracle$/, "") || "";
      const to = data.to?.replace(/^.*:/, "").replace(/-oracle$/, "") || "";
      if (from && to) handleLiveMessage(from, to);
    }
  }, [handleFeedEvent, handleFeedHistory, handleLiveMessage]);

  const { connected } = useWebSocket(handleMessage);

  // MQTT subscription for cross-federation maw hey messages
  const handleMqttMessage = useCallback((msg: { from: string; to: string }) => {
    const from = msg.from.replace(/-oracle$/, "");
    const to = msg.to.replace(/-oracle$/, "");
    if (from && to) handleLiveMessage(from, to);
  }, [handleLiveMessage]);

  const { connected: mqttConnected } = useMqtt(handleMqttMessage);

  useEffect(() => {
    async function load() {
      const [identity, config, fleet, messages, pluginData] = await Promise.all([
        fetch(apiUrl("/api/identity")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/api/config")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/api/fleet")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/api/messages?limit=500")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/api/plugins")).then(r => r.json()).catch(() => null),
      ]);

      if (identity?.version) setVersion(identity.version);
      if (pluginData?.plugins) setPlugins(pluginData.plugins);

      // Load message history for the live panel
      if (messages?.messages) {
        const clean = (s: string) => (s || "").replace(/^.*:/, "").replace(/-oracle$/, "").replace(/-view$/, "");
        const log = messages.messages
          .filter((m: any) => m.ch === "hey") // only maw hey messages
          .map((m: any) => ({
            from: clean(m.from),
            to: clean(m.to),
            msg: (m.msg || "").slice(0, 120),
            ts: new Date(m.ts).getTime(),
          }))
          .reverse(); // newest first
        setMessageLog(log);
      }

      // Agent -> machine map
      const a2m: Record<string, string> = {};
      if (config?.agents) for (const [a, m] of Object.entries(config.agents)) a2m[a] = m as string;

      // Fleet data -> sync_peers, lineage
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

      // Build agent nodes
      const W = (window.innerWidth - 240) || 900;
      const H = (window.innerHeight - 52) || 600;
      const agentList: AgentNode[] = [];
      const seen = new Set<string>();

      for (const [name, machine] of Object.entries(a2m)) {
        if (seen.has(name)) continue;
        seen.add(name);
        const fm = fleetMap[name];
        agentList.push({
          id: name, node: machine,
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
        if (agent.buddedFrom && seen.has(agent.buddedFrom)) addEdge(agent.buddedFrom, agent.id, "lineage");
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
      const newParticles = new Map<string, Particle[]>();
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

      // Run force simulation
      simulate(agentList, edgeList, W, H);

      setGraph(agentList, edgeList, newParticles);
    }

    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [setGraph, setVersion]);

  return { connected, mqttConnected };
}
