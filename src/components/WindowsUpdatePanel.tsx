import type { DeviceInfo, WindowsUpdateResult } from '../../electron/types';
import { matchDevice } from '../hooks/useWindowsUpdate';

interface Props {
  result: WindowsUpdateResult | null;
  loading: boolean;
  error: string | null;
  devices: DeviceInfo[];
  onOpenSettings: () => void;
  onClose: () => void;
}

export function WindowsUpdatePanel({ result, loading, error, devices, onOpenSettings, onClose }: Props) {
  return (
    <section className="panel wu-panel" aria-live="polite">
      <header className="panel-head">
        <h2>Driver trên Windows Update</h2>
        <div className="panel-actions">
          <button className="btn btn-primary btn-sm" onClick={onOpenSettings}>
            Mở Windows Update (Optional updates)
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
      </header>

      {loading && (
        <p className="muted">
          <span className="spinner" aria-hidden /> Đang hỏi Windows Update… lần đầu có thể mất 1–2 phút.
        </p>
      )}
      {error && <p className="error-text">Không kiểm tra được: {error}</p>}

      {result && !loading && (
        <>
          <p className="muted small">
            Kiểm tra lúc {new Date(result.checkedAt).toLocaleTimeString('vi-VN')}. App chỉ <b>tìm kiếm</b>, không tải hay
            cài. Muốn cài, mở Windows Update và tự chọn trong mục Optional updates.
          </p>
          {result.updates.length === 0 ? (
            <p>Không có driver tùy chọn nào đang chờ.</p>
          ) : (
            <table className="wu-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Loại</th>
                  <th>Ngày</th>
                  <th>Thiết bị trong máy</th>
                </tr>
              </thead>
              <tbody>
                {result.updates.map((u, i) => {
                  const device = matchDevice(u.hardwareId, devices);
                  return (
                    <tr key={`${u.title}-${i}`}>
                      <td>
                        <div>{u.model ?? u.title}</div>
                        <div className="muted small">
                          {u.manufacturer}
                          {u.sizeMB ? ` · ${u.sizeMB} MB` : ''}
                        </div>
                      </td>
                      <td className="muted">{u.driverClass ?? '—'}</td>
                      <td className="muted">{u.driverDate ?? '—'}</td>
                      <td>{device ? device.name : <span className="muted mono small">{u.hardwareId}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
