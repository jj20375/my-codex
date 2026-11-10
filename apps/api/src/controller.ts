/** @file 提供經擁有者認證的聊天、任務、排程、附件與功能 API；不將內部 RPC 暴露為通用代理。 */
import { Body, Controller, Get, Post, Patch, Param, Query, Req, Res, Sse, UseGuards, UseInterceptors, UploadedFiles, Inject, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { extname, basename } from 'node:path';
import { merge, interval, map } from 'rxjs';
import { z } from 'zod';
import { WorkspaceService } from './workspace.service';
import { OwnerGuard, authenticated, sameSecret, sessionToken, verifyWrite } from './auth';
import { config } from './config';
import { rpc } from './runner';
import { localFiles } from './local-files';
import { parse } from './validation';
import { Attachment } from './db';
import { identifier } from './validation';
import { resolve } from 'node:path';
import { artifacts, artifactPath, artifactContent, saveAttachments, maxFileSize, extensions } from './files';

@Controller('api/auth')
export class AuthController {
  /** 提供登入狀態，不洩漏擁有者憑證。 @param request 請求。 @returns 是否登入。 */
  @Get('status') status(@Req() request: Request) { return { authenticated: authenticated(request) }; }
  /** 本機擁有者登入，回傳 HttpOnly cookie。 @param body 密碼。 @param request 請求。 @param response 回應。 @returns 登入狀態。 */
  @Post('login') login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    verifyWrite(request);
    /** 登入表單上限避免巨型字串比較造成資源浪費。 */
    const input = parse({ schema: z.object({ password: z.string().min(1).max(256) }).strict(), value: body });
    if (!sameSecret({ supplied: input.password, expected: config.ADMIN_PASSWORD })) throw new UnauthorizedException('密碼不正確');
    response.cookie('workspace', sessionToken(Date.now() + 7 * 86400_000), { httpOnly: true, sameSite: 'strict', secure: config.COOKIE_SECURE === 'true', maxAge: 7 * 86400_000, path: '/api' });
    return { authenticated: true };
  }
  /** 登出只清除此安裝登入，不變更 Codex 訂閱。 @param request 請求。 @param response 回應。 @returns 登出狀態。 */
  @Post('logout') logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { verifyWrite(request); response.clearCookie('workspace', { path: '/api', sameSite: 'strict', secure: config.COOKIE_SECURE === 'true' }); return { authenticated: false }; }
}
@Controller('api')
@UseGuards(OwnerGuard)
export class WorkspaceController {
  constructor(@Inject(WorkspaceService) private readonly workspace: WorkspaceService) {}
  /** 取得官方帳戶及額度。 @returns 帳戶資訊。 */
  @Get('account') account() { return this.workspace.account(); }
  /** 啟動容器可用的官方裝置碼登入，不接收手動 access token。 @returns 官方登入 URL 與一次性驗證碼。 */
  @Post('account/login') loginCodex() { return rpc({ method: 'account/login/start', params: { type: 'chatgptDeviceCode' } }); }
  /** 登出此 runner 的 Codex 帳戶。 @returns 協定結果。 */
  @Post('account/logout') logoutCodex() { return rpc({ method: 'account/logout' }); }
  /** 查詢官方模型與強度。 @returns 模型目錄。 */
  @Get('models') models() { return this.workspace.models(); }
  /** 列出聊天。 @returns 聊天列表。 */
  @Get('sessions') sessions() { return this.workspace.sessions(); }
  /** 新增聊天。 @param body 聊天設定。 @returns 新聊天。 */
  @Post('sessions') createSession(@Body() body: unknown) { return this.workspace.createSession(body); }
  /** 讀取聊天。 @param id 聊天 ID。 @returns 聊天內容。 */
  @Get('sessions/:id') session(@Param('id') id: string) { return this.workspace.session(id); }
  /** 修改聊天設定。 @param id 聊天 ID。 @param body 新設定。 @returns 聊天。 */
  @Patch('sessions/:id') updateSession(@Param('id') id: string, @Body() body: unknown) { return this.workspace.updateSession({ id, value: body }); }
  /** 送出持久任務。 @param id 聊天 ID。 @param body 任務內容。 @returns job。 */
  @Post('sessions/:id/messages') message(@Param('id') id: string, @Body() body: unknown) { return this.workspace.enqueue({ sessionId: id, value: body }); }
  /** 列出工作。 @returns 工作列表。 */
  @Get('usage/dashboard') usageDashboard() { return this.workspace.usageDashboard(); }
  @Get('jobs') jobs() { return this.workspace.jobs(); }
  /** 取得擁有者可查看的歷次模型與用量快照。 */
  @Get('executions') executions() { return this.workspace.executions(); }
  /** 本機資料夾僅能連到已驗證的聊天。 */
  @Get('sessions/:id/local-folders') async localFolders(@Param('id') id: string) { await this.workspace.session(id); return localFiles({ method: 'connections', input: { sessionId: id } }); }
  @Post('sessions/:id/local-folders') async connectFolder(@Param('id') id: string, @Body() body: unknown) {
    await this.workspace.session(id);
    const { session } = await this.workspace.session(id);
    if (session.threadId && !session.localFilesEnabled) throw new BadRequestException('此舊聊天尚未註冊本機工具，請新增聊天後連接資料夾');
    const input = parse({ schema: z.object({ mode: z.enum(['read','readwrite']), path: z.string().min(1).max(2000).optional() }).strict(), value: body });
    return localFiles({ method: input.path ? 'connect' : 'pick', input: { ...input, sessionId: id } });
  }
  @Post('sessions/:id/local-folders/:folderId/disconnect') async disconnectFolder(@Param('id') id: string, @Param('folderId') folderId: string) { await this.workspace.session(id); parse({schema:identifier,value:folderId}); return localFiles({ method: 'disconnect', input: { sessionId: id, connectionId: folderId } }); }
  @Get('sessions/:id/local-folders/:folderId/entries') async localFolderEntries(@Param('id') id: string, @Param('folderId') folderId: string, @Query('path') path = '') { await this.workspace.session(id); parse({schema:identifier,value:folderId}); if(typeof path!=='string'||path.length>1000)throw new BadRequestException('無效路徑');return localFiles({ method: 'list', input: { sessionId: id, connectionId: folderId, path } }); }
  @Get('sessions/:id/local-plans') async localPlans(@Param('id') id: string) { await this.workspace.session(id); return localFiles({ method: 'plans', input: { sessionId: id } }); }
  @Post('sessions/:id/local-plans/:planId/apply') async applyLocalPlan(@Param('id') id: string, @Param('planId') planId: string) { await this.workspace.session(id); parse({schema:identifier,value:planId}); return localFiles({ method: 'apply', input: { sessionId: id, planId } }); }
  @Post('sessions/:id/local-plans/:planId/reject') async rejectLocalPlan(@Param('id') id: string, @Param('planId') planId: string) { await this.workspace.session(id); parse({schema:identifier,value:planId}); return localFiles({ method: 'reject', input: { sessionId: id, planId } }); }
  /** 取消工作。 @param id 工作 ID。 @returns 更新工作。 */
  @Post('jobs/:id/cancel') cancel(@Param('id') id: string) { return this.workspace.cancel(id); }
  /** 列出功能 prompt。 @returns 功能列表。 */
  @Get('features') features() { return this.workspace.features(); }
  /** 新增功能 prompt。 @param body 功能內容。 @returns 功能。 */
  @Post('features') createFeature(@Body() body: unknown) { return this.workspace.saveFeature({ value: body }); }
  /** 修改功能 prompt。 @param id 功能 ID。 @param body 功能內容。 @returns 功能。 */
  @Patch('features/:id') updateFeature(@Param('id') id: string, @Body() body: unknown) { return this.workspace.saveFeature({ id, value: body }); }
  /** 列出自然語言建立的排程。 @returns 排程列表。 */
  @Get('schedules') schedules() { return this.workspace.schedules(); }
  /** 手動建立待確認排程，與聊天工具共用驗證。 @param id 聊天 ID。 @param body 排程設定。 @returns 提案。 */
  @Post('sessions/:id/schedules') propose(@Param('id') id: string, @Body() body: unknown) { return this.workspace.proposeSchedule({ sessionId: id, value: body }); }
  /** 確認或暫停排程。 @param id 排程 ID。 @param body 狀態。 @returns 排程。 */
  @Patch('schedules/:id') schedule(@Param('id') id: string, @Body() body: unknown) { return this.workspace.setSchedule({ id, value: body }); }
  /** 讀取聊天附件的顯示資訊。 */
  @Get('attachments') async attachmentList(@Query('ids') ids: string) {
    const values = typeof ids === 'string' ? ids.split(',') : [];
    if (values.length > 10) throw new BadRequestException('附件數量超過限制');
    for (const value of values) parse({ schema: identifier, value });
    return Attachment.findAll({ where: { id: values } });
  }
  /** 十檔上限同時由 multipart parser 與業務層執行。 @param files 暫存上傳檔。 @returns 持久附件。 */
  @Post('attachments')
  @UseInterceptors(FilesInterceptor('files', 10, {
    limits: { fileSize: maxFileSize, files: 10, fields: 0, parts: 10 },
    storage: diskStorage({ destination: config.UPLOAD_DIR, filename: (_request, _file, callback) => callback(null, randomUUID() + '.upload') }),
    fileFilter: (_request, file, callback) => callback(extensions.has(extname(file.originalname).toLowerCase()) ? null : new BadRequestException('不支援此附件類型'), true),
  }))
  upload(@UploadedFiles() files: Express.Multer.File[]) { return saveAttachments(files ?? []); }
  /** 依擁有者權限提供附件預覽，Office 由隔離 runner 轉為 PDF。 */
  @Get('attachments/:id/preview') async preview(@Param('id') id: string, @Res() response: Response) {
    parse({ schema: identifier, value: id });
    const file = await Attachment.findByPk(id);
    if (!file) throw new BadRequestException('找不到附件');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(file.extension)) {
      const result = await rpc<{ pdf: string }>({ method: 'runner/preview', params: { id, extension: file.extension } });
      response.type('application/pdf').send(Buffer.from(result.pdf, 'base64')); return;
    }
    const types: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.csv': 'text/plain; charset=utf-8' };
    response.setHeader('Content-Type', types[file.extension] ?? 'application/octet-stream');
    response.sendFile(resolve(config.UPLOAD_DIR, id + file.extension), { dotfiles: 'allow' });
  }
  /** 列出已產出的工作區檔案。 @param id 聊天 ID。 @returns 檔案列表。 */
  @Get('sessions/:id/artifacts') async artifacts(@Param('id') id: string) { await this.workspace.session(id); return artifacts(id); }
  /** 原始碼及 Markdown 僅以 JSON 文字傳送，不直接執行。 */
  @Get('sessions/:id/content') async content(@Param('id') id: string, @Query('path') path: string) {
    await this.workspace.session(id);
    if (typeof path !== 'string' || path.length > 1000) throw new BadRequestException('無效檔案路徑');
    return artifactContent({ sessionId: id, relative: path });
  }
  /** 隔離的靜態 HTML 與相對資源預覽；禁止程式執行、表單及網路 API 存取。 */
  @Get('sessions/:id/preview/*path') async artifactPreview(@Param('id') id: string, @Param('path') segments: string[] | string, @Res() response: Response) {
    await this.workspace.session(id);
    const path = Array.isArray(segments) ? segments.join('/') : segments;
    if (typeof path !== 'string' || path.length > 1000) throw new BadRequestException('無效檔案路徑');
    const target = await artifactPath({ sessionId: id, relative: path });
    const types: Record<string, string> = { '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
    const type = types[extname(target).toLowerCase()];
    if (!type) throw new BadRequestException('此類型請使用原始碼預覽或下載');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-same-origin");
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.type(type).sendFile(target, { dotfiles: 'allow' });
  }
  /** 僅讀取此聊天的 Codex 產生圖片。 */
  @Get('sessions/:id/images') async generatedImages(@Param('id') id: string) {
    const { session } = await this.workspace.session(id);
    return session.threadId ? rpc({ method: 'runner/generatedImages', params: { threadId: session.threadId } }) : [];
  }
  @Get('sessions/:id/images/:imageId') async generatedImage(@Param('id') id: string, @Param('imageId') imageId: string, @Res() response: Response) {
    const { session } = await this.workspace.session(id);
    if (!session.threadId || !/^exec-[0-9a-f-]{36}\.png$/.test(imageId)) throw new BadRequestException('找不到圖片');
    const result = await rpc<{ image: string }>({ method: 'runner/generatedImage', params: { threadId: session.threadId, imageId } });
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.type('image/png').send(Buffer.from(result.image, 'base64'));
  }
  /** 以附件下載模式提供產出，禁止把 agent 產生的 HTML 當作本機應用執行。 @param id 聊天 ID。 @param path 相對路徑。 @param response HTTP 回應。 @returns 檔案傳輸。 */
  @Get('sessions/:id/download') async download(@Param('id') id: string, @Query('path') path: string, @Res() response: Response) {
    await this.workspace.session(id);
    if (typeof path !== 'string' || path.length > 1000) throw new BadRequestException('無效檔案路徑');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const target = await artifactPath({ sessionId: id, relative: path });
    response.download(target, basename(target), { dotfiles: 'allow' });
  }
  /** SSE 僅供即時顯示；斷線後 SWR 會重新讀取已保存訊息。 @returns 事件與心跳。 */
  @Sse('events') events() { return merge(this.workspace.events, interval(15_000).pipe(map(() => ({ data: { type: 'heartbeat' } })))); }
}
