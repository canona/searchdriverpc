import type { DeviceInfo } from '../../electron/types';
import { useDriverDownloads } from '../hooks/useDriverDownloads';
import { DownloadedCard, ProgressLine } from './DownloadStatus';

interface Props {
  /** Các thiết bị có vấn đề và tìm được trên catalog. */
  devices: DeviceInfo[];
  onClose: () => void;
}

const OUTCOME_LABEL = {
  downloaded: 'Đã tải',
  'no-results': 'Không có gói',
  'no-match': 'Không khớp',
  failed: 'Lỗi',
} as const;

/** Tự tìm & tải driver cho tất cả thiết bị lỗi / thiếu driver. */
export function AutoFindPanel({ devices, onClose }: Props) {
  const { states, downloadDir, autoFindAll, bulkRunning, cancelBulk } = useDriverDownloads();
  const doneCount = devices.filter((d) => states[d.id]?.auto?.outcome === 'downloaded').length;

  return (
    <section className="panel auto-panel" aria-live="polite">
      <header className="panel-head">
        <h2>Tự tìm &amp; tải driver ({devices.length} thiết bị)</h2>
        <div className="panel-actions">
          {bulkRunning ? (
            <button className="btn btn-sm" onClick={cancelBulk}>
              Dừng sau thiết bị hiện tại
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={devices.length === 0} onClick={() => void autoFindAll(devices)}>
              Bắt đầu tìm &amp; tải
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={bulkRunning} aria-label="Đóng">
            ✕
          </button>
        </div>
      </header>

      <p className="muted small">
        Nguồn: <b>Microsoft Update Catalog</b>. Mỗi gói .cab được kiểm tra SHA-256, chữ ký số của Microsoft và đối chiếu
        file .inf với Hardware ID; gói không khớp bị xóa và thử gói kế tiếp. App <b>không cài đặt</b> gì.
      </p>
      <p className="small download-dir muted">
        Khi bấm bắt đầu, app sẽ hỏi thư mục lưu. Lần gần nhất: <span className="mono">{downloadDir ?? '—'}</span>
      </p>

      {devices.length === 0 ? (
        <p>Không có thiết bị lỗi nào có Vendor/Device ID để tìm trên catalog.</p>
      ) : (
        <ul className="auto-list">
          {devices.map((d) => {
            const s = states[d.id];
            return (
              <li key={d.id}>
                <div className="auto-item-head">
                  <span>
                    <b>{d.name}</b>
                    {d.deviceName && d.deviceName !== d.name && <span className="muted small"> — {d.deviceName}</span>}
                  </span>
                  {s?.auto && <span className={`tag outcome-${s.auto.outcome}`}>{OUTCOME_LABEL[s.auto.outcome]}</span>}
                  {!s?.auto && !s?.autoRunning && <span className="muted small">Chờ</span>}
                </div>
                {s?.autoRunning && <ProgressLine progress={s.progress} />}
                {s?.auto && !s.auto.driver && <div className="muted small">{s.auto.message}</div>}
                {s?.auto?.driver && <DownloadedCard driver={s.auto.driver} />}
              </li>
            );
          })}
        </ul>
      )}
      {!bulkRunning && doneCount > 0 && (
        <p className="small">
          Đã tải {doneCount}/{devices.length} gói. Hãy tự cài qua Device Manager theo hướng dẫn ở từng gói.
        </p>
      )}
    </section>
  );
}
