import {
  DoorOpen,
  Fan,
  Lightbulb,
  Plug,
  Radar,
  Router,
  Thermometer,
  ToggleLeft,
  Zap,
} from 'lucide-react';
import { type ReactNode } from 'react';

export type DeviceIconType = 'plug' | 'toggle-left' | 'lightbulb' | 'fan' | 'thermometer' | 'zap' | 'radar' | 'door-open' | 'router';

export interface DeviceIconPickerItem {
  value: DeviceIconType;
  label: string;
  icon: ReactNode;
}

interface DeviceIconProps {
  icon?: DeviceIconType | null;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const iconMap: Record<DeviceIconType, typeof Plug> = {
  plug: Plug,
  'toggle-left': ToggleLeft,
  lightbulb: Lightbulb,
  fan: Fan,
  thermometer: Thermometer,
  zap: Zap,
  radar: Radar,
  'door-open': DoorOpen,
  router: Router,
};

const ICON_LABELS: Record<DeviceIconType, string> = {
  plug: 'Ổ cắm',
  'toggle-left': 'Công tắc',
  lightbulb: 'Đèn',
  fan: 'Quạt',
  thermometer: 'Nhiệt độ',
  zap: 'Điện',
  radar: 'Chuyển động',
  'door-open': 'Cửa',
  router: 'Định tuyến',
};

export function DeviceIcon({ icon, size = 24, strokeWidth = 1.75, className }: DeviceIconProps) {
  const iconKey: DeviceIconType = (icon && icon in iconMap ? icon : 'plug') as DeviceIconType;
  const IconComponent = iconMap[iconKey];

  return <IconComponent size={size} strokeWidth={strokeWidth} className={className} />;
}

export function getIconPickerList(): DeviceIconPickerItem[] {
  const icons: DeviceIconType[] = ['plug', 'toggle-left', 'lightbulb', 'fan', 'thermometer', 'zap', 'radar', 'door-open'];

  return icons.map((iconKey) => ({
    value: iconKey,
    label: ICON_LABELS[iconKey],
    icon: <DeviceIcon icon={iconKey} />,
  }));
}
