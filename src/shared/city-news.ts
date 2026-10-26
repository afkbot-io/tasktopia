export const CITY_NEWS_KINDS = ["COMPLETED", "DEFECT", "OPENED", "ASSIGNED", "COMMENT", "MATERIAL", "TESTING"] as const;
export type CityNewsKind = typeof CITY_NEWS_KINDS[number];
export type CityNewsItem = {
  taskId: string;
  taskNumber: number;
  title: string;
  cityName: string;
  cityId?: string;
  kind: CityNewsKind;
  count: number;
  lastEventId: number;
  at: string;
  unread: boolean;
};
export type CityNews = {
  items: CityNewsItem[];
  unreadCount: number;
  nextBefore: number | null;
  nextCursor?: string | null;
};
