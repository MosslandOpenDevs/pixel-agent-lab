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
 * A *thrown* fetch still propagates. DNS failure, a CORS wall, an abort: those
 * mean we could not see the service, which is a different claim from the
 * service telling us it is unwell, and it must keep reading as unmeasured.
 */
export async function getJSONWithStatus<T>(
    url: string,
    signal?: AbortSignal,
): Promise<{ httpCode: number; data: T | null }> {
    const res = await fetch(url, { signal });
    try {
        return { httpCode: res.status, data: (await res.json()) as T };
    } catch {
        // Reached it and it answered, but not with JSON — an nginx error page,
        // say. The status code is then the only thing it told us. No `label`
        // and no throw here, unlike getJSON: there is no error to name, because
        // an unreadable answer is itself the reading.
        return { httpCode: res.status, data: null };
    }
}
