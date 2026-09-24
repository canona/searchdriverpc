import type { DriverStatus } from '../../electron/types';

export const STATUS_LABEL: Record<DriverStatus, string> = {
  ok: 'OK',
  missing: 'Thiếu driver',
  error: 'Lỗi',
  disabled: 'Bị tắt',
};

export function StatusBadge({ status, title }: { status: DriverStatus; title?: string }) {
  return (
    <span className={`badge badge-${status}`} title={title}>
      <span className="badge-dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
