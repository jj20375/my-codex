/** @file 集中定義工作空間的公開登入、管理頁及持久聊天路由。 */
export const routes = {
  commerce: '/commerce',
  connections: '/commerce/connections',
  products: '/commerce/products',
  content: '/commerce/products/:productId/content',
  campaigns: '/commerce/campaigns',
  orders: '/commerce/orders',
  login: '/login',
  chat: '/',
  session: '/sessions/:sessionId',
  jobs: '/jobs',
  schedules: '/schedules',
  features: '/features',
  usage: '/usage',
  settings: '/settings',
} as const;
/** 管理頁可由導覽、直接網址和瀏覽器歷史共同使用。 */
export const managementViews = ['jobs', 'schedules', 'features', 'usage', 'settings'] as const;
export type ManagementView = typeof managementViews[number];
/** @param id 伺服器產生的 session 識別碼。 @returns 聊天路徑。 */
export function sessionPath(id: string): string { return `/sessions/${encodeURIComponent(id)}`; }
