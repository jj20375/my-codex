/** @file 系統連線、遠端商品挑選與明確確認的送出操作；只經本機 API，不在瀏覽器保存遠端 JWT。 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { api } from './api';
const root = '/commerce/connected';
interface Connection {
  /** 系統。 */ provider: string;
  /** 連線身分。 */ id?: string;
  /** 是否已設定。 */ connected: boolean;
  /** API 位址。 */ baseUrl?: string;
  /** 媒體位址。 */ mediaUrl?: string;
  /** 店別或工作區。 */ scopeId?: number;
}
/** 獨立連線設定路由，首次授權之後日常操作集中在商品內容工作台。 */
export default function ConnectionSettings() {
  const { data, error, mutate } = useSWR<Connection[]>(root + '/connections', api);
  return (
    <section className="management commerce-page">
      <header className="commerce-heading">
        <div>
          <div className="eyebrow">CONNECTED COMMERCE</div>
          <h1>連接你的電商與社群。</h1>
          <p>設定後，直接在工作台讀取商品、更新內容與建立社群草稿。</p>
        </div>
        <Link to="/commerce/products">回商品列表</Link>
      </header>
      {error && <p role="alert">{error.message}</p>}
      <p className="form-hint">
        使用各系統目前登入的 JWT 授權，與 Codex
        訂閱登入分開。憑證只以密文保存在本機後端，過期時需重新連線。Docker 內連接主機服務，請使用
        host.docker.internal。
      </p>
      {data?.map((connection) => (
        <ConnectionForm
          key={connection.provider + '-' + connection.connected + '-' + connection.baseUrl}
          value={connection}
          refresh={async () => {
            await mutate();
          }}
        />
      ))}
    </section>
  );
}
/** 密碼欄位僅保留本次輸入，成功連線後立即清空。 */
function ConnectionForm({
  value,
  refresh,
}: {
  /** 連線摘要。 */ value: Connection;
  /** 重載摘要。 */ refresh: () => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(value.baseUrl ?? '');
  const [mediaUrl, setMediaUrl] = useState(value.mediaUrl ?? '');
  const [scopeId, setScopeId] = useState(String(value.scopeId ?? ''));
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(event: { preventDefault(): void }) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api(root + '/connections/' + value.provider, {
        method: 'PUT',
        body: JSON.stringify({
          baseUrl,
          token,
          scopeId: Number(scopeId),
          ...(value.provider === 'cobuy' ? { mediaUrl } : {}),
        }),
      });
      setToken('');
      await refresh();
      setMessage('已驗證並保存連線');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '連線失敗');
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await api(root + '/connections/' + value.provider, { method: 'DELETE' });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '解除失敗');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="commerce-card commerce-form" onSubmit={(event) => void save(event)}>
      <h2>
        {value.provider === 'cobuy' ? 'coBuy 商品管理' : 'SocAI 社群管理'} ·{' '}
        {value.connected ? '已設定' : '尚未連線'}
      </h2>
      <label>
        API 位址
        <input
          type="url"
          required
          maxLength={1000}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://host.docker.internal:服務連接埠/api"
        />
      </label>
      {value.provider === 'cobuy' && (
        <label>
          媒體服務位址
          <input
            type="url"
            required
            value={mediaUrl}
            onChange={(event) => setMediaUrl(event.target.value)}
            placeholder="http://host.docker.internal:媒體連接埠"
          />
        </label>
      )}
      <label>
        {value.provider === 'cobuy' ? '店家 ID' : '工作區 ID'}
        <input
          type="number"
          required
          min="1"
          value={scopeId}
          onChange={(event) => setScopeId(event.target.value)}
        />
      </label>
      <label>
        登入授權 JWT
        <input
          type="password"
          required
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="貼上此系統目前登入的 JWT"
        />
      </label>
      <p className="form-hint">重新設定會驗證帳號權限。服務需已啟動，並允許本機後端連入。</p>
      <button className="primary-button" disabled={busy}>
        驗證並保存連線
      </button>
      {value.connected && (
        <button type="button" className="text-button" disabled={busy} onClick={() => void disconnect()}>
          解除連線
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
/** 商品清單來自遠端 API，讀入後直接開啟本機草稿，保留原來源識別。 */
export function ConnectedProductPicker() {
  const navigate = useNavigate();
  const { data: connections = [] } = useSWR<Connection[]>(root + '/connections', api);
  const enabled = connections.some((row) => row.provider === 'cobuy' && row.connected);
  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [includeImages, setIncludeImages] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { data, error } = useSWR<{
    connectionId: string;
    count: number;
    rows: Array<{ id: number; name: string; price: number }>;
  }>(enabled ? `${root}/cobuy/products?keyword=${encodeURIComponent(keyword)}&page=${page}` : null, api);
  async function select(commodityId: number) {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ productId: string }>(root + '/cobuy/import', {
        method: 'POST',
        body: JSON.stringify({ connectionId: data?.connectionId, commodityId, refresh, includeImages }),
      });
      navigate(`/commerce/products/${result.productId}/content`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '讀取失敗');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="commerce-card">
      <h2>直接從 coBuy 選商品</h2>
      <Link className="text-button" to="/commerce/connections">
        系統連線設定 →
      </Link>
      {enabled ? (
        <>
          <form
            className="commerce-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              setKeyword(search);
              setPage(1);
            }}
          >
            <label>
              搜尋商品
              <input value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <button className="text-button">搜尋</button>
          </form>
          <label>
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(event) => setIncludeImages(event.target.checked)}
            />
            一併讀取已核定商品圖片
          </label>
          <label>
            <input type="checkbox" checked={refresh} onChange={(event) => setRefresh(event.target.checked)} />
            更新既有商品的來源資料與版本（保留草稿）
          </label>
          {data?.rows.map((row) => (
            <article className="commerce-order" key={row.id}>
              <span>
                #{row.id}　{row.name}　NT${row.price}
              </span>
              <button className="text-button" disabled={busy} onClick={() => void select(row.id)}>
                讀入工作台
              </button>
            </article>
          ))}
          {data && !data.rows.length && <p>此頁沒有可管理的商品。</p>}
          <button className="text-button" disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>
            上一頁
          </button>
          <span>第 {page} 頁</span>
          <button
            className="text-button"
            disabled={busy || !data || page * 20 >= data.count}
            onClick={() => setPage(page + 1)}
          >
            下一頁
          </button>
        </>
      ) : (
        <p>連接 coBuy 後，可直接選商品與圖片。</p>
      )}
      {(error || message) && <p role="alert">{message || error.message}</p>}
    </div>
  );
}
interface DeliveryProps {
  /** 本機商品。 */ productId: string;
  /** 已保存版本。 */ revision: number;
  /** 明確勾選的商品圖片。 */ images: Array<{ id: string; alt: string }>;
  /** 有未保存修改時禁止送出。 */ disabled: boolean;
  /** 當前內容。 */ content: Record<string, string | string[]>;
  /** 更新後重新讀取來源。 */ refresh: () => Promise<void>;
}
const fieldLabels = {
  title: '商品名稱',
  summary: '商品簡介',
  description: '商品詳情',
  seoTitle: 'SEO 標題',
  seoDescription: 'SEO 描述',
  images: '以選定圖片取代商品圖集',
};
/** 同一頁先看差異再選欄套用；社群先確認平台、文案與帳號再建立草稿。 */
export function ConnectedDelivery(props: DeliveryProps) {
  const [preview, setPreview] = useState<{
    before: Record<string, string>;
    after: Record<string, string>;
    commodityId: number;
    tenantId: number;
  } | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [fields, setFields] = useState<string[]>(['summary', 'description', 'seoTitle', 'seoDescription']);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [platform, setPlatform] = useState('facebook');
  const [selected, setSelected] = useState<number[]>([]);
  const [target, setTarget] = useState('');
  const { data: connections = [] } = useSWR<Connection[]>(root + '/connections', api);
  const socialConnected = connections.some((row) => row.provider === 'socai' && row.connected);
  const { data: accounts = [], error } = useSWR<
    Array<{ id: number; name: string; platform: string; connectionId: string }>
  >(socialConnected ? root + '/socai/accounts' : null, api);
  const snapshotKey = JSON.stringify([props.revision, props.images]);
  const path = root + '/products/' + props.productId;
  const selection = { revision: props.revision, images: props.images };
  async function action(kind: 'preview' | 'apply' | 'social-draft') {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<Record<string, unknown>>(path + '/' + kind, {
        method: 'POST',
        body: JSON.stringify({
          ...selection,
          ...(kind === 'apply'
            ? { fields: fields.filter((field) => field !== 'images' || props.images.length > 0) }
            : {}),
          ...(kind === 'social-draft' ? { platform, accountIds: selected, connectionId: target } : {}),
        }),
      });
      if (kind === 'preview') {
        setPreview(result as unknown as typeof preview);
        setPreviewKey(snapshotKey);
      } else if (kind === 'apply') {
        setPreview(null);
        setMessage(
          result.sourceRefreshed
            ? 'coBuy 已更新，來源版本已同步'
            : 'coBuy 已更新；來源讀回失敗，請重新讀取來源後再操作',
        );
        await props.refresh();
      } else
        setMessage(
          `SocAI 草稿 #${result.postId} ${result.reused ? '已存在，未重複建立' : '已建立'}，可至 SocAI 審核與排程`,
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="commerce-card commerce-form connected-delivery">
      <h2>送到商城與社群</h2>
      <Link to="/commerce/connections">系統連線設定 →</Link>
      <p>
        本次採用已保存版本 {props.revision}，以及左側明確勾選的 {props.images.length} 張商品圖。
      </p>
      {props.disabled && <p>請先儲存草稿，才能預覽或送出。</p>}
      <button
        className="text-button"
        disabled={
          busy || props.disabled || !connections.some((row) => row.provider === 'cobuy' && row.connected)
        }
        onClick={() => void action('preview')}
      >
        預覽 coBuy 更新差異
      </button>
      {preview && previewKey === snapshotKey && (
        <div>
          <p>
            目標：coBuy 店家 #{preview.tenantId}／商品 #{preview.commodityId}
          </p>
          {Object.entries(fieldLabels)
            .filter(([field]) => field !== 'images' || props.images.length > 0)
            .map(([field, label]) => (
              <div key={field}>
                <label>
                  <input
                    type="checkbox"
                    checked={fields.includes(field)}
                    onChange={(event) =>
                      setFields(
                        event.target.checked ? [...fields, field] : fields.filter((value) => value !== field),
                      )
                    }
                  />
                  {label}
                </label>
                {field !== 'images' && (
                  <details>
                    <summary>查看原值與建議值</summary>
                    <p className="content-facts">原值：{preview.before[field] || '（空白）'}</p>
                    <p className="content-facts">建議：{preview.after[field] || '（空白）'}</p>
                  </details>
                )}
              </div>
            ))}
          <button
            className="primary-button"
            disabled={busy || props.disabled || !fields.length}
            onClick={() => void action('apply')}
          >
            確認套用勾選欄位到 coBuy
          </button>
        </div>
      )}
      <h3>建立 SocAI 草稿</h3>
      <label>
        文案平台
        <select
          value={platform}
          onChange={(event) => {
            setPlatform(event.target.value);
            setSelected([]);
          }}
        >
          <option value="facebook">Facebook</option>
          <option value="instagram">Instagram</option>
          <option value="threads">Threads</option>
        </select>
      </label>
      <p className="content-facts">{props.content[platform] || '此平台尚無文案'}</p>
      {accounts
        .filter((row) => row.platform === (platform === 'facebook' ? 'facebook_page' : platform))
        .map((row) => (
          <label key={row.id}>
            <input
              type="checkbox"
              checked={target === row.connectionId && selected.includes(row.id)}
              onChange={(event) => {
                setSelected(
                  target !== row.connectionId
                    ? event.target.checked
                      ? [row.id]
                      : []
                    : event.target.checked
                      ? [...selected, row.id]
                      : selected.filter((id) => id !== row.id),
                );
                setTarget(row.connectionId);
              }}
            />
            {row.name}
          </label>
        ))}
      {socialConnected && !accounts.length && <p>目前沒有可用社群帳號，請至 SocAI 完成帳號綁定。</p>}
      {error && <p role="alert">{error.message}</p>}
      <button
        className="primary-button"
        disabled={
          busy ||
          props.disabled ||
          !selected.length ||
          target !== accounts[0]?.connectionId ||
          !props.content[platform]
        }
        onClick={() => void action('social-draft')}
      >
        確認文案與帳號，建立 SocAI 草稿
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
