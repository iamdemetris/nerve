import { createOpenAIRealtimeSession } from "../api/openai-realtime.api";

export type OpenAIRealtimeEvent = Record<string, unknown> & { type: string };

type OpenAIRealtimeConnectionOptions = {
  onEvent: (event: OpenAIRealtimeEvent) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
};

export class OpenAIRealtimeConnection {
  #peer?: RTCPeerConnection;
  #channel?: RTCDataChannel;
  #audio?: HTMLAudioElement;
  #stream?: MediaStream;
  #abort?: AbortController;

  constructor(private readonly options: OpenAIRealtimeConnectionOptions) {}

  static isSupported(): boolean {
    return Boolean(
      typeof window !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof window.RTCPeerConnection === "function",
    );
  }

  async connect(): Promise<void> {
    if (!OpenAIRealtimeConnection.isSupported()) {
      throw new Error("Live voice is not supported in this browser.");
    }
    this.stop();
    this.#abort = new AbortController();
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel("oai-events");
    const audio = new Audio();
    audio.autoplay = true;
    this.#peer = peer;
    this.#channel = channel;
    this.#audio = audio;

    peer.onconnectionstatechange = () =>
      this.options.onConnectionStateChange?.(peer.connectionState);
    peer.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => undefined);
    };
    channel.onmessage = (message) => {
      if (typeof message.data !== "string") return;
      try {
        const event = JSON.parse(message.data) as OpenAIRealtimeEvent;
        if (typeof event.type === "string") this.options.onEvent(event);
      } catch {
        // Ignore malformed provider events; the connection remains usable.
      }
    };

    let openTimeout: number | undefined;
    const opened = new Promise<void>((resolve, reject) => {
      openTimeout = window.setTimeout(
        () => reject(new Error("ChatGPT Voice took too long to connect.")),
        15_000,
      );
      channel.onopen = () => {
        window.clearTimeout(openTimeout);
        resolve();
      };
      channel.onerror = () => {
        window.clearTimeout(openTimeout);
        reject(new Error("The ChatGPT Voice data channel failed."));
      };
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      this.#stream = stream;
      for (const track of stream.getTracks()) peer.addTrack(track, stream);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answerSdp = await createOpenAIRealtimeSession(
        offer.sdp ?? "",
        this.#abort.signal,
      );
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      await opened;
    } catch (error) {
      window.clearTimeout(openTimeout);
      void opened.catch(() => undefined);
      this.stop();
      throw error;
    }
  }

  send(event: Record<string, unknown>): void {
    if (this.#channel?.readyState !== "open") {
      throw new Error("ChatGPT Voice is not connected.");
    }
    this.#channel.send(JSON.stringify(event));
  }

  setMuted(muted: boolean): void {
    for (const track of this.#stream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  setOutputMuted(muted: boolean): void {
    if (this.#audio) this.#audio.muted = muted;
  }

  stop(): void {
    this.#abort?.abort();
    this.#abort = undefined;
    this.#channel?.close();
    this.#channel = undefined;
    this.#peer?.close();
    this.#peer = undefined;
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = undefined;
    if (this.#audio) this.#audio.srcObject = null;
    this.#audio = undefined;
  }
}
