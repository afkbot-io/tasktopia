import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfilePresence } from "../src/client/components/ProfilePresence";

describe("profile presence", () => {
  it("places the connection indicator on the profile initial without a visible online label", () => {
    const markup = renderToStaticMarkup(<ProfilePresence initial="Н" online onOpen={() => undefined} />);

    expect(markup).toContain("profile-presence-dot");
    expect(markup).toContain("aria-label=\"Настройки аккаунта, в сети\"");
    expect(markup).not.toContain(">В сети<");
    expect(markup).toContain(">Н<");
  });
});
