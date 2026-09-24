import type { DeviceInfo } from '../../electron/types';
import { canSearchCatalog, formatBytes, useDeviceDriverState, useDriverDownloads } from '../hooks/useDriverDownloads';
import { DownloadedCard, ProgressLine } from './DownloadStatus';

const MAX_SHOWN = 8;

/** Phần "Tìm driver trực tuyến" trong chi tiết một thiết bị. */
export function DriverSearchSection({ device }: { device: DeviceInfo }) {
  const { search, download, autoFind } = useDriverDownloads();
  const s = useDeviceDriverState(device.id);
  const busy = !!s.downloadingId || !!s.autoRunning;

  if (!device.parsedId?.idSpace || !device.parsedId.vendorId) {
    return (
      <p className="muted small">
        Thiết bị không có Vendor/Device ID dạng PCI hoặc USB nên không tìm được trên Microsoft Update Catalog.
      </p>
    );
  }

  const autoDriver = s.auto?.driver;

  return (
    <div className="driver-search">
      <div className="driver-search-head">
        <b>Tìm driver trên Microsoft Update Catalog</b>
        <div className="panel-actions">
          <button className="btn btn-sm" disabled={s.searching || busy} onClick={() => void search(device.id)}>
            {s.searching ? 'Đang tìm…' : s.search ? 'Tìm lại' : 'Tìm driver'}
          </button>
          {canSearchCatalog(device) && (
            <button className="btn btn-primary btn-sm" disabled={s.searching || busy} onClick={() => void autoFind(device.id)}>
              Tự tìm &amp; tải gói phù hợp nhất
            </button>
          )}
        </div>
      </div>

      {s.autoRunning && <ProgressLine progress={s.progress} />}
      {s.auto && !s.autoRunning && !autoDriver && <p className="warn-text small">{s.auto.message}</p>}
      {autoDriver && <DownloadedCard driver={autoDriver} />}

      {s.searchError && <p className="error-text small">Không tìm được: {s.searchError}</p>}

      {s.search && (
        <>
          <p className="muted small">
            Truy vấn: <span className="mono">{s.search.queries.join('  |  ')}</span> — {s.search.entries.length} gói phù hợp với
            Windows/CPU của máy.
          </p>
          {s.search.entries.length > 0 && (
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Gói driver</th>
                  <th>Ngày</th>
                  <th>Dung lượng</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.search.entries.slice(0, MAX_SHOWN).map((e) => {
                  const done = s.downloaded[e.updateId];
                  const err = s.downloadErrors[e.updateId];
                  const downloadingThis = s.downloadingId === e.updateId && !s.autoRunning;
                  return (
                    <tr key={e.updateId}>
                      <td>
                        <div>
                          {e.title}
                          {e.recommended && <span className="tag tag-accent">Đề xuất</span>}
                          {e.matchedSubsys && <span className="tag">Khớp model máy</span>}
                        </div>
                        <div className="muted small">{e.products}</div>
                        {downloadingThis && <ProgressLine progress={s.progress} />}
                        {err && <div className="error-text small">{err}</div>}
                        {done && <DownloadedCard driver={done} />}
                      </td>
                      <td className="muted nowrap">{e.lastUpdated ?? '—'}</td>
                      <td className="muted nowrap">{formatBytes(e.sizeBytes)}</td>
                      <td className="nowrap">
                        <button
                          className="btn btn-sm"
                          disabled={busy || !!done}
                          onClick={() => void download(device.id, e.updateId)}
                        >
                          {done ? 'Đã tải' : 'Tải về'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
