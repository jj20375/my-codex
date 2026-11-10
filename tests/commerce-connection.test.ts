/** @file 連線授權密文、URL 邊界、無導向及持久送出標記的驗證，不接觸正式服務。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('連線與傳送邊界', async (t) => {
  process.env.DB_PASSWORD ??= 'test-only';
  process.env.ADMIN_PASSWORD ??= 'test-password-long';
  process.env.SESSION_SECRET ??= 's'.repeat(64);
  process.env.RUNNER_SECRET ??= 'r'.repeat(64);
  const directory = await mkdtemp(join(tmpdir(), 'commerce-connection-'));
  process.env.DATA_DIR = directory;
  const {
    connectionUrl,
    sealConnection,
    openConnection,
    remoteRequest,
    mediaTarget,
    claimDelivery,
    readRecord,
    writeRecord,
  } = await import('../apps/api/src/commerce-connection');
  await t.test('遠端憑證經驗證密文保存，不能跨服務解密', () => {
    const value = {
      id: 'connection',
      baseUrl: 'http://localhost:5037/api',
      token: 'private-jwt-value',
      scopeId: 6,
    };
    const sealed = sealConnection({ value, secret: 'secret', provider: 'cobuy' });
    assert.ok(!sealed.includes(value.token));
    assert.deepEqual(openConnection({ value: sealed, secret: 'secret', provider: 'cobuy' }), value);
    assert.throws(() => openConnection({ value: sealed, secret: 'secret', provider: 'socai' }));
    assert.throws(() => openConnection({ value: sealed, secret: 'other', provider: 'cobuy' }));
  });
  await t.test('拒絕 URL 帳密、query、metadata 及遠端明文 HTTP；媒體不可換來源', () => {
    for (const url of [
      'http://example.com/api',
      'https://user:password@example.com/api',
      'https://example.com/api?token=x',
      'http://169.254.169.254/',
      'file:///etc/passwd',
    ])
      assert.throws(() => connectionUrl(url));
    assert.equal(
      connectionUrl('http://host.docker.internal:5037/api/'),
      'http://host.docker.internal:5037/api',
    );
    const connection = {
      id: 'x',
      baseUrl: 'http://localhost:5037/api',
      mediaUrl: 'http://host.docker.internal:5038',
      scopeId: 6,
      token: 'test',
    };
    assert.equal(
      mediaTarget({ connection, url: 'http://localhost:5038/objects?token=signed' }).hostname,
      'host.docker.internal',
    );
    assert.throws(() => mediaTarget({ connection, url: 'http://attacker.example/objects?token=signed' }));
  });
  await t.test('API 固定路徑、拒絕重新導向，JSON 與 FormData 使用正確 header', async () => {
    const original = globalThis.fetch;
    const connection = { id: 'x', baseUrl: 'http://localhost:5037/api', scopeId: 6, token: 'not-output' };
    const seen: RequestInit[] = [];
    globalThis.fetch = async (_url, init) => {
      seen.push(init!);
      return Response.json({ data: { success: true } });
    };
    try {
      await remoteRequest({ connection, path: '/auth/profile' });
      const form = new FormData();
      form.append('file', new Blob(['image']), 'image.png');
      await remoteRequest({ connection, path: '/media', method: 'POST', body: form });
      assert.equal(seen[0].redirect, 'error');
      assert.equal((seen[0].headers as Record<string, string>).Authorization, 'Bearer not-output');
      assert.equal((seen[1].headers as Record<string, string>)['Content-Type'], undefined);
      await assert.rejects(() => remoteRequest({ connection, path: '//attacker.example/api' }));
      await assert.rejects(() => remoteRequest({ connection, path: '/../private' }));
    } finally {
      globalThis.fetch = original;
    }
  });
  await t.test('送出標記跨重讀保留，並行只有一個成功取得，無憑證明文', async () => {
    try {
      const results = await Promise.allSettled([
        claimDelivery('delivery-test'),
        claimDelivery('delivery-test'),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((await readRecord<{ state: string }>('delivery-test'))?.state, 'sending');
      await writeRecord({ key: 'delivery-test', value: { state: 'complete', postId: 123 } });
      assert.equal((await readRecord<{ postId: number }>('delivery-test'))?.postId, 123);
      assert.ok(
        !(await readFile(join(directory, 'commerce-connections/delivery-test.json'), 'utf8')).includes(
          'token',
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
