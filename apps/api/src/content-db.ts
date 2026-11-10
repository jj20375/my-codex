/** @file 每個商品的一份持久內容草稿；修訂採整數版本防止不同分頁覆寫。 */
import { DataTypes, Model } from 'sequelize';
import { database,jsonGetter } from './db';
import type { z } from 'zod';
import { contentSchema } from './content-schema';
export class ContentDraft extends Model {
  /** 對應商品，亦為唯一草稿識別。 */ declare productId:string;
  /** 用於內容區塊選擇的分類。 */ declare category:string;
  /** 送禮、檔期等內容用途。 */ declare purpose:string;
  /** 目前可編輯的內容。 */ declare content:z.infer<typeof contentSchema>;
  /** 共用附件識別。 */ declare attachments:string[];
  /** 此商品專用聊天。 */ declare sessionId:string|null;
  /** 防止過期畫面覆寫的版本。 */ declare revision:number;
  /** 最近生成時的商品來源指紋。 */ declare sourceFingerprint:string;
}
/** 僅由 migration 建表，不使用 alter sync。 */
export const contentFields={productId:{type:DataTypes.UUID,primaryKey:true},category:{type:DataTypes.STRING(30),allowNull:false},purpose:{type:DataTypes.TEXT,allowNull:false},content:{type:DataTypes.JSON,allowNull:false,get:jsonGetter('content')},attachments:{type:DataTypes.JSON,allowNull:false,get:jsonGetter('attachments')},sessionId:{type:DataTypes.UUID,allowNull:true},revision:{type:DataTypes.INTEGER.UNSIGNED,allowNull:false,defaultValue:1},sourceFingerprint:{type:DataTypes.STRING(64),allowNull:false,defaultValue:''}};
ContentDraft.init(contentFields,{sequelize:database,tableName:'commerce_content_drafts'});
