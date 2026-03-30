/**
 * React hook for MQTT — connects once, routes messages to stores.
 * Drop-in replacement for useWebSocket when MQTT broker is available.
 */

import { useState, useEffect, useRef } from "react";
import { connectMqtt, disconnectMqtt, type MqttMessageHandler } from "../lib/mqtt";
import { useFeedStatusStore } from "../lib/feedStatusStore";
import type { PaneStatus } from "../lib/types";
import type { FeedEvent } from "../lib/feed";

export function useMqtt(brokerUrl?: string) {
  const [connected, setConnected] = useState(false);
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    const handlers: MqttMessageHandler = {
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),

      onFeed: (_oracle, event) => {
        setFeedEvents(prev => [...prev.slice(-199), event]);
      },

      onStatus: (oracle, status) => {
        // Find agent target by oracle name and set status
        // For now, store by oracle name — will map to target when sessions arrive
        const { setStatus } = useFeedStatusStore.getState();
        setStatus(`oracle:${oracle}`, status as PaneStatus);
      },

      onSessions: (data) => {
        setSessions(data);
      },
    };

    connectMqtt(brokerUrl, handlers);
    return () => disconnectMqtt();
  }, [brokerUrl]);

  return { connected, feedEvents, sessions };
}
