import type { ModelConfigWithKey, ModelPricing } from '@media-agent/shared';
import { forwardRef, useImperativeHandle, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';

const MOCK_URL = 'http://127.0.0.1:3799/v1';

export type ModelFormErrors = Partial<Record<'name' | 'model' | 'url' | 'key', string>>;

export type ModelFormHandle = {
  // 密钥框里打了字还没按回车：保存前先存上，返回存上之后的配置
  storeKey: () => ModelConfigWithKey;
  hasTypedKey: () => boolean;
};

type Props = {
  value: ModelConfigWithKey;
  onChange: (next: ModelConfigWithKey) => void;
  errors?: ModelFormErrors;
  onClearError?: (field: keyof ModelFormErrors) => void;
  // 服务端按存好的配置测试，测之前先把这套存下来
  beforeTest: (config: ModelConfigWithKey) => Promise<void>;
};

export const isPriced = (p: ModelPricing) => !!(p.input || p.output || p.cached);

export const priceSummary = (p: ModelPricing) => `${p.currency}${p.input} / ${p.currency}${p.output} / ${p.currency}${p.cached}`;

// 密钥只能录入：存好就清空输入框，只显示「已配置」
export const ModelForm = forwardRef<ModelFormHandle, Props>(function ModelForm({ value, onChange, errors = {}, onClearError, beforeTest }, ref) {
  const [typedKey, setTypedKey] = useState('');
  const [longSide, setLongSide] = useState(String(value.imageLongSide));
  // 数字框按打出来的字存着，不然打「0.」时会被改回空
  const [prices, setPrices] = useState(() => ({
    input: value.pricing.input ? String(value.pricing.input) : '',
    output: value.pricing.output ? String(value.pricing.output) : '',
    cached: value.pricing.cached ? String(value.pricing.cached) : '',
  }));
  const [priceOpen] = useState(isPriced(value.pricing));
  const [result, setResult] = useState<ReactNode>(null);
  const keySet = !!value.apiKey;
  const p = value.pricing;

  const change = (patch: Partial<ModelConfigWithKey>) => onChange({ ...value, ...patch });
  const setPrice = (patch: Partial<ModelPricing>) => change({ pricing: { ...p, ...patch } });

  const storeKey = () => {
    if (!typedKey) return value;
    const next = { ...value, apiKey: typedKey };
    setTypedKey('');
    onChange(next);
    onClearError?.('key');
    toast(keySet ? '密钥已替换' : '密钥已存到这台电脑');
    return next;
  };

  useImperativeHandle(ref, () => ({ storeKey, hasTypedKey: () => !!typedKey }));

  const test = async () => {
    if (!/^https?:\/\//.test(value.baseUrl)) {
      setResult(<><span className="tag tag-danger"><Icon name="x" />连不上</span> 接口地址要以 http:// 或 https:// 开头</>);
      return;
    }
    if (!keySet && !typedKey) {
      setResult(<span className="tag tag-danger"><Icon name="x" />还没填密钥</span>);
      return;
    }
    const config = storeKey();
    setResult(<><span className="spinner" /> 正在连接…</>);
    try {
      await beforeTest(config);
      const started = performance.now();
      const res = await api<{ ok: boolean; error?: string }>('/llm/test', { method: 'POST', body: { modelConfigId: config.id } });
      const ms = Math.round(performance.now() - started);
      if (!res.ok) {
        setResult(<><span className="tag tag-danger"><Icon name="x" />连不上</span> {res.error}</>);
      } else if (config.baseUrl === MOCK_URL) {
        setResult(<><span className="tag tag-ok"><Icon name="check" />连得上</span> 本地假模型 · <span className="mono">{ms} ms</span></>);
      } else {
        setResult(<><span className="tag tag-ok"><Icon name="check" />连得上</span> 找到模型 <span className="mono">{config.model || '（没填模型名）'}</span> · <span className="mono">{ms} ms</span></>);
      }
    } catch (err) {
      setResult(<><span className="tag tag-danger"><Icon name="x" />连不上</span> {(err as Error).message}</>);
    }
  };

  const field = (name: keyof ModelFormErrors) => ({
    className: errors[name] ? ' is-error' : '',
    hint: <p className="hint is-error" data-err={name} hidden={!errors[name]}>{errors[name]}</p>,
  });
  const clear = (name: keyof ModelFormErrors) => errors[name] && onClearError?.(name);

  return (
    <>
      <div className="mf-grid">
        <div className="field">
          <label htmlFor="mf-name">名字</label>
          <input
            className={`input${field('name').className}`}
            id="mf-name"
            value={value.name}
            placeholder="比如：主力"
            autoComplete="off"
            onChange={(e) => {
              clear('name');
              change({ name: e.target.value });
            }}
          />
          {field('name').hint}
        </div>
        <div className="field">
          <label htmlFor="mf-model">模型名</label>
          <input
            className={`input mono${field('model').className}`}
            id="mf-model"
            value={value.model}
            placeholder="接口认的模型名"
            autoComplete="off"
            onChange={(e) => {
              clear('model');
              change({ model: e.target.value });
            }}
          />
          {field('model').hint}
        </div>
        <div className="field mf-wide">
          <label htmlFor="mf-url">接口地址</label>
          <input
            className={`input mono${field('url').className}`}
            id="mf-url"
            value={value.baseUrl}
            placeholder="https://…/v1"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              clear('url');
              change({ baseUrl: e.target.value });
            }}
          />
          {field('url').hint}
          <p className="hint">
            OpenAI 兼容的接口。不想花钱调真模型，可以先跑假模型，
            <button
              type="button"
              className="linkish"
              data-mock
              onClick={() => {
                clear('url');
                change({ baseUrl: MOCK_URL, model: value.model || 'mock-llm' });
                toast('填好了。记得另开一个终端跑 npm run mock-llm');
              }}
            >
              填本地假模型的地址
            </button>
            。
          </p>
        </div>
        <div className="field mf-wide" data-od-id="field-api-key">
          <label htmlFor="mf-key">密钥</label>
          <div className="mf-keystate" id="mf-keystate">
            {keySet ? (
              <>
                <span className="tag tag-ok"><Icon name="check" />已配置</span>
                <span className="meta">存在这台电脑上</span>
              </>
            ) : (
              <span className="tag tag-warn">还没配置</span>
            )}
          </div>
          <input
            className={`input mono${field('key').className}`}
            id="mf-key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={typedKey}
            placeholder={keySet ? '输入新密钥可以替换，按回车存好' : '粘贴密钥，按回车存好'}
            onChange={(e) => {
              clear('key');
              setTypedKey(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              e.currentTarget.blur();
            }}
            onBlur={() => storeKey()}
          />
          {field('key').hint}
          <p className="hint">只存在这台电脑上，不进工作文件夹，另一台电脑要各填一次。存好后输入框会清空，不再显示。</p>
        </div>
        <div className="field">
          <label htmlFor="mf-long">发给模型的图片长边</label>
          <div className="input-group">
            <input
              className="input mono"
              id="mf-long"
              type="number"
              min={512}
              max={4096}
              step={100}
              value={longSide}
              onChange={(e) => {
                setLongSide(e.target.value);
                change({ imageLongSide: Math.round(Number(e.target.value)) || 1600 });
              }}
            />
            <span className="mf-unit">像素</span>
          </div>
          <p className="hint">另做一份小图发给 AI 看，越大看得越清楚，费用越高。不影响传给 H3 的图。</p>
        </div>
      </div>
      <details className="mf-price" open={priceOpen}>
        <summary>
          <span><Icon name="chev-down" className="icon-sm chev" /></span>价格（可选）
          <span className="meta">{isPriced(p) ? priceSummary(p) : '没填就不显示花了多少钱'}</span>
        </summary>
        <div className="mf-price-body">
          <div className="field">
            <span className="label">币种</span>
            <div className="seg" id="mf-cur">
              {(['¥', '$'] as const).map((currency) => (
                <button key={currency} type="button" aria-pressed={p.currency === currency} onClick={() => setPrice({ currency })}>
                  {currency}
                </button>
              ))}
            </div>
          </div>
          {(
            [
              ['mf-pin', '输入价', 'input'],
              ['mf-pout', '输出价', 'output'],
              ['mf-pcache', '缓存命中价', 'cached'],
            ] as const
          ).map(([id, label, key]) => (
            <div className="field" key={id}>
              <label htmlFor={id}>{label}</label>
              <input
                className="input mono"
                id={id}
                type="number"
                min={0}
                step={0.01}
                placeholder="0"
                value={prices[key]}
                onChange={(e) => {
                  setPrices({ ...prices, [key]: e.target.value });
                  setPrice({ [key]: Number(e.target.value) || 0 });
                }}
              />
            </div>
          ))}
          <p className="hint mf-wide">都按每百万 tokens 填，留空当 0。命中缓存的输入按缓存价算，其余输入按输入价，输出按输出价。</p>
        </div>
      </details>
      <div className="mf-test">
        <button type="button" className="btn btn-secondary" id="mf-test" data-od-id="btn-test-connection" onClick={() => void test()}>
          <span><Icon name="plug" /></span>测试连接
        </button>
        <span className="mf-result" id="mf-result" role="status">{result}</span>
      </div>
    </>
  );
});
