import { Children, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MapLevelNav, type MapLevel } from "../src/client/components/MapLevelNav";

const levels: MapLevel[] = ["PLANET", "COUNTRY", "CITY"];
const labels = ["Планета", "Страна", "Город"];

describe("direct map level navigation", () => {
  it.each(levels)("offers every retained destination from %s", (level) => {
    const html = renderToStaticMarkup(<MapLevelNav level={level} hasCity onChange={() => undefined} />);
    expect(html).not.toContain("disabled");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(`aria-current="page">${labels[levels.indexOf(level)]}</button>`);
  });

  it.each(["PLANET", "COUNTRY"] as const)("only disables the absent city from %s", (level) => {
    const html = renderToStaticMarkup(<MapLevelNav level={level} hasCity={false} onChange={() => undefined} />);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toContain('disabled="">Город</button>');
  });

  it.each(levels)("does not restart the active %s level", (level) => {
    const onChange = vi.fn();
    const nav = MapLevelNav({ level, hasCity: true, onChange });
    const buttons = Children.toArray(nav.props.children) as ReactElement<{ onClick: () => void }>[];
    buttons[levels.indexOf(level)]!.props.onClick();
    expect(onChange).not.toHaveBeenCalled();
    for (const destination of levels.filter(candidate => candidate !== level)) {
      buttons[levels.indexOf(destination)]!.props.onClick();
      expect(onChange).toHaveBeenLastCalledWith(destination);
    }
  });
});
