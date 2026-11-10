/** @file 擁有者限定的內容草稿 API；經驗證的 AI 結果先載回草稿，不自動發布或修改正式商品。 */
import {Body,Controller,Get,Post,Put,Param,UseGuards,Inject,NotFoundException,ConflictException,BadRequestException} from '@nestjs/common';
import { Op } from 'sequelize';
import { z } from 'zod';
import { OwnerGuard } from './auth';
import { ProductSource } from './content-exchange';
import { Product } from './commerce-db';
import { ContentDraft } from './content-db';
import { database,Attachment,Session,Job,Message } from './db';
import { randomUUID } from 'node:crypto';
import { identifier,parse } from './validation';
import { contentSchema,emptyContent,contentPrompt,sourceFingerprint } from './content-schema';
import { attachmentImage } from './content-images';
import { artifactContent } from './files';
import { WorkspaceService } from './workspace.service';
/** 所有可編輯欄位白名單，禁止 mass assignment。 */
const draftInput=z.object({revision:z.number().int().nonnegative(),category:z.enum(['bracelet','flower','crystal','other']),purpose:z.string().max(3000),content:contentSchema,attachments:z.array(identifier).max(10).refine(ids=>new Set(ids).size===ids.length)}).strict();
@Controller('api/commerce/products/:id/content')
@UseGuards(OwnerGuard)
export class ContentController {
  constructor(@Inject(WorkspaceService) private readonly workspace:WorkspaceService){}
  /** 驗證商品存在；GET 不建立資料。 @returns 商品與可選草稿。 */
  @Get() async read(@Param('id') id:string){const product=await this.product(id);return {product,draft:await ContentDraft.findByPk(id),source:(await ProductSource.findByPk(id))?.source??null};}
  /** 使用版本條件寫入；第一份草稿版本為 1。 @returns 保存後草稿。 */
  @Put() async save(@Param('id') id:string,@Body() body:unknown){
    await this.product(id);
    const input=parse({schema:draftInput,value:body});
    if(await Attachment.count({where:{id:input.attachments}})!==input.attachments.length)throw new BadRequestException('附件不存在');
    return database.transaction(async transaction=>{
      /** 鎖商品列，連第一份草稿的並行建立也一起序列化。 */
      await Product.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
      const row=await ContentDraft.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
      if(row&&row.revision!==input.revision)throw new ConflictException('草稿已變更，請重新載入後再修改');
      if(row)return row.update({...input,revision:row.revision+1},{transaction});
      if(input.revision!==0)throw new ConflictException('草稿版本已失效');
      return ContentDraft.create({productId:id,...input,revision:1,sessionId:null,sourceFingerprint:''},{transaction});
    });
  }
  /** 一次交易保存聊天、訊息及工作；沿用既有額度等待與續跑。 @returns session ID。 */
  @Post('generate') async generate(@Param('id') id:string,@Body() body:unknown){
    await this.product(id);
    const input=parse({schema:z.object({revision:z.number().int().positive(),model:z.string().min(1).max(100),effort:z.string().min(1).max(20),instruction:z.string().max(5000)}).strict(),value:body});
    const option=(await this.workspace.models()).find(row=>row.model===input.model);
    if(!option?.supportedReasoningEfforts.some(row=>row.reasoningEffort===input.effort))throw new BadRequestException('請選擇官方模型及強度');
    return database.transaction(async transaction=>{
      const product=await Product.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});if(!product)throw new NotFoundException('找不到商品');
      const draft=await ContentDraft.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});if(!draft||draft.revision!==input.revision)throw new ConflictException('請先保存最新草稿');
      let session=draft.sessionId?await Session.findByPk(draft.sessionId,{transaction,lock:transaction.LOCK.UPDATE}):null;
      if(session&&await Job.count({where:{sessionId:session.id,state:{[Op.in]:['queued','running','dispatching','waiting_quota']}},transaction}))throw new ConflictException('此商品還有未完成的生成任務');
      if(!session)session=await Session.create({id:randomUUID(),title:`內容：${product.name}`.slice(0,100),model:input.model,effort:input.effort,usage:null},{transaction});
      else await session.update({model:input.model,effort:input.effort},{transaction});
      const prompt=contentPrompt({product:{name:product.name,priceCents:product.priceCents,facts:product.facts,audience:product.audience},category:draft.category,purpose:draft.purpose,content:draft.content??emptyContent,instruction:input.instruction});
      const jobId=randomUUID();
      await Message.create({id:jobId,sessionId:session.id,role:'user',text:prompt,attachments:draft.attachments},{transaction});
      await Job.create({id:jobId,sessionId:session.id,prompt,featurePrompt:'',attachments:draft.attachments,state:'queued',runAt:new Date(),attempts:0,detail:'商品內容草稿等待生成'},{transaction});
      await draft.update({sessionId:session.id,sourceFingerprint:sourceFingerprint(product),revision:draft.revision+1},{transaction});
      return {sessionId:session.id};
    });
  }
  /** 明確操作才讀取模型檔案；失敗、執行中或來源改變時不覆寫草稿。 @returns 驗證後草稿。 */
  @Post('import') async importResult(@Param('id') id:string,@Body() body:unknown){
    await this.product(id);
    const input=parse({schema:z.object({revision:z.number().int().positive()}).strict(),value:body});
    return database.transaction(async transaction=>{
      const product=await Product.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
      const draft=await ContentDraft.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
      if(!product||!draft?.sessionId)throw new BadRequestException('尚未產生內容');
      if(draft.revision!==input.revision)throw new ConflictException('草稿已變更，請重新載入');
      await Session.findByPk(draft.sessionId,{transaction,lock:transaction.LOCK.UPDATE});
      const jobs=await Job.findAll({where:{sessionId:draft.sessionId},order:[['createdAt','DESC']],transaction});
      if(jobs.some(job=>['queued','running','dispatching','waiting_quota'].includes(job.state))||jobs[0]?.state!=='completed')throw new ConflictException('請等待生成工作完成後再載入');
      if(draft.sourceFingerprint!==sourceFingerprint(product))throw new ConflictException('商品資料已修改，請重新生成，避免使用舊規格');
      const file=await artifactContent({sessionId:draft.sessionId,relative:'content-draft.json'});
      if(file.modifiedAt < new Date(jobs[0].get('createdAt') as Date).getTime())throw new ConflictException('結果檔尚未更新，請在對話要求重新寫入 content-draft.json');
      let value:unknown;try{value=JSON.parse(file.text);}catch{throw new BadRequestException('AI 結果不是有效 JSON，請回到對話要求修正 content-draft.json');}
      const content=parse({schema:contentSchema,value});
      return draft.update({content,revision:draft.revision+1},{transaction});
    });
  }
  /** 只匯出使用者明確勾選且屬於此草稿的圖片；不帶出其他參考檔。 */
  @Post('export') async exportPackage(@Param('id') id:string,@Body() body:unknown){
    await this.product(id);
    const input=parse({schema:z.object({revision:z.number().int().positive(),images:z.array(z.object({id:identifier,alt:z.string().max(300)}).strict()).max(10).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length)}).strict(),value:body});
    const draft=await ContentDraft.findByPk(id);if(!draft||draft.revision!==input.revision)throw new ConflictException('請先保存最新草稿再匯出');
    const images=[];const seen=new Set<string>();
    for(const selection of input.images){if(!draft.attachments.includes(selection.id))throw new BadRequestException('圖片不是此商品草稿的附件');const file=await Attachment.findByPk(selection.id);if(!file)throw new NotFoundException('找不到圖片');const image=await attachmentImage(file);if(seen.has(image.sha256))throw new BadRequestException('請移除重複商品圖');seen.add(image.sha256);images.push({...image,alt:selection.alt});}
    return {schemaVersion:1,kind:'cobuy-content',source:(await ProductSource.findByPk(id))?.source??null,productId:id,category:draft.category,purpose:draft.purpose,content:draft.content,images};
  }
  /** ID 驗證後才讀取 ORM。 @returns 商品。 */
  private async product(id:string){parse({schema:identifier,value:id});const product=await Product.findByPk(id);if(!product)throw new NotFoundException('找不到商品');return product;}
}
