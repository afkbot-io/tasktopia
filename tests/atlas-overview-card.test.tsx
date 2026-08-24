import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AtlasOverviewCard,
  cityOverviewCardModel,
  planetOverviewCardModel,
} from "../src/client/components/AtlasOverviewCard";

describe("atlas overview cards", () => {
  it("presents the planet country name, progress, cities and unfinished buildings", () => {
    const model = planetOverviewCardModel({
      name: "Атуталенд",
      progress: 38,
      cityCount: 3,
      unfinishedBuildingCount: 7,
    });

    expect(model).toEqual({
      title: "Атуталенд",
      progress: 38,
      metrics: [
        { label: "Города", value: 3 },
        { label: "В работе", value: 7 },
      ],
    });
  });

  it("uses the same card contract for a city and counts only unfinished buildings", () => {
    const model = cityOverviewCardModel({
      name: "Главный город",
      buildings: [
        { status: "PLANNING", progress: 0 },
        { status: "IN_PROGRESS", progress: 40 },
        { status: "COMPLETED", progress: 100 },
      ],
    });

    expect(model).toEqual({
      title: "Главный город",
      progress: 47,
      metrics: [{ label: "В работе", value: 2 }],
    });
  });

  it("renders both variants through one accessible SVG component", () => {
    const markup = renderToStaticMarkup(<svg><AtlasOverviewCard
      model={{ title: "Северия", progress: 65, metrics: [{ label: "В работе", value: 4 }] }}
      width={144}
      height={48}
      ariaLabel="Открыть Северия"
      onSelect={() => undefined}
    /></svg>);

    expect(markup).toContain("atlas-overview-card");
    expect(markup).toContain("aria-label=\"Открыть Северия\"");
    expect(markup).toContain("В РАБОТЕ 4");
    expect(markup).toContain("65%");
  });

  it("reserves space for progress when the entity name is long", () => {
    const markup = renderToStaticMarkup(<svg><AtlasOverviewCard
      model={{ title: "Федерация Новостроек", progress: 34, metrics: [{ label: "В работе", value: 72 }] }}
      width={144}
      height={38}
      ariaLabel="Открыть Федерацию Новостроек"
      onSelect={() => undefined}
    /></svg>);

    expect(markup).toContain("Федерация Нов…");
    expect(markup).not.toContain(">Федерация Новостроек<");
    expect(markup).toContain(">34%<");
  });
});
