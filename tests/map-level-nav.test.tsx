import { Children, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MapLevelNav } from "../src/client/components/MapLevelNav";

describe("direct map level navigation", () => {
  it.each([true, false])("hides city controls on planet, city available=%s", hasCity => {
    expect(renderToStaticMarkup(<MapLevelNav level="PLANET" hasCity={hasCity} onChange={() => undefined} />)).toBe("");
  });
  it("offers planet, city and districts only inside the city", () => {
    const html = renderToStaticMarkup(<MapLevelNav level="CITY" hasCity onDistrictsChange={() => undefined} onChange={() => undefined} />);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("Страна");
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('aria-current="page">Город</button>');
  });
  it("does not restart the active city", () => {
    const onChange = vi.fn();
    const nav = MapLevelNav({ level: "CITY", hasCity: true, onChange })!;
    const buttons = Children.toArray(nav.props.children) as ReactElement<{ onClick: () => void }>[];
    buttons[1]!.props.onClick();
    expect(onChange).not.toHaveBeenCalled();
    buttons[0]!.props.onClick();
    expect(onChange).toHaveBeenLastCalledWith("PLANET");
  });
});
