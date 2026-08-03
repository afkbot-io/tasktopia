# Changelog

## Added

- 12 building families with five construction stages: gas station, parking lot, shopping plaza, cafe, pharmacy, auto repair, five private houses and post office.
- 12 generated reusable street props, plus copied V2 essentials under a unified `PropSpec`/manifest contract.
- Dedicated street-prop catalog and expanded first-city proof scene.

## Changed

- Building catalog now contains 32 families and 160 construction sprites.
- Atlas and manifest now describe 17 props with exact canvas, footprint and bottom-center anchor.
- Road topology validation now inspects tile ids only, so building names such as `commercial-corner-cafe` do not produce a false positive.
