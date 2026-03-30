/**
 * MQTT client for maw-ui — connects to maw broker via WebSocket.
 * Topic prefix: maw/v1/
 *
 * Topics:
 *   maw/v1/oracle/{name}/feed     — feed events per oracle
 *   maw/v1/oracle/{name}/status   — retained status (busy/ready/idle)
 *   maw/v1/sessions               — session list updates
 *   maw/v1/asks/{name}            — ask notifications per oracle
 */

import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import type { PaneStatus } from "./types";
import type { FeedEvent } from "./feed";

const PREFIX = "maw/v1";
const DEFAULT_BROKER = `ws://${window.location.hostname}:9001`;

export type MqttMessageHandler = {
  onFeed?: (oracle: string, event: FeedEvent) => void;
  onStatus?: (oracle: string, status: PaneStatus) => void;
  onSessions?: (sessions: any[]) => void;
  onAsk?: (oracle: string, ask: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

let client: MqttClient | null = null;
let handlers: MqttMessageHandler = {};

export function connectMqtt(brokerUrl?: string, opts?: MqttMessageHandler): MqttClient {
  if (client?.connected) return client;

  handlers = opts || {};
  const url = brokerUrl || DEFAULT_BROKER;

  client = mqtt.connect(url, {
    reconnectPeriod: 2000,
    connectTimeout: 5000,
    clean: true,
    clientId: `maw-ui-${Math.random().toString(36).slice(2, 8)}`,
  });

  client.on("connect", () => {
    console.log(`[mqtt] connected to ${url}`);
    handlers.onConnect?.();

    // Subscribe to all oracle feeds and statuses
    client!.subscribe(`${PREFIX}/oracle/+/feed`);
    client!.subscribe(`${PREFIX}/oracle/+/status`);
    client!.subscribe(`${PREFIX}/sessions`);
    client!.subscribe(`${PREFIX}/asks/+`);
  });

  client.on("message", (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());
      const parts = topic.split("/");

      // maw/v1/oracle/{name}/feed
      if (parts[2] === "oracle" && parts[4] === "feed") {
        handlers.onFeed?.(parts[3], data);
      }
      // maw/v1/oracle/{name}/status
      else if (parts[2] === "oracle" && parts[4] === "status") {
        handlers.onStatus?.(parts[3], data.status || data);
      }
      // maw/v1/sessions
      else if (parts[2] === "sessions") {
        handlers.onSessions?.(data);
      }
      // maw/v1/asks/{name}
      else if (parts[2] === "asks") {
        handlers.onAsk?.(parts[3], data);
      }
    } catch {
      // ignore malformed messages
    }
  });

  client.on("close", () => {
    handlers.onDisconnect?.();
  });

  client.on("error", (err) => {
    console.warn("[mqtt] error:", err.message);
  });

  return client;
}

export function disconnectMqtt() {
  client?.end();
  client = null;
}

/** Subscribe to a specific oracle's feed */
export function subscribeFeed(oracle: string) {
  client?.subscribe(`${PREFIX}/oracle/${oracle}/feed`);
}

/** Unsubscribe from a specific oracle's feed */
export function unsubscribeFeed(oracle: string) {
  client?.unsubscribe(`${PREFIX}/oracle/${oracle}/feed`);
}

/** Get the current MQTT client */
export function getMqttClient(): MqttClient | null {
  return client;
}
