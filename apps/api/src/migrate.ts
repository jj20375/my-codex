/** @file 執行一次性的版本化 schema 建立；僅建立本系統資料表，不使用 sync alter 或刪除資料。 */
import 'reflect-metadata';
import { DataTypes } from 'sequelize';
import { commerceTables } from './commerce-db';
import { sourceFields } from './content-exchange';
import { contentFields } from './content-db';
import { database, tables, usageEventFields, executionFields } from './db';

/** 使用 Sequelize QueryInterface 保留 MariaDB 相容性。 */
const query = database.getQueryInterface();
async function migrate() {
  await database.authenticate();
  /** migration 記錄是唯一允許在每次啟動檢查時建立的固定小表。 */
  await query.createTable('schema_migrations', { name: { type: DataTypes.STRING, primaryKey: true } });
  /** 讀取已套用 migration，整個系統僅使用專用資料庫。 */
  const applied = await query.select(null, 'schema_migrations', { where: { name: '001_initial' } }) as unknown[];
  if (!applied.length) {
    for (const [name, fields] of Object.entries(tables)) {
      await query.createTable(name, { ...fields, createdAt: { type: DataTypes.DATE(3), allowNull: false }, updatedAt: { type: DataTypes.DATE(3), allowNull: false } });
    }
    await query.addIndex('jobs', ['state', 'runAt']);
    await query.addIndex('messages', ['sessionId', 'createdAt']);
    await query.addIndex('schedules', ['state', 'nextRunAt']);
    await query.bulkInsert('schema_migrations', [{ name: '001_initial' }]);
  }
  const usageApplied = await query.select(null, 'schema_migrations', { where: { name: '002_usage_events' } }) as unknown[];
  if (!usageApplied.length) {
    const sessionColumns = await query.describeTable('sessions');
    if (!sessionColumns.usageBaselinePending) {
      await query.addColumn('sessions', 'usageBaselinePending', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
      await query.bulkUpdate('sessions', { usageBaselinePending: true }, { usage: null });
    }
    await query.createTable('usage_events', { ...usageEventFields, createdAt: { type: DataTypes.DATE(3), allowNull: false }, updatedAt: { type: DataTypes.DATE(3), allowNull: false } });
    await query.addIndex('usage_events', ['createdAt']);
    await query.bulkInsert('schema_migrations', [{ name: '002_usage_events' }]);
  }
  /** 新增執行快照；歷史資料不以當前 session 設定猜測回填。 */
  const executionsApplied = await query.select(null, 'schema_migrations', { where: { name: '003_executions' } }) as unknown[];
  if (!executionsApplied.length) {
    await query.createTable('executions', { ...executionFields, createdAt: { type: DataTypes.DATE(3), allowNull: false }, updatedAt: { type: DataTypes.DATE(3), allowNull: false } });
    await query.addIndex('executions', ['sessionId', 'createdAt']);
    await query.bulkInsert('schema_migrations', [{ name: '003_executions' }]);
  }
  const localFilesApplied = await query.select(null, 'schema_migrations', { where: { name: '004_local_files' } }) as unknown[];
  if (!localFilesApplied.length) {
    const columns = await query.describeTable('sessions');
    if (!columns.localFilesEnabled) await query.addColumn('sessions', 'localFilesEnabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await query.bulkInsert('schema_migrations', [{ name: '004_local_files' }]);
  }
  const commerceApplied = await query.select(null, 'schema_migrations', { where: { name: '005_commerce' } }) as unknown[];
  if (!commerceApplied.length) {
    for (const [name,fields] of Object.entries(commerceTables)) await query.createTable(name,{...fields,createdAt:{type:DataTypes.DATE(3),allowNull:false},updatedAt:{type:DataTypes.DATE(3),allowNull:false}});
    await query.bulkInsert('schema_migrations',[{name:'005_commerce'}]);
  }
  /** 商品草稿獨立建表，不覆寫既有商品或活動。 */
  const contentApplied=await query.select(null,'schema_migrations',{where:{name:'006_content_drafts'}}) as unknown[];
  if(!contentApplied.length){
    await query.createTable('commerce_content_drafts',{...contentFields,createdAt:{type:DataTypes.DATE(3),allowNull:false},updatedAt:{type:DataTypes.DATE(3),allowNull:false}});
    await query.bulkInsert('schema_migrations',[{name:'006_content_drafts'}]);
  }
  /** 以來源唯一鍵避免同一 coBuy 商品重複匯入。 */
  const sourcesApplied=await query.select(null,'schema_migrations',{where:{name:'007_product_sources'}}) as unknown[];
  if(!sourcesApplied.length){await query.createTable('commerce_product_sources',{...sourceFields,createdAt:{type:DataTypes.DATE(3),allowNull:false},updatedAt:{type:DataTypes.DATE(3),allowNull:false}});await query.bulkInsert('schema_migrations',[{name:'007_product_sources'}]);}
  await database.close();
  console.log('資料庫 migration 完成');
}
migrate().catch(async () => { console.error('Migration 失敗，請檢查資料庫設定及 migration 狀態。'); await database.close(); process.exitCode = 1; });
