export type CityNewsItem = {
  taskId: string;
  taskNumber: number;
  title: string;
  cityName: string;
  kind: "COMPLETED" | "DEFECT" | "OPENED" | "ASSIGNED";
  count: number;
  lastEventId: number;
  at: string;
  unread: boolean;
};
export type CityNews = {
  items: CityNewsItem[];
  unreadCount: number;
  nextBefore: number | null;
};
