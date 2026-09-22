/** Broad pixel masses keep cloud detail at the same scale as the atlas symbols. */
export function PlanetCloud({variant=0}:{variant?:number}) {
  const shapes=[
    'M-26-4H-18V-10H-6V-14H8V-10H16V-4H26V2H32V8H22V12H-22V8H-32V2H-26Z',
    'M-30-2H-22V-8H-10V-12H2V-8H12V-4H26V2H32V8H20V12H-24V8H-32Z',
    'M-24-4H-12V-12H4V-8H14V-2H26V4H30V10H16V14H-18V10H-30V2H-24Z',
  ];
  return <g className="planet-cloud-mass" shapeRendering="crispEdges" opacity=".64">
    <path d={shapes[variant%shapes.length]} fill="#c2d4be" />
    <path d="M-26 4H-16V8H12V4H26V8H18V12H-20V8H-26Z" fill="#90afa3" />
    <path d="M-14-6H-6V-10H6V-6H14V-2H-14Z" fill="#dce3ca" />
  </g>;
}
