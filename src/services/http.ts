/**
 * Shared JSON fetch for the three service clients.
 *
 * Every client repeated the same fetch / check `res.ok` / parse sequence, so it
 * lives here once. It is also the single place a caller's AbortSignal reaches
 * the network, which is what lets DataBridge bound and cancel a whole poll
 * cycle instead of leaving requests running after teardown.
 */
export async function getJSON<T>(url: string, label: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${label}: ${res.status}`);
    return (await res.json()) as T;
}

/**
 * What every reader here checks before trusting a parsed body's fields. JSON
 * gives no guarantee of shape — `null`, an array or a bare string all parse —
 * and the generic in `getJSON<T>` is an assertion, not a check.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The same fetch, but the HTTP status comes back with the body instead of
 * replacing it.
 *
 * The health contract asks for an unconditional 200, and most services give
 * one. `signal` and `signalmap` deliberately do not: they answer 503 when their
 * feed has nothing good left to serve, because `mossland-signal/scripts/
 * deploy.sh` (`data_ok()`) gates its deploy on that status code. Making them
 * unconditionally 200 would turn that alarm into a tautology, so the 503 is
 * correct and stays.
 *
 * What was wrong was reading it. `getJSON` throws before parsing, so a 503
 * carrying a perfectly good `{"status":"degraded"}` was discarded whole and the
 * service fell back to "not health-checked" — an outage and a service we never
 * looked at drew the same mark. This lets the caller keep the verdict.
 *
 * A *thrown* fetch still propagates. DNS failure, a CORS wall, an abort —
 * before the headers or partway through the body: those mean we could not see
 * the service, which is a different claim from the service telling us it is
 * unwell, and it must keep reading as unmeasured.
 *
 * Never answered from the HTTP cache. A health reading is a claim about now, so
 * it has to be a round trip made now. city's aggregate is served cacheable with
 * stale-while-revalidate, and under the default cache mode the browser answers
 * that from disk — offline too — handing back an old aggregate as this sweep's
 * first-hand answer: city "ok" because it seemed to answer, its siblings as they
 * were, and the sweep dated now. Bypassing the cache makes an unreachable
 * service throw, which is the unmeasured case above.
 */
export async function getJSONWithStatus<T>(
    url: string,
    signal?: AbortSignal,
): Promise<{ httpCode: number; data: T | null }> {
    const res = await fetch(url, { signal, cache: "no-store" });
    // Read the whole body before deciding anything, and outside the try. An
    // abort or a dropped connection *during* the read is the same claim as one
    // before the headers — we could not see the answer — so it propagates like
    // one. Catching it with the parse used to turn a 503 whose body was cut
    // off (by the sweep's own timeout, say) into this service's verdict of
    // "down", when the part we never received may well have said "degraded".
    const text = await res.text();
    try {
        return { httpCode: res.status, data: JSON.parse(text) as T };
    } catch {
        // Reached it, read all of it, and it was not JSON — an nginx error
        // page, say. The status code is then the only thing it told us. No
        // `label` and no throw here, unlike getJSON: there is no error to name,
        // because an unreadable answer is itself the reading.
        return { httpCode: res.status, data: null };
    }
}
