/** @file 本機工作台的 coBuy／SocAI 固定操作入口：授權連線、商品讀取、預覽套用及社群草稿。 */
import {
  Body,
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OwnerGuard } from './auth';
import { config } from './config';
import { parse, identifier } from './validation';
import { ContentDraft } from './content-db';
import { Attachment, database } from './db';
import { ProductSource, importCobuyProduct } from './content-exchange';
import { attachmentImage } from './content-images';
import {
  connectionInput,
  providerSchema,
  connectionUrl,
  readConnection,
  readRecord,
  writeRecord,
  sealConnection,
  remoteRequest,
  claimDelivery,
} from './commerce-connection';
import { pullCommodityImages, pushCommodityImages, pushSocialImages } from './commerce-remote-images';
/** 圖片明確勾選且必須綁在當前草稿；不提供任意附件轉送入口。 */
const selectionSchema = z
  .object({
    revision: z.number().int().positive(),
    images: z
      .array(z.object({ id: identifier, alt: z.string().max(300) }).strict())
      .max(10)
      .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
  })
  .strict();
const fieldsSchema = z
  .array(z.enum(['title', 'summary', 'description', 'seoTitle', 'seoDescription', 'images']))
  .min(1)
  .max(6)
  .refine((rows) => new Set(rows).size === rows.length);
interface Binding {
  /** 來源連線身分。 */ connectionId: string;
  /** 對應原商品。 */ commodityId: number;
}
interface Receipt {
  /** 成功或待確認。 */ state: string;
  /** 遠端草稿。 */ postId?: number;
  /** 說明。 */ message?: string;
}
/** 每次操作均以保存版本形成不可變快照；模型無法修改連線與送出目標。 */
async function snapshot(input: { id: string; body: unknown }) {
  parse({ schema: identifier, value: input.id });
  const selection = parse({ schema: selectionSchema, value: input.body });
  const draft = await ContentDraft.findByPk(input.id);
  if (!draft || draft.revision !== selection.revision)
    throw new ConflictException('請先保存最新草稿，再預覽或送出');
  const seen = new Set<string>();
  for (const row of selection.images) {
    if (!draft.attachments.includes(row.id)) throw new BadRequestException('圖片不屬於此草稿');
    const file = await Attachment.findByPk(row.id);
    if (!file) throw new BadRequestException('圖片不存在');
    const image = await attachmentImage(file);
    if (seen.has(image.sha256)) throw new BadRequestException('請移除重複圖片');
    seen.add(image.sha256);
  }
  return { draft, selection };
}
@Controller('api/commerce/connected')
@UseGuards(OwnerGuard)
export class ConnectedCommerceController {
  /** 僅回傳來源位址及店別，不回傳 JWT 或任何密文。 */
  @Get('connections') async connections() {
    const rows = [];
    for (const provider of ['cobuy', 'socai']) {
      const saved = await readRecord<string>('connection-' + provider);
      if (!saved) {
        rows.push({ provider, connected: false });
        continue;
      }
      try {
        const connection = await readConnection(provider);
        rows.push({
          provider,
          connected: true,
          id: connection.id,
          baseUrl: connection.baseUrl,
          mediaUrl: connection.mediaUrl,
          scopeId: connection.scopeId,
        });
      } catch {
        rows.push({ provider, connected: false, error: '請重新連線' });
      }
    }
    return rows;
  }
  /** 保存前驗證真實帳號與工作區；token 僅存伺服器持久 volume 的密文。 */
  @Put('connections/:provider') async connect(@Param('provider') name: string, @Body() body: unknown) {
    const provider = parse({ schema: providerSchema, value: name });
    const value = parse({ schema: connectionInput, value: body });
    const baseUrl = connectionUrl(value.baseUrl);
    const mediaUrl = value.mediaUrl ? connectionUrl(value.mediaUrl) : undefined;
    if (provider === 'cobuy' && !mediaUrl) throw new BadRequestException('請填寫 coBuy 媒體服務位址');
    const previous = await readRecord<string>('connection-' + provider);
    let id: string = randomUUID();
    if (previous) {
      try {
        const old = await readConnection(provider);
        if (old.baseUrl === baseUrl && old.scopeId === value.scopeId && old.mediaUrl === mediaUrl)
          id = old.id;
      } catch {
        /* 已輪替本機密鑰時，允許重新授權。 */
      }
    }
    const connection = { id, ...value, baseUrl, mediaUrl };
    await remoteRequest({ connection, path: '/auth/profile' });
    if (provider === 'socai') await remoteRequest({ connection, path: `/w/${value.scopeId}` });
    await writeRecord({
      key: 'connection-' + provider,
      value: sealConnection({ value: connection, secret: config.SESSION_SECRET, provider }),
    });
    return { connected: true };
  }
  /** 解除連線不刪遠端商品、素材或草稿。 */
  @Delete('connections/:provider') async disconnect(@Param('provider') name: string) {
    const provider = parse({ schema: providerSchema, value: name });
    await writeRecord({ key: 'connection-' + provider, value: null });
    return { connected: false };
  }
  /** 管理商品清單只轉送必要摘要，排除配方、成本與內部管理關聯。 */
  @Get('cobuy/products') async products(@Query('keyword') keyword = '', @Query('page') page = '1') {
    const input = parse({
      schema: z.object({ keyword: z.string().max(100), page: z.coerce.number().int().min(1).max(10000) }),
      value: { keyword, page },
    });
    const connection = await readConnection('cobuy');
    const query = new URLSearchParams({
      tenantId: String(connection.scopeId),
      keyword: input.keyword,
      page: String(input.page),
      perPage: '20',
    });
    const value = await remoteRequest({ connection, path: '/commodities/lists?' + query });
    if (!Array.isArray(value.rows)) throw new BadRequestException('商品列表格式不正確');
    return {
      connectionId: connection.id,
      count: value.count,
      rows: value.rows
        .filter((row: { tenantId: number }) => Number(row.tenantId) === connection.scopeId)
        .map((row: { id: number; name: string; price: number }) => ({
          id: row.id,
          name: row.name,
          price: row.price,
        })),
    };
  }
  /** 直接從商品 API 讀取事實與核定圖集，共用既有匯入交易。 */
  @Post('cobuy/import') async importProduct(@Body() body: unknown) {
    const input = parse({
      schema: z
        .object({
          connectionId: identifier,
          commodityId: z.number().int().positive(),
          refresh: z.boolean(),
          includeImages: z.boolean(),
        })
        .strict(),
      value: body,
    });
    const connection = await readConnection('cobuy');
    if (connection.id !== input.connectionId) throw new ConflictException('連線已變更，請重新載入商品列表');
    const pkg = await remoteRequest({ connection, path: `/commodities/${input.commodityId}/content/export` });
    if (Number(pkg.source?.tenantId) !== connection.scopeId)
      throw new BadRequestException('商品不屬於設定的店家');
    const sourceKey = `cobuy:${connection.scopeId}:${input.commodityId}`;
    const existing = await ProductSource.findOne({ where: { sourceKey } });
    if (existing) {
      const binding = await readRecord<Binding>('binding-' + existing.productId);
      if (binding && binding.connectionId !== connection.id)
        throw new ConflictException('此商品綁定不同的 coBuy 連線，請確認原始來源');
    }
    const attachments = input.includeImages
      ? await pullCommodityImages({ connection, commodityId: input.commodityId })
      : [];
    const result = await importCobuyProduct({ package: pkg, refresh: input.refresh, attachments });
    await writeRecord({
      key: 'binding-' + result.productId,
      value: { connectionId: connection.id, commodityId: input.commodityId },
    });
    return result;
  }
  /** 連線身分與來源指紋均符合才可回寫；避免另一套 coBuy 的相同商品ID被誤改。 */
  private async target(id: string) {
    const connection = await readConnection('cobuy');
    const source = await ProductSource.findByPk(id);
    const binding = await readRecord<Binding>('binding-' + id);
    if (
      !source ||
      !binding ||
      binding.connectionId !== connection.id ||
      binding.commodityId !== source.source.commodityId ||
      source.source.tenantId !== connection.scopeId
    )
      throw new ConflictException('請先從目前 coBuy 連線讀取此商品，確認來源後再套用');
    return { connection, source: source.source };
  }
  /** 差異預覽不修改遠端商品，也不先上傳附件。 */
  @Post('products/:id/preview') async preview(@Param('id') id: string, @Body() body: unknown) {
    const { draft, selection } = await snapshot({ id, body });
    const { connection, source } = await this.target(id);
    const result = await remoteRequest({
      connection,
      path: `/commodities/${source.commodityId}/content/preview`,
      method: 'POST',
      body: { package: { schemaVersion: 1, kind: 'cobuy-content', source, content: draft.content } },
    });
    return {
      ...result,
      images: selection.images.length,
      commodityId: source.commodityId,
      tenantId: source.tenantId,
      revision: draft.revision,
    };
  }
  /** 使用者勾選欄位後才真正套用；遠端仍執行原有交易及指紋檢查。 */
  @Post('products/:id/apply') async apply(@Param('id') id: string, @Body() body: unknown) {
    const input = parse({ schema: selectionSchema.extend({ fields: fieldsSchema }), value: body });
    const { draft, selection } = await snapshot({
      id,
      body: { revision: input.revision, images: input.images },
    });
    const { connection, source } = await this.target(id);
    const pkg = { schemaVersion: 1, kind: 'cobuy-content', source, content: draft.content };
    await remoteRequest({
      connection,
      path: `/commodities/${source.commodityId}/content/preview`,
      method: 'POST',
      body: { package: pkg },
    });
    const images = input.fields.includes('images')
      ? await pushCommodityImages({ connection, commodityId: source.commodityId, images: selection.images })
      : undefined;
    const result = await remoteRequest({
      connection,
      path: `/commodities/${source.commodityId}/content/apply`,
      method: 'POST',
      body: { package: { ...pkg, ...(images ? { images } : {}) }, fields: input.fields },
    });
    /** 已套用後即使讀回失敗，也明確回報已成功，不誘使重送。 */
    let refreshed = false;
    try {
      const current = await remoteRequest({
        connection,
        path: `/commodities/${source.commodityId}/content/export`,
      });
      await database.transaction(async (transaction) => {
        const stored = await ProductSource.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (stored?.source.fingerprint === source.fingerprint) {
          await stored.update({ source: current.source }, { transaction });
          refreshed = true;
        }
      });
    } catch {
      /* 遠端套用成功；下次操作仍會受到舊指紋阻擋。 */
    }
    return { applied: true, revision: result.revision, sourceRefreshed: refreshed };
  }
  /** 帳號清單只有名稱、平台及ID，平台 token 不進入本機前端或模型。 */
  @Get('socai/accounts') async accounts() {
    const connection = await readConnection('socai');
    const rows = await remoteRequest({ connection, path: `/w/${connection.scopeId}/social-accounts` });
    if (!Array.isArray(rows)) throw new BadRequestException('社群帳號列表格式不正確');
    return rows
      .filter((row) => row.status === 'active')
      .map((row) => ({ id: row.id, name: row.name, platform: row.platform, connectionId: connection.id }));
  }
  /** 僅建立草稿；本機持久標記阻擋雙擊、重新整理及逾時後盲目重送。 */
  @Post('products/:id/social-draft') async social(@Param('id') id: string, @Body() body: unknown) {
    const input = parse({
      schema: selectionSchema.extend({
        connectionId: identifier,
        platform: z.enum(['facebook', 'instagram', 'threads']),
        accountIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(20)
          .refine((ids) => new Set(ids).size === ids.length),
      }),
      value: body,
    });
    const { draft } = await snapshot({ id, body: { revision: input.revision, images: input.images } });
    const connection = await readConnection('socai');
    if (input.connectionId !== connection.id) throw new ConflictException('社群連線已變更，請重新選擇帳號');
    const caption = draft.content[input.platform];
    if (!caption.trim()) throw new BadRequestException('此平台尚無文案');
    const accounts = await this.accounts();
    const platform = input.platform === 'facebook' ? 'facebook_page' : input.platform;
    for (const id of input.accountIds)
      if (
        !accounts.some(
          (account) =>
            account.id === id && account.platform === platform && account.connectionId === connection.id,
        )
      )
        throw new BadRequestException('所選帳號與文案平台或工作區不符');
    const key =
      'delivery-' +
      createHash('sha256')
        .update(
          JSON.stringify([
            connection.id,
            id,
            input.revision,
            input.platform,
            [...input.accountIds].sort(),
            input.images,
          ]),
        )
        .digest('hex');
    const previous = await readRecord<Receipt>(key);
    if (previous) {
      if (previous.state === 'complete') return { ...previous, reused: true };
      throw new ConflictException('此草稿傳送結果待確認，請先至 SocAI 檢查；不會自動重送');
    }
    const mediaAssetIds = await pushSocialImages({ connection, images: input.images });
    await claimDelivery(key);
    try {
      const post = await remoteRequest({
        connection,
        path: `/w/${connection.scopeId}/posts`,
        method: 'POST',
        body: { type: 'post', caption, socialAccountIds: input.accountIds, mediaAssetIds },
      });
      if (!Number.isSafeInteger(post.id))
        throw new BadRequestException('遠端已接收但回應缺少草稿識別，請至 SocAI 確認');
      const result = { state: 'complete', postId: post.id, workspaceId: connection.scopeId };
      await writeRecord({ key, value: result });
      return result;
    } catch {
      await writeRecord({ key, value: { state: 'needs_review', message: '請至 SocAI 確認是否已建立草稿' } });
      throw new ConflictException('社群草稿送出結果待確認，請至 SocAI 檢查；系統已阻擋重複送出');
    }
  }
}
