/** @file 以 Sequelize 管理專用 MariaDB 資料庫；模型與 migration 分離，不在服務啟動時修改既有 schema。 */
import { DataTypes, Model, Sequelize } from 'sequelize';
import { config } from './config';
/** 不輸出 SQL 或連線密碼。 */
export const database = new Sequelize(config.DB_NAME, config.DB_USER, config.DB_PASSWORD, { dialect: 'mysql', host: config.DB_HOST, port: config.DB_PORT, logging: false, timezone: '+00:00', pool: { max: 5 } });
/** MariaDB 的 JSON 可能透過 mysql2 以字串傳回，統一解析。 @param field 欄位名稱。 @returns JSON getter。 */
export function jsonGetter(field: string) {
  return function(this: Model): unknown {
    /** 驅動回傳型態決定是否需要解析。 */
    const value: unknown = this.getDataValue(field);
    return typeof value === 'string' ? JSON.parse(value) : value;
  };
}
export class Session extends Model {
  /** 官方 thread 建立時已註冊本機資料夾工具。 */ declare localFilesEnabled: boolean;
  /** 本機工作階段識別碼。 */ declare id: string;
  /** Codex 原生持久對話識別碼。 */ declare threadId: string | null;
  /** 側欄標題。 */ declare title: string;
  /** 使用者選取模型。 */ declare model: string;
  /** 推理強度。 */ declare effort: string;
  /** 官方回傳的累積用量，未知時為 null。 */ declare usage: Record<string, number> | null;
  /** 舊 session 缺少基準時，第一個快照只建立基準。 */ declare usageBaselinePending: boolean;
}
export class UsageEvent extends Model {
  /** 紀錄識別碼。 */ declare id: string;
  /** 來源 session。 */ declare sessionId: string;
  /** 收到累積快照時計算的增量。 */ declare usage: Record<string, number>;
}
/** 每次送往 Codex 的執行快照，不受聊天之後切換模型影響。 */
export class Execution extends Model {
  /** 執行識別碼。 */ declare id: string;
  /** 原始工作。 */ declare jobId: string;
  /** 原始聊天。 */ declare sessionId: string;
  /** 執行嘗試序號。 */ declare attempt: number;
  /** 官方 turn。 */ declare turnId: string | null;
  /** 送出時的模型。 */ declare model: string;
  /** 送出時的推理強度。 */ declare effort: string;
  /** 已記錄的用量增量；尚無資料為 null。 */ declare usage: Record<string, number> | null;
}
export const executionFields = { id: { type: DataTypes.UUID, primaryKey: true }, jobId: { type: DataTypes.UUID, allowNull: false }, sessionId: { type: DataTypes.UUID, allowNull: false }, attempt: { type: DataTypes.INTEGER, allowNull: false }, turnId: { type: DataTypes.STRING, allowNull: true, unique: true }, model: { type: DataTypes.STRING, allowNull: false }, effort: { type: DataTypes.STRING, allowNull: false }, usage: { type: DataTypes.JSON, allowNull: true, get: jsonGetter('usage') } };
Execution.init(executionFields, { sequelize: database, tableName: 'executions', timestamps: true });
export const usageEventFields = { id: { type: DataTypes.UUID, primaryKey: true }, sessionId: { type: DataTypes.UUID, allowNull: false }, usage: { type: DataTypes.JSON, allowNull: false, get: jsonGetter('usage') } };
UsageEvent.init(usageEventFields, { sequelize: database, tableName: 'usage_events', timestamps: true });
export class Message extends Model {
  /** 訊息識別碼。 */ declare id: string;
  /** 所屬本機 session。 */ declare sessionId: string;
  /** 顯示角色。 */ declare role: string;
  /** 使用者文字或 agent item 完整內容。 */ declare text: string;
  /** 附件列表。 */ declare attachments: string[];
}
export class Job extends Model {
  /** 任務識別碼，也是外部送出內容的去重標記。 */ declare id: string;
  /** 所屬 session。 */ declare sessionId: string;
  /** 執行時不可變的使用者指示快照。 */ declare prompt: string;
  /** 功能 prompt 快照。 */ declare featurePrompt: string;
  /** 附件識別碼清單。 */ declare attachments: string[];
  /** queued / dispatching / running / waiting_quota / completed / failed / cancelled / needs_review。 */ declare state: string;
  /** 排程與額度重試的執行時刻。 */ declare runAt: Date;
  /** 官方 turn 識別碼，續跑時會更新。 */ declare turnId: string | null;
  /** 已啟動的 turn 次數。 */ declare attempts: number;
  /** 人類可讀執行狀態。 */ declare detail: string;
  /** 自動排程來源。 */ declare scheduleId: string | null;
}
export class Feature extends Model {
  /** 功能識別碼。 */ declare id: string;
  /** 顯示名稱。 */ declare name: string;
  /** 可重用的開發者指示。 */ declare prompt: string;
}
export class Attachment extends Model {
  /** 隨機識別碼，不採用上傳檔名做儲存路徑。 */ declare id: string;
  /** 原始顯示檔名。 */ declare name: string;
  /** 後端驗證後的副檔名。 */ declare extension: string;
  /** 檔案位元組數。 */ declare size: number;
}
export class Schedule extends Model {
  /** 排程識別碼。 */ declare id: string;
  /** 原始聊天 session。 */ declare sessionId: string;
  /** 排程名稱。 */ declare title: string;
  /** 排程執行內容。 */ declare prompt: string;
  /** 下次執行時刻，以 UTC 持久保存。 */ declare nextRunAt: Date;
  /** null 代表單次；否則以分鐘為週期。 */ declare intervalMinutes: number | null;
  /** proposed / active / paused / completed。 */ declare state: string;
}
/** 模型欄位與 migration 共用，避免初始化與執行時結構漂移。 */
export const tables = {
  sessions: { localFilesEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, id: { type: DataTypes.UUID, primaryKey: true }, threadId: { type: DataTypes.STRING, allowNull: true }, title: { type: DataTypes.STRING, allowNull: false }, model: { type: DataTypes.STRING, allowNull: false }, effort: { type: DataTypes.STRING, allowNull: false }, usage: { type: DataTypes.JSON, allowNull: true, get: jsonGetter('usage') }, usageBaselinePending: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false } },
  messages: { id: { type: DataTypes.UUID, primaryKey: true }, sessionId: { type: DataTypes.UUID, allowNull: false }, role: { type: DataTypes.STRING(20), allowNull: false }, text: { type: DataTypes.TEXT('long'), allowNull: false }, attachments: { type: DataTypes.JSON, allowNull: false, get: jsonGetter('attachments') } },
  jobs: { id: { type: DataTypes.UUID, primaryKey: true }, sessionId: { type: DataTypes.UUID, allowNull: false }, prompt: { type: DataTypes.TEXT('long'), allowNull: false }, featurePrompt: { type: DataTypes.TEXT, allowNull: false }, attachments: { type: DataTypes.JSON, allowNull: false, get: jsonGetter('attachments') }, state: { type: DataTypes.STRING(30), allowNull: false }, runAt: { type: DataTypes.DATE(3), allowNull: false }, turnId: { type: DataTypes.STRING, allowNull: true }, attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, detail: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' }, scheduleId: { type: DataTypes.UUID, allowNull: true } },
  features: { id: { type: DataTypes.UUID, primaryKey: true }, name: { type: DataTypes.STRING(100), allowNull: false }, prompt: { type: DataTypes.TEXT, allowNull: false } },
  attachments: { id: { type: DataTypes.UUID, primaryKey: true }, name: { type: DataTypes.STRING, allowNull: false }, extension: { type: DataTypes.STRING(10), allowNull: false }, size: { type: DataTypes.INTEGER, allowNull: false } },
  schedules: { id: { type: DataTypes.UUID, primaryKey: true }, sessionId: { type: DataTypes.UUID, allowNull: false }, title: { type: DataTypes.STRING(100), allowNull: false }, prompt: { type: DataTypes.TEXT, allowNull: false }, nextRunAt: { type: DataTypes.DATE(3), allowNull: false }, intervalMinutes: { type: DataTypes.INTEGER, allowNull: true }, state: { type: DataTypes.STRING(20), allowNull: false } },
};
for (const [model, tableName] of [[Session, 'sessions'], [Message, 'messages'], [Job, 'jobs'], [Feature, 'features'], [Attachment, 'attachments'], [Schedule, 'schedules']] as const) model.init(tables[tableName], { sequelize: database, tableName, timestamps: true });
