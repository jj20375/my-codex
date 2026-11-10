/** @file 商品圖片透過各系統既有媒體 API 傳輸；只接受本機選定的附件與固定媒體來源。 */
import { randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BadRequestException, BadGatewayException } from '@nestjs/common';
import { z } from 'zod';
import { config } from './config';
import { saveAttachments } from './files';
import { attachmentImage } from './content-images';
import { Attachment } from './db';
import { remoteRequest, mediaFetch, responseBytes, type Connection } from './commerce-connection';
/** 以已核定圖集 UUID 取得管理者短效網址；下載回應另檢查5 MiB及檔案簽章。 */
export async function pullCommodityImages(input: { connection: Connection; commodityId: number }) {
  const current = await remoteRequest({
    connection: input.connection,
    path: `/commodities/${input.commodityId}/content`,
  });
  const selections = z
    .array(z.object({ assetId: z.string().uuid(), alt: z.string() }))
    .max(10)
    .parse(current.content?.images ?? []);
  const ids: string[] = [];
  for (const image of selections) {
    const link = await remoteRequest({
      connection: input.connection,
      path: `/media/assets/${image.assetId}/download`,
    });
    const response = await mediaFetch({
      connection: input.connection,
      url: z.string().url().parse(link.url),
    });
    const bytes = await responseBytes({ response, limit: 5 * 1024 * 1024 });
    const extension = bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? '.jpg' : '.png';
    await mkdir(config.UPLOAD_DIR, { recursive: true });
    const temporary = resolve(config.UPLOAD_DIR, randomUUID() + '.tmp');
    await writeFile(temporary, bytes, { mode: 0o600 });
    try {
      const records = await saveAttachments([
        {
          path: temporary,
          size: bytes.length,
          originalname: `商品圖${ids.length + 1}${extension}`,
        } as Express.Multer.File,
      ]);
      ids.push(records[0].id);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  return ids;
}
/** 正式更新商品時才上傳選定圖片；沿用遠端 SHA 去重及分段合併回呼。 */
export async function pushCommodityImages(input: {
  connection: Connection;
  commodityId: number;
  images: Array<{ id: string; alt: string }>;
}) {
  const selections: Array<{ assetId: string; alt: string }> = [];
  for (const image of input.images) {
    const file = await Attachment.findByPk(image.id);
    if (!file) throw new BadRequestException('圖片不存在');
    const portable = await attachmentImage(file);
    const match = await remoteRequest({
      connection: input.connection,
      path: `/commodities/${input.commodityId}/content/image-match?checksum=${portable.sha256}`,
    });
    let assetId = match.assetId as string | null;
    if (!assetId) {
      const bytes = Buffer.from(portable.base64, 'base64');
      const session = await remoteRequest({
        connection: input.connection,
        path: '/media/uploads/sessions',
        method: 'POST',
        body: {
          fileName: portable.name,
          fileSize: bytes.length,
          mimeType: portable.mimeType,
          assetType: 'image',
          tenantId: input.connection.scopeId,
        },
      });
      const upload = z
        .object({
          sessionId: z.string().uuid(),
          assetId: z.string().uuid(),
          uploadToken: z.string().max(16000),
          chunkSize: z.number().int().positive(),
          totalChunks: z.number().int().min(1).max(100),
          uploadBaseUrl: z.string().url(),
        })
        .parse(session);
      if (Math.ceil(bytes.length / upload.chunkSize) !== upload.totalChunks)
        throw new BadGatewayException('遠端分段上傳設定不正確');
      for (let index = 0; index < upload.totalChunks; index++) {
        const start = index * upload.chunkSize;
        const chunk = bytes.subarray(start, Math.min(start + upload.chunkSize, bytes.length));
        const response = await mediaFetch({
          connection: input.connection,
          url: `${upload.uploadBaseUrl}/uploads/${upload.sessionId}/chunks/${index}`,
          method: 'PUT',
          headers: {
            Authorization: 'Bearer ' + upload.uploadToken,
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes ${start}-${start + chunk.length - 1}/${bytes.length}`,
            'X-Chunk-Checksum': createHash('sha256').update(chunk).digest('hex'),
          },
          body: chunk,
        });
        await response.body?.cancel();
      }
      const complete = await mediaFetch({
        connection: input.connection,
        url: `${upload.uploadBaseUrl}/uploads/${upload.sessionId}/complete`,
        method: 'POST',
        headers: { Authorization: 'Bearer ' + upload.uploadToken },
      });
      await complete.body?.cancel();
      const asset = await remoteRequest({
        connection: input.connection,
        path: `/media/assets/${upload.assetId}`,
      });
      if (asset.status !== 'ready')
        throw new BadRequestException('圖片尚在處理，請稍後再套用；已上傳圖片會保留於媒體庫');
      assetId = upload.assetId;
    }
    if (!z.string().uuid().safeParse(assetId).success) throw new BadGatewayException('圖片識別碼格式不正確');
    selections.push({ assetId: assetId!, alt: image.alt });
  }
  return selections;
}
/** SocAI 媒體只採目前工作區的 ready 資產；不傳遞外部 UUID。 */
export async function pushSocialImages(input: {
  connection: Connection;
  images: Array<{ id: string; alt: string }>;
}) {
  const path = `/w/${input.connection.scopeId}/media`;
  const known = await remoteRequest({ connection: input.connection, path });
  if (!Array.isArray(known)) throw new BadGatewayException('遠端素材列表格式不正確');
  const ids: number[] = [];
  for (const selection of input.images) {
    const file = await Attachment.findByPk(selection.id);
    if (!file) throw new BadRequestException('圖片不存在');
    const image = await attachmentImage(file);
    const existing = known.find((asset) => asset.checksum === image.sha256 && asset.status === 'ready');
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from(image.base64, 'base64')], { type: image.mimeType }),
      image.name,
    );
    const created = await remoteRequest({ connection: input.connection, path, method: 'POST', body: form });
    if (!Number.isSafeInteger(created.id) || created.status !== 'ready')
      throw new BadRequestException('社群圖片尚未處理完成，請稍後重試');
    known.push(created);
    ids.push(created.id);
  }
  return ids;
}
