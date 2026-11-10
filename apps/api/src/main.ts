/** @file 啟動 NestJS 本機控制服務；使用安全 header、登入限速與受限 cookie API。 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { config } from './config';
import { WorkspaceService } from './workspace.service';
import { AuthController, WorkspaceController } from './controller';
import { OwnerGuard } from './auth';
import { CommerceController } from './commerce';
import { ContentExchangeController } from './content-exchange';
import { ContentController } from './content-controller';
import { ConnectedCommerceController } from './commerce-connected.controller';

@Module({ controllers: [AuthController, WorkspaceController, CommerceController, ContentController, ContentExchangeController, ConnectedCommerceController], providers: [WorkspaceService, OwnerGuard] })
class AppModule {}
/** 入口只啟動單一 API 副本，worker 由同一 Nest 生命週期管理。 @returns 啟動完成。 */
async function bootstrap() {
  /** 明確關閉預設 parser，以固定 JSON 上限避免無界記憶體使用。 */
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(helmet());
  app.use(json({ limit: '512kb' }));
  app.use(cookieParser());
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: '登入嘗試過多，請稍後重試' } }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: '請求過於頻繁，請稍後重試' } }));
  app.enableShutdownHooks();
  await app.listen(config.API_PORT, config.API_HOST);
}
bootstrap().catch(() => { console.error('API 啟動失敗，請確認環境設定、migration 與資料庫連線。'); process.exitCode = 1; });
