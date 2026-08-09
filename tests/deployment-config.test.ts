import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production reverse proxy", () => {
  const nginx = readFileSync(new URL("../deploy/nginx-tasktopia.conf", import.meta.url), "utf8");

  it("keeps full country regeneration alive beyond the ordinary API timeout", () => {
    const location = nginx.match(/location ~ \^\/api\/countries\/\[0-9a-f-\]\+\/regenerate\$ \{([\s\S]*?)\n\s*\}/)?.[1];
    expect(location, "dedicated country regeneration location").toBeDefined();

    const readTimeout = Number(location!.match(/proxy_read_timeout\s+(\d+)s;/)?.[1]);
    const sendTimeout = Number(location!.match(/proxy_send_timeout\s+(\d+)s;/)?.[1]);
    expect(readTimeout).toBeGreaterThanOrEqual(900);
    expect(sendTimeout).toBeGreaterThanOrEqual(900);
    expect(location).toContain("proxy_buffering off;");
  });
});
