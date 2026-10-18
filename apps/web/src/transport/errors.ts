import type { CommandAck } from "@devicenet/shared";

/** No `ack` for a `cmd` within CMD_ACK_TIMEOUT_MS. Never assume the command ran (docs §2.2). */
export class HubTimeoutError extends Error {
  override readonly name = "HubTimeoutError";
  constructor(
    readonly hubId: string,
    readonly commandId?: string,
  ) {
    super(`Hub ${hubId} did not answer${commandId ? ` command ${commandId}` : ""}`);
  }
}

/** Refused locally because the hub (or the target device) is offline. */
export class HubOfflineError extends Error {
  override readonly name = "HubOfflineError";
  constructor(
    readonly hubId: string,
    readonly deviceId?: string,
  ) {
    super(deviceId ? `Device ${deviceId} on hub ${hubId} is offline` : `Hub ${hubId} is offline`);
  }
}

/** Hub answered the command with `ok: false`. */
export class CommandFailedError extends Error {
  override readonly name = "CommandFailedError";
  readonly code: CommandAck["error"];
  constructor(readonly ack: CommandAck) {
    super(ack.message ?? `Command ${ack.id} failed${ack.error ? `: ${ack.error}` : ""}`);
    this.code = ack.error;
  }
}
