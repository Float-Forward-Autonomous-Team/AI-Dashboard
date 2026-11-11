/*
 * Connection to foxglove_bridge on the boat (or the simulator). The bridge is a ROS 2 node
 * that subscribes to topics for us and forwards the messages over one WebSocket.
 *
 *   1. open the WebSocket
 *   2. the bridge "advertises" every topic it can see, with its message definition
 *   3. we subscribe to the topics that have a handler
 *   4. each new ROS message arrives as binary CDR; we decode it and call the handler
 *
 * Ported from float_forward/live/bridge.js (same protocol, same libraries).
 */
import { FoxgloveClient, type Channel } from '@foxglove/ws-protocol';
import { parse } from '@foxglove/rosmsg';
import { MessageReader } from '@foxglove/rosmsg2-serialization';

const RECONNECT_MS = 2000;
// foxglove_bridge 3.x only accepts the newer "foxglove.sdk.v1" name for the same
// protocol; offer it alongside the library's own name so older bridges work too.
const SUBPROTOCOLS = ['foxglove.sdk.v1', FoxgloveClient.SUPPORTED_SUBPROTOCOL];

export type LinkState = 'connecting' | 'connected' | 'disconnected';
export type Handler = (message: unknown, receiveTimeMs: number) => void;
export type Handlers = Record<string, Handler>;

export interface BridgeOptions {
  onStatus?: (state: LinkState, detail: string) => void;
  /** Every topic the bridge advertises now. */
  onTopics?: (channels: Channel[]) => void;
}

export interface BridgeConnection {
  /** Change which topics are streamed, without reconnecting. */
  setHandlers(next: Handlers): void;
  close(): void;
}

type ClientSocket = ConstructorParameters<typeof FoxgloveClient>[0]['ws'];
interface Subscription { subId: number; topic: string; reader: MessageReader }

export function connectBridge(url: string, handlers: Handlers, opts: BridgeOptions = {}): BridgeConnection {
  const onStatus = opts.onStatus ?? (() => {});
  const onTopics = opts.onTopics ?? (() => {});
  let client: FoxgloveClient | null = null;
  let stopped = false;
  let channels = new Map<number, Channel>();        // channel id -> channel
  let subscriptions = new Map<number, Subscription>(); // channel id -> subscription
  let bySubId = new Map<number, Subscription>();     // subscription id -> subscription
  const decodeErrors = new Set<string>();

  /** Subscribe to wanted topics that are advertised; drop the ones no longer wanted. */
  function sync(): void {
    if (!client) return;
    for (const [channelId, sub] of subscriptions) {
      const channel = channels.get(channelId);
      if (!channel || !handlers[channel.topic]) {
        if (channel) client.unsubscribe(sub.subId);
        subscriptions.delete(channelId);
        bySubId.delete(sub.subId);
      }
    }
    for (const channel of channels.values()) {
      if (subscriptions.has(channel.id) || !handlers[channel.topic]) continue;
      if (channel.encoding !== 'cdr' || channel.schemaEncoding === 'ros2idl') continue;
      let reader: MessageReader;
      try {
        reader = new MessageReader(parse(channel.schema, { ros2: true }));
      } catch (err) {
        console.warn(`[bridge] cannot read the definition of ${channel.topic} (${channel.schemaName})`, err);
        continue;
      }
      const subId = client.subscribe(channel.id);
      const sub = { subId, topic: channel.topic, reader };
      subscriptions.set(channel.id, sub);
      bySubId.set(subId, sub);
    }
  }

  function open(): void {
    onStatus('connecting', url);
    channels = new Map();
    subscriptions = new Map();
    bySubId = new Map();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, SUBPROTOCOLS);
    } catch (err) {
      // a malformed address throws at once; report it and do not retry
      onStatus('disconnected', `bad address ${url}: ${String(err)}`);
      return;
    }
    // the library's socket type is stricter than the DOM type, but it is built for the browser WebSocket
    client = new FoxgloveClient({ ws: ws as unknown as ClientSocket });

    client.on('open', () => onStatus('connected', url));
    client.on('error', err => onStatus('disconnected', String((err as Error)?.message ?? err)));
    client.on('close', () => {
      onStatus('disconnected', url);
      if (!stopped) setTimeout(open, RECONNECT_MS);
    });
    client.on('advertise', added => {
      for (const channel of added) channels.set(channel.id, channel);
      sync();
      onTopics([...channels.values()]);
    });
    client.on('unadvertise', removed => {
      for (const id of removed) channels.delete(id);
      sync();
      onTopics([...channels.values()]);
    });
    client.on('message', ({ subscriptionId, data }) => {
      const sub = bySubId.get(subscriptionId);
      const handler = sub && handlers[sub.topic];
      if (!sub || !handler) return;
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      let message: unknown;
      try {
        message = sub.reader.readMessage(bytes);
      } catch (err) {
        if (!decodeErrors.has(sub.topic)) { decodeErrors.add(sub.topic); console.warn(`[bridge] cannot decode ${sub.topic}`, err); }
        return;
      }
      handler(message, Date.now());
    });
  }

  open();
  return {
    setHandlers(next) { handlers = next; sync(); },
    close() { stopped = true; client?.close(); },
  };
}
