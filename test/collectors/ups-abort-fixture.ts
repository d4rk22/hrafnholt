// Support fixture for ups.test.ts. Aborting an in-flight UPS request makes
// net-snmp cancel pending requests from inside the socket close handler; a
// second close() there throws ERR_SOCKET_DGRAM_NOT_RUNNING and exits the
// process without reaching any uncaughtException handler, so the regression
// can only be observed from the outside as a nonzero exit.
import { createUpsCollector } from "../../src/collectors/ups.js";

const collector = createUpsCollector({
  host: "192.0.2.1",
  username: "ups-user",
  authPassword: "auth-password",
  privacyPassword: "privacy-password",
});
const controller = new AbortController();
collector.collect({ signal: controller.signal }).catch(() => {});
// Abort from a later task so the UDP socket is already open and the request is
// genuinely in flight. Aborting synchronously tears down before the socket is
// ready and never reaches the close race.
setTimeout(() => controller.abort(), 0);
setTimeout(() => process.exit(0), 1_000);
