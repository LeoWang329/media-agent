import { useEffect, useState } from 'react';
import { api } from '../api';
import { copyText } from '../ui/copy';
import { Dialog } from '../ui/Dialog';
import { dayTime } from '../ui/format';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';
import { useOverlays } from './overlays';

const close = () => useOverlays.setState({ sys: null });

// 发这条消息时用的系统提示词原文
export function SysPromptDialog() {
  const sys = useOverlays((s) => s.sys);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!sys) return;
    setText('');
    api<{ text: string }>(`/prompts/${encodeURIComponent(sys.name)}/history/${sys.hash}`).then(
      (snapshot) => setText(snapshot.text),
      (err: Error) => toast(err.message, { tone: 'danger' }),
    );
  }, [sys]);

  if (!sys) return null;
  return (
    <Dialog style={{ width: 'min(720px, calc(100vw - 32px))' }} label="系统提示词原文" odId="dialog-system-prompt-snapshot" onClose={close}>
      <div className="dialog-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id="sysTitle">
            {sys.name} · {dayTime(sys.at)} 发送时
          </h2>
          <span className="meta">发这条消息时用的原文。之后在设置里改过，这里也不会变。</span>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dialog-body">
        <pre className="sys-pre" id="sysPre">
          {text}
        </pre>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-secondary" id="sysCopy" onClick={() => copyText(text, '已复制原文')}>
          <Icon name="copy" />
          复制原文
        </button>
        <button type="button" className="btn btn-primary" onClick={close}>
          关闭
        </button>
      </div>
    </Dialog>
  );
}
