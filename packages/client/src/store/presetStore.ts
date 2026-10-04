import type { ImagePreset } from '@media-agent/shared';
import { create } from 'zustand';
import { api } from '../api';

// 出图设置的预设，出图设置和设置页共用，见 docs/dev-plan.md 5.21

type PresetState = {
  list: ImagePreset[] | null; // 还没读过是 null
  load: () => Promise<ImagePreset[]>;
  put: (preset: ImagePreset) => void;
  drop: (id: string) => void;
};

export const usePresetStore = create<PresetState>((set, get) => {
  let run: Promise<ImagePreset[]> | null = null;
  return {
    list: null,
    // 同时有几处要读时只读一次
    load: () =>
      (run ??= api<ImagePreset[]>('/image-presets')
        .then((list) => {
          set({ list });
          return list;
        })
        .finally(() => {
          run = null;
        })),
    put: (preset) => {
      const list = get().list ?? [];
      set({ list: list.some((p) => p.id === preset.id) ? list.map((p) => (p.id === preset.id ? preset : p)) : [...list, preset] });
    },
    drop: (id) => set({ list: (get().list ?? []).filter((p) => p.id !== id) }),
  };
});
