import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import type { DeviceInfo, DriverStatus } from '../../electron/types';
import { DeviceRow } from './DeviceRow';
import { STATUS_LABEL } from './StatusBadge';

type Filter = 'all' | 'problem' | DriverStatus;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'problem', label: 'Có vấn đề' },
  { key: 'missing', label: STATUS_LABEL.missing },
  { key: 'error', label: STATUS_LABEL.error },
  { key: 'disabled', label: STATUS_LABEL.disabled },
  { key: 'ok', label: STATUS_LABEL.ok },
];

function matchesFilter(d: DeviceInfo, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'problem') return d.status !== 'ok';
  return d.status === filter;
}

/** Tìm theo tên Windows, tên tra cứu, hãng, và cả Hardware ID (vd gõ "VEN_8086"). */
function matchesSearch(d: DeviceInfo, q: string): boolean {
  if (!q) return true;
  const haystack = [d.name, d.deviceName, d.vendorName, d.manufacturer, d.pnpClass, ...d.hardwareIds]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

interface Props {
  devices: DeviceInfo[];
  /** id các thiết bị có driver chờ trên Windows Update. */
  windowsUpdateIds: ReadonlySet<string>;
  onOpenLink: (url: string) => void;
}

export function DeviceList({ devices, windowsUpdateIds, onOpenLink }: Props) {
  const hasProblems = devices.some((d) => d.status !== 'ok');
  const [filter, setFilter] = useState<Filter>(hasProblems ? 'problem' : 'all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: devices.length, problem: 0, ok: 0, missing: 0, error: 0, disabled: 0 };
    for (const d of devices) {
      c[d.status]++;
      if (d.status !== 'ok') c.problem++;
    }
    return c;
  }, [devices]);

  const visible = useMemo(
    () => devices.filter((d) => matchesFilter(d, filter) && matchesSearch(d, deferredSearch)),
    [devices, filter, deferredSearch],
  );

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  return (
    <section className="device-list">
      <div className="list-toolbar">
        <div className="filters" role="tablist" aria-label="Lọc theo trạng thái">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={`chip chip-${f.key}${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="chip-count">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Tìm theo tên thiết bị, hãng, Hardware ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Tìm thiết bị"
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="col-name">Tên thiết bị</th>
              <th className="col-status">Trạng thái</th>
              <th className="col-vendor">Hãng sản xuất</th>
              <th className="col-class">Loại</th>
              <th className="col-action">Driver</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                expanded={expanded.has(d.id)}
                hasWindowsUpdate={windowsUpdateIds.has(d.id)}
                onToggle={toggle}
                onOpenLink={onOpenLink}
              />
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="empty">
            {filter === 'problem' && !deferredSearch
              ? '🎉 Không có thiết bị nào thiếu driver hoặc bị lỗi.'
              : 'Không có thiết bị nào khớp bộ lọc.'}
          </div>
        )}
      </div>
    </section>
  );
}
