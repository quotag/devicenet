import { Banner, type BannerKind } from './Banner';

export type StatusBannerMode = 'offline' | 'lan' | 'reconnecting' | 'saving';

export interface StatusBannerProps {
  mode: StatusBannerMode;
  /** Already-localised text (see vi.banner.*). */
  text: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}

const kindOf: Record<StatusBannerMode, BannerKind> = {
  offline: 'offline',
  lan: 'lan',
  reconnecting: 'reconnecting',
  // "Đã lưu, hub đang nạp…": neutral strip with spinner, same as reconnecting.
  saving: 'reconnecting',
};

/** Connection/save status strip. Text is passed in; mode picks colour and spinner. */
export function StatusBanner({ mode, text, action, onAction, className }: StatusBannerProps) {
  return (
    <Banner kind={kindOf[mode]} action={action} onAction={onAction} className={className}>
      {text}
    </Banner>
  );
}
