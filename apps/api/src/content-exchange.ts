/** @file coBuy 商品工作包匯入；僅由本機擁有者操作，不傳遞兩套系統的登入憑證。 */
import { Controller,Post,Body,UseGuards,ConflictException } from '@nestjs/common';
import { DataTypes,Model,UniqueConstraintError } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OwnerGuard } from './auth';
import { ContentDraft } from './content-db';
import { emptyContent } from './content-schema';
import { attachmentImage } from './content-images';
import { database,jsonGetter,Attachment } from './db';
import { Product } from './commerce-db';
import { identifier,parse } from './validation';
/** 來源是回寫時的比對依據，不能用個人工作台 UUID 替代 coBuy ID。 */
export const cobuySourceSchema=z.object({system:z.literal('cobuy'),tenantId:z.number().int().positive(),commodityId:z.number().int().positive(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** 僅輸入公開商品事實，拒絕登入憑證與任意額外欄位。 */
export const cobuyPackageSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('cobuy-product'),source:cobuySourceSchema,product:z.object({name:z.string().min(1).max(100),priceCents:z.number().int().min(0).max(2_000_000_000),facts:z.string().min(1).max(20000),audience:z.string().min(1).max(5000)}).strict()}).strict();
export class ProductSource extends Model {
  /** 本機商品識別。 */declare productId:string;
  /** 系統、店別及商品組成唯一鍵。 */declare sourceKey:string;
  /** 原始來源指紋。 */declare source:z.infer<typeof cobuySourceSchema>;
}
export const sourceFields={productId:{type:DataTypes.UUID,primaryKey:true},sourceKey:{type:DataTypes.STRING(100),allowNull:false,unique:true},source:{type:DataTypes.JSON,allowNull:false,get:jsonGetter('source')}};
ProductSource.init(sourceFields,{sequelize:database,tableName:'commerce_product_sources'});
@Controller('api/commerce/exchange')
@UseGuards(OwnerGuard)
export class ContentExchangeController {
  /** 明確選擇 refresh 才更新已存在的來源；草稿與舊任務保留。 @returns 對應商品 ID。 */
  @Post('cobuy') async import(@Body() body:unknown){return importCobuyProduct(body);}
}
/** 手動工作包與 API 匯入共用相同驗證、來源去重及交易。 */
export async function importCobuyProduct(body:unknown){
    const input=parse({schema:z.object({package:cobuyPackageSchema,refresh:z.boolean().default(false),attachments:z.array(identifier).max(10).refine(ids=>new Set(ids).size===ids.length).default([])}).strict(),value:body});
    const files=await Attachment.findAll({where:{id:input.attachments}});if(files.length!==input.attachments.length)throw new ConflictException('圖片附件不存在');
    for(const file of files)await attachmentImage(file);
    const sourceKey=`cobuy:${input.package.source.tenantId}:${input.package.source.commodityId}`;
    try{return await database.transaction(async transaction=>{
      const binding=await ProductSource.findOne({where:{sourceKey},transaction,lock:transaction.LOCK.UPDATE});
      async function bindImages(productId:string){
        if(!files.length)return;
        const draft=await ContentDraft.findByPk(productId,{transaction,lock:transaction.LOCK.UPDATE});const ids=draft?.attachments??[];const hashes=new Set<string>();
        for(const id of ids){const existing=await Attachment.findByPk(id,{transaction});if(existing&&['.png','.jpg','.jpeg'].includes(existing.extension)&&existing.size<=5*1024*1024)hashes.add((await attachmentImage(existing)).sha256);}
        for(const file of files){const hash=(await attachmentImage(file)).sha256;if(!hashes.has(hash)){ids.push(file.id);hashes.add(hash);}}
        if(ids.length>10)throw new ConflictException('此草稿加入圖片後超過十個附件，請先整理附件');
        if(draft)await draft.update({attachments:ids,revision:draft.revision+1},{transaction});
        else await ContentDraft.create({productId,category:'other',purpose:'',content:emptyContent,attachments:ids,sessionId:null,revision:1,sourceFingerprint:''},{transaction});
      }
      if(binding){
        if(input.refresh){await Product.update(input.package.product,{where:{id:binding.productId},transaction});await binding.update({source:input.package.source},{transaction});}
        await bindImages(binding.productId);
        return {productId:binding.productId,existing:true,refreshed:input.refresh};
      }
      const product=await Product.create({id:randomUUID(),...input.package.product},{transaction});
      await ProductSource.create({productId:product.id,sourceKey,source:input.package.source},{transaction});
      await bindImages(product.id);
      return {productId:product.id,existing:false,refreshed:false};
    });}catch(error){if(error instanceof UniqueConstraintError)throw new ConflictException('此商品剛被另一個操作匯入，請重新匯入以開啟既有商品');throw error;}
}
