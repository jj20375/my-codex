/** @file 本機擁有者登入；使用簽章 HttpOnly cookie、固定時間密碼比較及同來源寫入驗證。 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from './config';
/** Cookie 只含到期時刻及 HMAC，不包含任何 Codex 或資料庫憑證。 @param expires 到期毫秒。 @returns 簽章 token。 */
export function sessionToken(expires: number): string {
  return `${expires}.${createHmac('sha256', config.SESSION_SECRET).update(String(expires)).digest('hex')}`;
}
/** 以相同長度的雜湊比較秘密字串。 @param input 待比較字串。 @returns 是否相等。 */
export function sameSecret({ supplied, expected }: { supplied: string; expected: string }): boolean {
  return timingSafeEqual(createHmac('sha256', config.SESSION_SECRET).update(supplied).digest(), createHmac('sha256', config.SESSION_SECRET).update(expected).digest());
}
/** 僅接受有效且未過期的本機登入 cookie。 @param request Express 請求。 @returns 登入是否有效。 */
export function authenticated(request: Request): boolean {
  /** 不信任 cookie-parser 解析出來的非字串值。 */
  const token: unknown = request.cookies?.workspace;
  if (typeof token !== 'string') return false;
  /** 到期時間必須為有限數字，且不能超出一次登入的有效期間。 */
  const expires = Number(token.split('.')[0]);
  return Number.isFinite(expires) && expires > Date.now() && expires <= Date.now() + 7 * 86400_000 && sameSecret({ supplied: token, expected: sessionToken(expires) });
}
@Injectable()
export class OwnerGuard implements CanActivate {
  /** 所有業務路由共享擁有者檢查與 CSRF 防護。 @param context Nest 請求上下文。 @returns true。 */
  canActivate(context: ExecutionContext) {
    /** 路由只使用單一安裝擁有者，不建立多租戶共用登入。 */
    const request = context.switchToHttp().getRequest<Request>();
    if (!authenticated(request)) throw new UnauthorizedException('請先登入此工作空間');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) verifyWrite(request);
    return true;
  }
}
/** 即使未登入的登入端點，也要求同來源與自訂 header 防止跨站表單請求。 @param request Express 請求。 @returns 無。 */
export function verifyWrite(request: Request) {
  if (request.headers['x-workspace-client'] !== 'web' || request.headers.origin && request.headers.origin !== config.WEB_ORIGIN) throw new ForbiddenException('請由本機工作空間操作');
}
