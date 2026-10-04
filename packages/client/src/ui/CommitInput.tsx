import { useEffect, useState, type ComponentProps, type KeyboardEvent } from 'react';

type Parse = (text: string) => string | number | null;

// 打完（离开或者回车）才存的输入框：parse 不认的退回原来的；没变不存。多行的回车照常换行
export function CommitInput({ value, parse, onCommit, ...rest }: { value: string; parse: Parse; onCommit: (v: string | number) => void } & Omit<ComponentProps<'input'>, 'value' | 'onChange'>) {
  const field = useCommit(value, parse, onCommit);
  return (
    <input
      {...rest}
      {...field}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export function CommitTextarea({ value, parse, onCommit, ...rest }: { value: string; parse: Parse; onCommit: (v: string | number) => void } & Omit<ComponentProps<'textarea'>, 'value' | 'onChange'>) {
  return <textarea {...rest} {...useCommit(value, parse, onCommit)} />;
}

function useCommit(value: string, parse: Parse, onCommit: (v: string | number) => void) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return {
    value: text,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => {
      const parsed = parse(text);
      if (parsed === null) return setText(value);
      if (String(parsed) !== value) onCommit(parsed);
      else setText(value);
    },
  };
}

// 常用的几种：任意数字、不小于 min 的整数、不小于 min 的数、在 min 和 max 之间的数、去掉首尾空格的文字
const toNumber = (text: string) => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : null);
export const anyNumber: Parse = toNumber;
export const integerFrom =
  (min: number): Parse =>
  (text) => {
    const n = toNumber(text);
    return n !== null && Number.isInteger(n) && n >= min ? n : null;
  };
export const numberFrom =
  (min: number): Parse =>
  (text) => {
    const n = toNumber(text);
    return n !== null && n >= min ? n : null;
  };
export const numberBetween =
  (min: number, max: number): Parse =>
  (text) => {
    const n = toNumber(text);
    return n !== null && n >= min && n <= max ? n : null;
  };
export const trimmed: Parse = (text) => text.trim();
