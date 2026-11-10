/** @file 將工作區文字以安全的 React 節點呈現語法高亮，未知語言與大檔案退回原始文字。 */
import { useMemo, type ReactNode } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';

/** 副檔名只用於選擇已載入的語言，不執行檔案內容。 */
const languages: Record<string, string> = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', json: 'json', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', astro: 'markup', css: 'css', sh: 'bash', bash: 'bash', sql: 'sql', yaml: 'yaml', yml: 'yaml', md: 'markdown', markdown: 'markdown' };
type Token = string | { /** Prism 語法類型。 */ type: string; /** 可包含巢狀標記。 */ content: Token | Token[] };
/** 使用 React 跳脫文字，避免把檔案內容作為 HTML 注入。 */
function renderToken(token: Token, index: number): ReactNode {
  if (typeof token === 'string') return token;
  return <span key={index} className={`token ${token.type}`}>{Array.isArray(token.content) ? token.content.map(renderToken) : renderToken(token.content, 0)}</span>;
}
/** 依副檔名顯示唯讀程式碼；超過 256 KB 時維持流暢的純文字顯示。 */
export default function CodePreview({ text, extension }: { /** 檔案文字。 */ text: string; /** 小寫副檔名。 */ extension: string }) {
  const language = languages[extension];
  const highlighted = useMemo(() => language && Prism.languages[language] && text.length <= 256 * 1024 ? (Prism.tokenize(text, Prism.languages[language]) as Token[]).map(renderToken) : text, [text, language]);
  return <pre className="artifact-source"><code>{highlighted}</code></pre>;
}
