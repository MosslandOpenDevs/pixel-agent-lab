import type { ConnState } from "../services/data-bridge.ts";

/**
 * A streaming service's data-API badge: CONNECTING before the first verdict,
 * then LIVE when its signals or its stats answered this poll, OFFLINE when
 * neither did.
 *
 * Shared by the sidebar's Service I/O cards and the phone's belt card, which
 * on a phone is the only text a belt view shows: the two must never give the
 * same service two different words. "connecting" is a state of its own, not
 * an outage — before anything has been polled every service is "not up", and
 * reporting that as OFFLINE would claim an outage no poll has seen.
 */
export function liveBadge(conn: ConnState, up: boolean): string {
    if (conn === "connecting") return `<span class="live-badge wait">CONNECTING</span>`;
    return up ? `<span class="live-badge">LIVE</span>` : `<span class="live-badge off">OFFLINE</span>`;
}

/** Whether a service's data is from an earlier poll: a verdict has come in,
 *  and it says the service did not answer this one. */
export function lapsed(conn: ConnState, up: boolean): boolean {
    return conn !== "connecting" && !up;
}
