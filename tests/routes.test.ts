/** @file 檢查公開頁、管理頁與 session 深層網址的路由配對。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoutes } from 'react-router-dom';
import { routes, managementViews, sessionPath } from '../apps/web/src/components/routes';
const config = [{ path: routes.login }, { path: routes.chat }, { path: routes.session },{path:routes.content}, ...managementViews.map(name => ({ path: routes[name] })), ...['commerce','connections','products','campaigns','orders'].map(name=>({path:routes[name as keyof typeof routes]}))];
test('所有管理頁與登入頁可獨立配對', () => {
  for (const name of ['login', ...managementViews] as const) assert.equal(matchRoutes(config, routes[name])?.[0].route.path, routes[name]);
});
test('session 深層網址保留識別碼', () => {
  const id = '7b3a75a4-0787-48c1-821b-61729c7e2238';
  const matched = matchRoutes(config, sessionPath(id));
  assert.equal(matched?.[0].route.path, routes.session);
  assert.equal(matched?.[0].params.sessionId, id);
});
test('未知路由不會誤認為聊天頁', () => assert.equal(matchRoutes(config, '/unknown-page'), null));

test('電商總覽、商品、活動及訂單各自有路由',()=>{for(const name of ['commerce','connections','products','campaigns','orders'] as const)assert.equal(matchRoutes(config,routes[name])?.[0].route.path,routes[name]);});

test('商品內容工作台支援深層網址',()=>assert.equal(matchRoutes(config,'/commerce/products/product-123/content')?.[0].params.productId,'product-123'));
