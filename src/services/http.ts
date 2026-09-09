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
