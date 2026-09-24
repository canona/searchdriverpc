import { memo } from 'react';
import type { DeviceInfo } from '../../electron/types';
import { canSearchCatalog, useDeviceDriverState, useDriverDownloads } from '../hooks/useDriverDownloads';
import { DriverSearchSection } from './DriverSearchSection';
import { InstalledDriverSection } from './InstalledDriverSection';
import { StatusBadge } from './StatusBadge';

interface Props {
  device: DeviceInfo;
  expanded: boolean;
  hasWindowsUpdate: boolean;
  onToggle: (id: string) => void;
  onOpenLink: (url: string) => void;
}

function DeviceRowImpl({ device: d, expanded, hasWindowsUpdate, onToggle, onOpenLink }: Props) {
  const { autoFind } = useDriverDownloads();
  const driverState = useDeviceDriverState(d.id);
  const [primary, ...others] = d.links;
  // Hãng: ưu tiên tên tra từ pci.ids/usb.ids (chính xác theo chip), sau đó tới Manufacturer của Windows.
  const vendor = d.vendorName ?? d.manufacturer ?? '—';
  // Với thiết bị thiếu driver, Windows chỉ hiện tên chung ("PCI Device") -> hiện tên tra được bên dưới.
  const lookedUpName = d.deviceName && d.deviceName !== d.name ? d.deviceName : null;

  return (
    <>
      <tr className={`device-row status-${d.status}${expanded ? ' expanded' : ''}`} onClick={() => onToggle(d.id)}>
        <td className="col-name">
          <div className="name-cell">
            <button
              className="expander"
              aria-expanded={expanded}
              aria-label={expanded ? 'Thu gọn' : 'Xem chi tiết'}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(d.id);
              }}
            >
              {expanded ? '▾' : '▸'}
            </button>
            <div>
              <div className="device-name">{d.name}</div>
              {lookedUpName && <div className="muted small">{lookedUpName}</div>}
            </div>
          </div>
        </td>
        <td className="col-status">
          <StatusBadge status={d.status} title={d.statusText} />
          {hasWindowsUpdate && (
            <span className="wu-chip" title="Có driver cho thiết bị này trên Windows Update (Optional updates)">
              WU
            </span>
          )}
        </td>
        <td className="col-vendor">
          <div>{vendor}</div>
          {d.subsysVendorName && d.subsysVendorName !== vendor && (
            <div className="muted small">OEM: {d.subsysVendorName}</div>
          )}
        </td>
        <td className="col-class muted">{d.pnpClass ?? '—'}</td>
        <td className="col-action" onClick={(e) => e.stopPropagation()}>
          {primary ? (
            <button
              className={d.status === 'ok' ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
              title={primary.url}
              onClick={() => onOpenLink(primary.url)}
            >
              Mở trang tải driver ↗
            </button>
          ) : (
            <span className="muted small">Không có link</span>
          )}
          {canSearchCatalog(d) && (
            <button
              className="btn btn-sm action-secondary"
              title="Tự tìm trên Microsoft Update Catalog và tải gói phù hợp nhất (không cài)"
              disabled={driverState.autoRunning || !!driverState.downloadingId}
              onClick={() => {
                if (!expanded) onToggle(d.id);
                void autoFind(d.id);
              }}
            >
              {driverState.autoRunning ? 'Đang tải…' : driverState.auto?.outcome === 'downloaded' ? 'Đã tải ✓' : 'Tìm & tải'}
            </button>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="detail-row">
          <td colSpan={5}>
            <div className="detail">
              <dl>
                <dt>Trạng thái</dt>
                <dd>{d.statusText}</dd>
                {d.statusHint && (
                  <>
                    <dt>Gợi ý</dt>
                    <dd>{d.statusHint}</dd>
                  </>
                )}
                {d.parsedId?.vendorId && (
                  <>
                    <dt>Vendor / Device ID</dt>
                    <dd className="mono">
                      {d.parsedId.bus} · {d.parsedId.idSpace === 'usb' ? 'VID' : 'VEN'}_{d.parsedId.vendorId.toUpperCase()}
                      {d.parsedId.deviceId && ` · ${d.parsedId.idSpace === 'usb' ? 'PID' : 'DEV'}_${d.parsedId.deviceId.toUpperCase()}`}
                      {d.parsedId.subsysVendorId &&
                        ` · SUBSYS ${d.parsedId.subsysDeviceId?.toUpperCase()}${d.parsedId.subsysVendorId.toUpperCase()}`}
                    </dd>
                  </>
                )}
                {d.subsystemName && (
                  <>
                    <dt>Model (SUBSYS)</dt>
                    <dd>{d.subsystemName}</dd>
                  </>
                )}
                {d.manufacturer && (
                  <>
                    <dt>Manufacturer (Windows)</dt>
                    <dd>{d.manufacturer}</dd>
                  </>
                )}
                <dt>Hardware ID</dt>
                <dd className="mono hwids">
                  {(d.hardwareIds.length ? d.hardwareIds : [d.id]).map((h) => (
                    <div key={h}>{h}</div>
                  ))}
                </dd>
              </dl>
              {others.length > 0 && (
                <div className="detail-links">
                  <span className="muted small">Nguồn khác:</span>
                  {others.map((l) => (
                    <button key={l.url} className="btn btn-ghost btn-sm" title={l.url} onClick={() => onOpenLink(l.url)}>
                      {l.label} ↗
                    </button>
                  ))}
                </div>
              )}
              <InstalledDriverSection device={d} />
              <DriverSearchSection device={d} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export const DeviceRow = memo(DeviceRowImpl);
