import {
  Home as HomeIcon,
  Receipt as ReceiptIcon,
  Plus as PlusIcon,
  ChartPie as ChartPieIcon,
  User as UserIcon,
} from 'lucide-react';

const iconMap = {
  Home: HomeIcon,
  Receipt: ReceiptIcon,
  Plus: PlusIcon,
  ChartPie: ChartPieIcon,
  User: UserIcon,
};

/**
 * Resolve a string icon name into a Lucide React component.
 * @param {string} name - The icon name (see BOTTOM_NAV).
 * @param {object} props - Props to pass to the icon component (e.g. className).
 * @returns JSX element or null.
 */
export function resolveIcon(name, props = {}) {
  if (!name) return null;
  const Icon = iconMap[name];
  if (!Icon) return null;
  return <Icon {...props} />;
}

export default iconMap;
