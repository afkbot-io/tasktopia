# Changelog

## 0.6.0

### Added

- District morphology and archetype-aware building selection.
- Sidewalk, pedestrian path, driveway and roadside feature layers.
- Large gas station, mixed-use apartment, bus stops, city signs and walkers.
- Civic coverage and sealed-district audits.
- District parks and groves with playgrounds, benches, picnic tables, bins, lamps and mixed trees.

### Changed

- Street generation from raw road bands to mobility-aware profiles.
- District overlay default visibility and completed task badges.
- Intercity connector decoration and city entry presentation.

### Fixed

- Unreachable building entrances.
- New roads mutating completed districts.
- Curbs around thin pedestrian access roads.
- Random mixing of incompatible residential building families.
- Missing main/cross streets when a district connector attached to a branch first.
- Linear chains of districts; repeated cardinal sectors are now penalized.
- False district expansion caused by access search being trapped inside a parcel.
- Quadratic green-space candidate scans; occupancy and road snapshots are now reused per district.
