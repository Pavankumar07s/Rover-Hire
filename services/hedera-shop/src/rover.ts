// The rover's LAN API (rover/core/api.py). The shop is the only caller that moves its money lease.
export class RoverClient {
  constructor(private url: string, private token: string) {}

  private async call(method: string, path: string, body?: unknown, timeoutMs = 5000): Promise<Response> {
    return fetch(this.url + path, {
      method,
      headers: { "X-Rover-Token": this.token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  private async json(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<any> {
    const r = await this.call(method, path, body, timeoutMs);
    if (!r.ok) throw new Error(`rover ${method} ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }

  // Mission start also calibrates the camera for the current light (~5-8 s).
  missionStart(quoteId: string, mission: string, photosWanted: number) {
    return this.json("POST", "/mission/start", { episode_id: quoteId, quote_id: quoteId, mission, photos_wanted: photosWanted }, 30_000);
  }

  missionEnd(quoteId: string) {
    return this.json("POST", "/mission/end", { quote_id: quoteId });
  }

  money(quoteId: string, paid: number, txs: string[]) {
    return this.json("POST", "/money", { quote_id: quoteId, paid, txs });
  }

  moneyHeartbeat(quoteId: string) {
    return this.call("POST", "/money/hb", { quote_id: quoteId }, 1000);
  }

  photo(n: number) {
    return this.call("GET", `/photo/${n}`, undefined, 10_000);
  }

  status() {
    return this.json("GET", "/status");
  }
}


// Money heartbeat: POST /money/hb every 250ms while the mission is active.
// Stop immediately when the mission ends (clear the interval on /end).
// The rover's money lease expires within 1s of a missing heartbeat.
let _hbTimer: ReturnType<typeof setInterval> | null = null;
export function startMoneyHeartbeat(quoteId: string, seq: () => number) {
  _hbTimer = setInterval(async () => {
    await roverPost("/money/hb", { quote_id: quoteId, seq: seq() });
  }, 250);
}
export function stopMoneyHeartbeat() {
  if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
}
