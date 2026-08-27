import type { SVGProps } from "react";

export type AtlasOverviewCardModel = {
  title: string;
  progress: number;
  metrics: Array<{ label: string; value: number }>;
};

function boundedProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export function planetOverviewCardModel(country: {
  name: string;
  progress: number;
  cityCount: number;
  unfinishedBuildingCount: number;
}): AtlasOverviewCardModel {
  return {
    title: country.name,
    progress: boundedProgress(country.progress),
    metrics: [
      { label: "Города", value: country.cityCount },
      { label: "В работе", value: country.unfinishedBuildingCount },
    ],
  };
}

type AtlasOverviewCardProps = Omit<SVGProps<SVGGElement>, "onSelect"> & {
  model: AtlasOverviewCardModel;
  width: number;
  height: number;
  ariaLabel: string;
  onSelect: () => void;
};

export function AtlasOverviewCard({ model, width, height, ariaLabel, onSelect, className = "", ...groupProps }: AtlasOverviewCardProps) {
  const titleCapacity = Math.max(6, Math.floor((width - 58) / 6.6));
  const title = model.title.length > titleCapacity ? `${model.title.slice(0, titleCapacity)}…` : model.title;
  const metrics = model.metrics.map(({ label, value }) => `${label.toLocaleUpperCase("ru-RU")} ${value}`).join(" · ");
  return <g
    {...groupProps}
    className={`atlas-overview-card ${className}`.trim()}
    role="button"
    tabIndex={0}
    aria-label={ariaLabel}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => { event.stopPropagation(); onSelect(); }}
    onKeyDown={(event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      onSelect();
    }}
  >
    <rect className="atlas-overview-card-hit" width={width} height={height} />
    <text className="atlas-overview-card-title" x="10" y="15">{title}</text>
    <text className="atlas-overview-card-progress" x={width - 10} y="15" textAnchor="end">{model.progress}%</text>
    <text className="atlas-overview-card-meta" x={width / 2} y="27" textAnchor="middle">{metrics}</text>
    <rect className="atlas-overview-progress-track" x="10" y={height - 5} width={width - 20} height="2" />
    <rect className="atlas-overview-progress-value" x="10" y={height - 5} width={(width - 20) * model.progress / 100} height="2" />
  </g>;
}
