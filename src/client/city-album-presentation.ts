import type { CityAlbumItem, CityDevelopmentFacts } from '../shared/city-album';
import { INFRASTRUCTURE_LABELS } from '../shared/city-development-policy';

export const CITY_ALBUM_LABELS: Record<CityAlbumItem['type'], string> = {
  'city.created': 'Основан город', 'district.created': 'Заложен район', 'district.activated': 'Началось развитие района',
  'district.completed': 'Район завершён', 'district.deleted': 'Район освобождён',
  'task.created': 'Заложен новый объект', 'task.deleted': 'Объект разобран', 'task.status_changed': 'Изменился этап строительства',
};
const factLabels = { tasks: 'Объекты', buildings: 'Здания', parks: 'Парки', completedTasks: 'Завершено', occupiedBlocks: 'Кварталы', activeDistricts: 'Активные районы', completedDistricts: 'Готовые районы' } as const;
export function cityAlbumComparison(before: CityDevelopmentFacts, after: CityDevelopmentFacts) {
  const rows: { label: string; before: number; after: number }[] = Object.entries(factLabels).map(([key, label]) => ({ label,
    before: before[key as keyof typeof factLabels], after: after[key as keyof typeof factLabels] }));
  const roles = new Set([...before.readyServices, ...after.readyServices].map(service => service.role));
  for (const role of roles) rows.push({ label: INFRASTRUCTURE_LABELS[role], before: before.readyServices.find(service => service.role === role)?.count ?? 0,
    after: after.readyServices.find(service => service.role === role)?.count ?? 0 });
  return rows.filter(row => row.before !== row.after);
}
