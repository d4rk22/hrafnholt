import * as snmp from "net-snmp";
import { upsDataSchema, type PanelData } from "../contracts/dashboard.js";
import { type Collector } from "./collector.js";

type UpsOptions = {
  host: string;
  username: string;
  authPassword: string;
  privacyPassword: string;
};

export const UPS_OIDS = [
  "1.3.6.1.2.1.33.1.2.1.0",
  "1.3.6.1.2.1.33.1.2.2.0",
  "1.3.6.1.2.1.33.1.2.3.0",
  "1.3.6.1.2.1.33.1.2.4.0",
  "1.3.6.1.2.1.33.1.4.4.1.5.1",
];

function valueAsNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/-?\d+/);
  if (!match) throw new Error("UPS returned a non-numeric value");
  return Number(match[0]);
}

export function normalizeUpsValues(values: unknown[]): PanelData<"ups"> {
  if (values.length !== UPS_OIDS.length) throw new Error("UPS returned an incomplete response");
  const statusCode = valueAsNumber(values[0]);
  const batteryStatus = statusCode === 2 ? "normal" : statusCode === 3 ? "low" : statusCode === 4 ? "depleted" : "unknown";
  return upsDataSchema.parse({
    batteryStatus,
    secondsOnBattery: Math.max(0, valueAsNumber(values[1])),
    runtimeMinutes: Math.max(0, valueAsNumber(values[2])),
    chargePercent: Math.min(100, Math.max(0, valueAsNumber(values[3]))),
    loadPercent: Math.min(100, Math.max(0, valueAsNumber(values[4]))),
  });
}

export function createUpsCollector(options: UpsOptions): Collector<"ups"> {
  return {
    name: "UPS SNMPv3",
    panel: "ups",
    source: "UPS SNMPv3",
    intervalMs: 15_000,
    staleAfterMs: 60_000,
    timeoutMs: 4_000,
    required: true,
    enabled: Boolean(options.username && options.authPassword && options.privacyPassword),
    schema: upsDataSchema,
    collect: ({ signal }) => new Promise((resolve, reject) => {
      const user: snmp.User = {
        name: options.username,
        level: snmp.SecurityLevel.authPriv,
        authProtocol: snmp.AuthProtocols.sha,
        authKey: options.authPassword,
        privProtocol: snmp.PrivProtocols.aes,
        privKey: options.privacyPassword,
      };
      const session = snmp.createV3Session(options.host, user, { timeout: 3_500, retries: 0 });
      let closed = false;
      // Closing the session cancels pending requests, which invokes this
      // collector's response callback from inside the socket close handler. A
      // second close() there throws ERR_SOCKET_DGRAM_NOT_RUNNING outside the
      // promise and takes down the process.
      const closeSession = () => {
        if (closed) return;
        closed = true;
        try {
          session.close();
        } catch {
          // Session already torn down.
        }
      };
      const abort = () => {
        closeSession();
        reject(new Error("UPS SNMP request aborted"));
      };
      signal.addEventListener("abort", abort, { once: true });
      session.get(UPS_OIDS, (error, varbinds) => {
        signal.removeEventListener("abort", abort);
        closeSession();
        if (error) return reject(new Error(`UPS SNMP request failed: ${error.message}`));
        if (!varbinds || varbinds.some((varbind) => snmp.isVarbindError(varbind))) {
          return reject(new Error("UPS SNMP returned an unavailable OID"));
        }
        try {
          resolve(normalizeUpsValues(varbinds.map((varbind) => varbind.value)));
        } catch (normalizationError) {
          reject(normalizationError);
        }
      });
    }),
  };
}
